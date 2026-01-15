import { SessionAnalysisProvider } from '../analysis/session-analysis-provider'
import type { SegmentSummary } from '../analysis/session-analysis'
import { manifestService, type ManifestService, type SessionRecord, type StoredChunk } from '../storage/manifest'

export type RecordingSliceKind = 'chunk' | 'snip'

export interface RecordingAudioSlice {
  kind: RecordingSliceKind
  sessionId: string
  startMs: number
  endMs: number
  durationMs: number
  mimeType: string
  blob: Blob
  suggestedFilename: string
}

const MP4_MIME_PATTERN = /mp4|m4a/i

const writeAscii = (view: DataView, offset: number, value: string) => {
  for (let i = 0; i < value.length; i += 1) {
    view.setUint8(offset + i, value.charCodeAt(i))
  }
}

const encodeWavPcm16Mono = (samples: Float32Array, sampleRate: number): Blob => {
  const bitsPerSample = 16
  const numChannels = 1
  const blockAlign = (numChannels * bitsPerSample) / 8
  const byteRate = sampleRate * blockAlign
  const dataSize = samples.length * 2
  const buffer = new ArrayBuffer(44 + dataSize)
  const view = new DataView(buffer)

  writeAscii(view, 0, 'RIFF')
  view.setUint32(4, 36 + dataSize, true)
  writeAscii(view, 8, 'WAVE')
  writeAscii(view, 12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, numChannels, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, byteRate, true)
  view.setUint16(32, blockAlign, true)
  view.setUint16(34, bitsPerSample, true)
  writeAscii(view, 36, 'data')
  view.setUint32(40, dataSize, true)

  let writeOffset = 44
  for (let i = 0; i < samples.length; i += 1) {
    const clamped = Math.max(-1, Math.min(1, samples[i]))
    const int16 = clamped < 0 ? Math.round(clamped * 0x8000) : Math.round(clamped * 0x7fff)
    view.setInt16(writeOffset, int16, true)
    writeOffset += 2
  }

  return new Blob([buffer], { type: 'audio/wav' })
}

const sliceAudioBufferToMono = (
  buffer: AudioBuffer,
  startMs: number,
  endMs: number,
): { samples: Float32Array; sampleRate: number; durationMs: number; startMs: number; endMs: number } => {
  const sampleRate = buffer.sampleRate
  const startSample = Math.max(0, Math.floor((startMs / 1000) * sampleRate))
  const endSample = Math.min(buffer.length, Math.ceil((endMs / 1000) * sampleRate))
  const length = Math.max(0, endSample - startSample)

  if (length === 0) {
    return {
      samples: new Float32Array(0),
      sampleRate,
      durationMs: 0,
      startMs,
      endMs: startMs,
    }
  }

  if (buffer.numberOfChannels === 1) {
    const mono = buffer.getChannelData(0).slice(startSample, endSample)
    const durationMs = (mono.length / sampleRate) * 1000
    return {
      samples: mono,
      sampleRate,
      durationMs,
      startMs,
      endMs: startMs + durationMs,
    }
  }

  const output = new Float32Array(length)
  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    const channelData = buffer.getChannelData(channel)
    for (let i = 0; i < length; i += 1) {
      output[i] += channelData[startSample + i] / buffer.numberOfChannels
    }
  }

  const durationMs = (output.length / sampleRate) * 1000
  return {
    samples: output,
    sampleRate,
    durationMs,
    startMs,
    endMs: startMs + durationMs,
  }
}

export class RecordingSlicesApi {
  #manifest: ManifestService
  #analysisProvider: SessionAnalysisProvider
  #decodedCache = new Map<string, { cacheKey: string; buffer: AudioBuffer }>()

  constructor(manifest: ManifestService = manifestService, analysisProvider?: SessionAnalysisProvider) {
    this.#manifest = manifest
    this.#analysisProvider = analysisProvider ?? new SessionAnalysisProvider(manifest)
  }

  async #ensureInit(): Promise<void> {
    await this.#manifest.init()
  }

  async listChunks(sessionId: string): Promise<StoredChunk[]> {
    await this.#ensureInit()
    return await this.#manifest.getChunkData(sessionId)
  }

  async listSnips(session: SessionRecord, mimeTypeHint?: string | null): Promise<SegmentSummary[]> {
    await this.#ensureInit()
    const result = await this.#analysisProvider.prepareAnalysisForSession({
      session,
      mimeTypeHint: mimeTypeHint ?? session.mimeType ?? null,
    })
    return result.analysis?.segments ?? []
  }

  async getChunkAudio(session: SessionRecord, seq: number): Promise<RecordingAudioSlice | null> {
    await this.#ensureInit()
    const chunks = await this.#manifest.getChunkData(session.id)
    const target = chunks.find((chunk) => chunk.seq === seq) ?? null
    if (!target) return null

    const headerChunk = chunks.find((chunk) => chunk.seq === 0) ?? null
    const baseMimeType = target.blob.type || session.mimeType || 'audio/mp4'
    const needsInit = headerChunk && headerChunk.id !== target.id && MP4_MIME_PATTERN.test(baseMimeType)
    const blob = needsInit ? new Blob([headerChunk.blob, target.blob], { type: baseMimeType }) : target.blob

    const startMs = target.startMs
    const endMs = target.endMs
    const durationMs = Math.max(0, endMs - startMs)
    const iso = new Date(session.startedAt ?? Date.now()).toISOString().replace(/[:.]/g, '-')
    const seqLabel = String(seq + 1).padStart(2, '0')

    return {
      kind: 'chunk',
      sessionId: session.id,
      startMs,
      endMs,
      durationMs,
      mimeType: blob.type || baseMimeType,
      blob,
      suggestedFilename: `${iso}_chunk-${seqLabel}.mp4`,
    }
  }

  async #getDecodedBuffer(session: SessionRecord, mimeTypeHint?: string | null): Promise<AudioBuffer> {
    if (typeof window === 'undefined' || typeof window.AudioContext === 'undefined') {
      throw new Error('AudioContext is not supported in this environment.')
    }

    await this.#ensureInit()
    const cacheKey = [session.id, session.updatedAt ?? 0, session.chunkCount ?? 0, session.mimeType ?? mimeTypeHint ?? ''].join(':')
    const cached = this.#decodedCache.get(session.id)
    if (cached?.cacheKey === cacheKey) {
      return cached.buffer
    }

    const mimeType = session.mimeType ?? mimeTypeHint ?? 'audio/mp4'
    const blob = await this.#manifest.buildSessionBlob(session.id, mimeType)
    if (!blob) {
      throw new Error('No audio available yet.')
    }

    const arrayBuffer = await blob.arrayBuffer()
    const audioContext = new AudioContext()
    try {
      const decoded = await audioContext.decodeAudioData(arrayBuffer.slice(0))
      this.#decodedCache.set(session.id, { cacheKey, buffer: decoded })
      return decoded
    } finally {
      await audioContext.close().catch(() => {
        /* noop */
      })
    }
  }

  async getRangeAudio(session: SessionRecord, startMs: number, endMs: number, mimeTypeHint?: string | null): Promise<RecordingAudioSlice> {
    const buffer = await this.#getDecodedBuffer(session, mimeTypeHint)
    const safeStartMs = Math.max(0, startMs)
    const safeEndMs = Math.max(safeStartMs, endMs)
    const sliced = sliceAudioBufferToMono(buffer, safeStartMs, safeEndMs)
    const blob = encodeWavPcm16Mono(sliced.samples, sliced.sampleRate)
    const iso = new Date(session.startedAt ?? Date.now()).toISOString().replace(/[:.]/g, '-')

    return {
      kind: 'snip',
      sessionId: session.id,
      startMs: sliced.startMs,
      endMs: sliced.endMs,
      durationMs: sliced.durationMs,
      mimeType: blob.type,
      blob,
      suggestedFilename: `${iso}_snip-${Math.round(sliced.startMs)}-${Math.round(sliced.endMs)}.wav`,
    }
  }

  async getSnipAudio(session: SessionRecord, snipNumber: number, mimeTypeHint?: string | null): Promise<RecordingAudioSlice | null> {
    const segments = await this.listSnips(session, mimeTypeHint)
    const index = snipNumber - 1
    const segment = segments[index]
    if (!segment) return null
    return await this.getRangeAudio(session, segment.startMs, segment.endMs, mimeTypeHint)
  }

  clearSession(sessionId: string): void {
    this.#decodedCache.delete(sessionId)
  }
}

export const recordingSlicesApi = new RecordingSlicesApi()

