import { SessionAnalysisProvider } from '../analysis/session-analysis-provider'
import { analyzeSessionWindowFromFrames, DEFAULT_SESSION_ANALYSIS_CONFIG } from '../analysis/session-analysis'
import {
  manifestService,
  type ManifestService,
  type SessionRecord,
  type SnipRecord,
  type SnipSeed,
  type StoredChunk,
} from '../storage/manifest'

export type RecordingSliceKind = 'chunk' | 'snip' | 'session'

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

export interface RecordingRangeInspection {
  startMs: number
  endMs: number
  durationMs: number
  sampleRate: number
  sampleCount: number
  rms: number
  peak: number
}

const MP4_MIME_PATTERN = /mp4|m4a/i
const LIVE_SNIP_TAIL_MS = 15_000

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
  #audioContext: AudioContext | null = null

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

  async listSnips(session: SessionRecord, mimeTypeHint?: string | null): Promise<SnipRecord[]> {
    await this.#ensureInit()
    const storedSnips = await this.#manifest.listSnips(session.id)
    const lastEndMs = storedSnips.length > 0 ? storedSnips[storedSnips.length - 1].endMs : 0
    const sessionDurationMs = Math.max(0, session.durationMs ?? 0)
    const isRecording = session.status === 'recording'
    const tailMs = isRecording ? LIVE_SNIP_TAIL_MS : 0
    const minWindowMs = isRecording ? DEFAULT_SESSION_ANALYSIS_CONFIG.minSegmentMs + tailMs : 0
    const remainingMs = Math.max(0, sessionDurationMs - lastEndMs)
    const needsRefresh =
      storedSnips.length === 0 ||
      (isRecording
        ? remainingMs >= minWindowMs
        : sessionDurationMs > 0 && lastEndMs < Math.max(0, sessionDurationMs - 1000))
    if (!needsRefresh) {
      return storedSnips
    }

    const result = await this.#analysisProvider.prepareAnalysisForSession({
      session,
      mimeTypeHint: mimeTypeHint ?? session.mimeType ?? null,
      forceRefresh: isRecording,
    })
    const analysisDurationMs = result.analysis?.stats.totalDurationMs ?? result.frames[result.frames.length - 1]?.endMs ?? 0
    if (analysisDurationMs <= lastEndMs + 200) {
      return storedSnips
    }

    const windowStartMs = Math.min(Math.max(0, lastEndMs), analysisDurationMs)
    const windowEndMs = analysisDurationMs
    const windowDurationMs = Math.max(0, windowEndMs - windowStartMs)
    if (windowDurationMs <= 0 || (isRecording && windowDurationMs < minWindowMs)) {
      return storedSnips
    }

    const windowResult = analyzeSessionWindowFromFrames({
      frames: result.frames,
      windowStartMs,
      windowEndMs,
      sampleRate: result.analysis?.stats.sampleRate ?? 0,
      frameDurationMs: result.analysis?.stats.frameDurationMs ?? DEFAULT_SESSION_ANALYSIS_CONFIG.frameDurationMs,
    })
    const segments = windowResult.analysis?.segments ?? []
    if (segments.length === 0) {
      return storedSnips
    }
    const maxSnipEndMs = isRecording ? Math.max(0, windowDurationMs - tailMs) : windowDurationMs
    const baseIndex = storedSnips.reduce((max, snip) => Math.max(max, snip.index), -1) + 1
    const seeds: SnipSeed[] = []
    segments.forEach((segment) => {
      if (segment.endMs <= 0) {
        return
      }
      if (segment.endMs > maxSnipEndMs) {
        return
      }
      seeds.push({
        index: baseIndex + seeds.length,
        startMs: windowStartMs + segment.startMs,
        endMs: windowStartMs + segment.endMs,
        durationMs: segment.durationMs,
        breakReason: segment.breakReason,
        boundaryIndex: segment.boundaryIndex,
      })
    })
    if (seeds.length === 0) {
      return storedSnips
    }
    return await this.#manifest.appendSnips(session.id, seeds)
  }

  async getChunkAudio(session: SessionRecord, seq: number): Promise<RecordingAudioSlice | null> {
    await this.#ensureInit()
    const chunks = await this.#manifest.getChunkData(session.id)
    const target = chunks.find((chunk) => chunk.seq === seq) ?? null
    if (!target) return null

    const headerChunk = chunks.find((chunk) => chunk.seq === 0) ?? null
    const baseMimeType = target.blob.type || session.mimeType || 'audio/mpeg'
    const needsInit = headerChunk && headerChunk.id !== target.id && MP4_MIME_PATTERN.test(baseMimeType)
    const blob = needsInit ? new Blob([headerChunk.blob, target.blob], { type: baseMimeType }) : target.blob

    const startMs = target.startMs
    const endMs = target.endMs
    const durationMs = Math.max(0, endMs - startMs)
    const iso = new Date(session.startedAt ?? Date.now()).toISOString().replace(/[:.]/g, '-')
    const seqLabel = String(seq + 1).padStart(2, '0')
    const extension = /mpeg/i.test(baseMimeType) ? 'mp3' : /webm/i.test(baseMimeType) ? 'webm' : /mp4|m4a/i.test(baseMimeType) ? 'mp4' : 'bin'

    return {
      kind: 'chunk',
      sessionId: session.id,
      startMs,
      endMs,
      durationMs,
      mimeType: blob.type || baseMimeType,
      blob,
      suggestedFilename: `${iso}_chunk-${seqLabel}.${extension}`,
    }
  }

  async #getAudioContext(): Promise<AudioContext> {
    if (typeof window === 'undefined' || typeof window.AudioContext === 'undefined') {
      throw new Error('AudioContext is not supported in this environment.')
    }
    if (this.#audioContext) {
      return this.#audioContext
    }
    this.#audioContext = new AudioContext()
    return this.#audioContext
  }

  async #getChunkIndex(session: SessionRecord): Promise<{
    baseStartMs: number
    headerChunk: StoredChunk | null
    playable: Array<StoredChunk & { startOffsetMs: number; endOffsetMs: number }>
  }> {
    await this.#ensureInit()
    const chunks = await this.#manifest.getChunkData(session.id)
    const sessionMime = session.mimeType ?? ''
    const isMp4Like = /mp4|m4a/i.test(sessionMime)
    const headerChunk =
      isMp4Like
        ? (chunks.find((chunk) => chunk.seq === 0 && (chunk.endMs - chunk.startMs <= 10 || chunk.byteLength < 4096)) ?? null)
        : null
    const playableChunks = chunks
      .filter((chunk) => !headerChunk || chunk.id !== headerChunk.id)
      .filter((chunk) => !chunk.audioPurgedAt && chunk.byteLength > 0 && chunk.blob.size > 0)
      .sort((a, b) => a.seq - b.seq)
    const baseStartMsCandidate =
      headerChunk?.startMs ??
      (playableChunks.length > 0 ? playableChunks[0].startMs : session.startedAt ?? Date.now())
    const baseStartMs = Number.isFinite(baseStartMsCandidate) ? Math.round(baseStartMsCandidate) : Date.now()
    const looksAbsolute = baseStartMs > 1_000_000_000_000

    const playable = playableChunks.map((chunk) => {
      const startOffsetMs = looksAbsolute ? chunk.startMs - baseStartMs : chunk.startMs
      const endOffsetMs = looksAbsolute ? chunk.endMs - baseStartMs : chunk.endMs
      return { ...chunk, startOffsetMs: Math.max(0, startOffsetMs), endOffsetMs: Math.max(0, endOffsetMs) }
    })

    return { baseStartMs, headerChunk, playable }
  }

  async #decodeChunkToBuffer(session: SessionRecord, chunk: StoredChunk, headerChunk: StoredChunk | null): Promise<AudioBuffer> {
    const mimeType = chunk.blob.type || session.mimeType || 'audio/mp4'
    const needsInit = headerChunk && headerChunk.id !== chunk.id && MP4_MIME_PATTERN.test(mimeType)
    const blob = needsInit ? new Blob([headerChunk.blob, chunk.blob], { type: mimeType }) : chunk.blob

    const audioContext = await this.#getAudioContext()
    try {
      const arrayBuffer = await blob.arrayBuffer()
      const decoded = await audioContext.decodeAudioData(arrayBuffer.slice(0))
      return decoded
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const detail = [
        `session=${session.id}`,
        `chunk=${chunk.id}`,
        `seq=${chunk.seq}`,
        `bytes=${blob.size}`,
        `mime=${mimeType}`,
        needsInit ? 'init=1' : 'init=0',
      ].join(' ')
      throw new Error(`Failed to decode chunk audio (${detail})${message ? `: ${message}` : ''}`)
    }
  }

  async #decodeRangeToMonoSamples(
    session: SessionRecord,
    startMs: number,
    endMs: number,
  ): Promise<{ samples: Float32Array; sampleRate: number; durationMs: number; startMs: number; endMs: number }> {
    const safeStartMs = Math.max(0, startMs)
    const safeEndMs = Math.max(safeStartMs, endMs)
    const { headerChunk, playable } = await this.#getChunkIndex(session)
    if (playable.length === 0) {
      return { samples: new Float32Array(0), sampleRate: 0, durationMs: 0, startMs: safeStartMs, endMs: safeStartMs }
    }

    const overlaps = playable
      .filter((chunk) => chunk.startOffsetMs < safeEndMs && chunk.endOffsetMs > safeStartMs)
      .sort((a, b) => a.seq - b.seq)
    if (overlaps.length === 0) {
      return { samples: new Float32Array(0), sampleRate: 0, durationMs: 0, startMs: safeStartMs, endMs: safeStartMs }
    }

    // Some browsers emit cumulative MP4 blobs (each chunk contains audio from t=0..current),
    // while our timing metadata still reflects the intended per-chunk window. In that case,
    // stitch logic must NOT subtract chunk.startOffset; instead we can use one chunk that
    // contains the whole desired range and slice by absolute session offset.
    const decodedOverlaps: Array<{
      chunk: StoredChunk & { startOffsetMs: number; endOffsetMs: number }
      buffer: AudioBuffer
      bufferDurationMs: number
      expectedChunkDurationMs: number
      isCumulative: boolean
    }> = []

    for (const chunk of overlaps) {
      const buffer = await this.#decodeChunkToBuffer(session, chunk, headerChunk)
      const bufferDurationMs = Math.max(0, buffer.duration * 1000)
      const expectedChunkDurationMs = Math.max(0, chunk.endOffsetMs - chunk.startOffsetMs)
      const isCumulative =
        expectedChunkDurationMs > 0 &&
        bufferDurationMs > expectedChunkDurationMs * 1.5 &&
        bufferDurationMs > chunk.endOffsetMs * 0.8
      decodedOverlaps.push({ chunk, buffer, bufferDurationMs, expectedChunkDurationMs, isCumulative })
    }

    const anyCumulative = decodedOverlaps.some((entry) => entry.isCumulative)
    if (anyCumulative) {
      // Choose the earliest chunk whose decoded buffer spans the requested end time.
      const chosen =
        decodedOverlaps.find((entry) => entry.bufferDurationMs >= safeEndMs - 10) ??
        decodedOverlaps[decodedOverlaps.length - 1]
      const sampleRate = chosen.buffer.sampleRate
      const sliced = sliceAudioBufferToMono(chosen.buffer, safeStartMs, safeEndMs)
      return {
        samples: sliced.samples,
        sampleRate,
        durationMs: sliced.durationMs,
        startMs: safeStartMs,
        endMs: safeStartMs + sliced.durationMs,
      }
    }

    const monoSlices: Float32Array[] = []
    let totalSamples = 0
    let sampleRate = 0

    for (const entry of decodedOverlaps) {
      const chunk = entry.chunk
      const buffer = entry.buffer
      if (sampleRate === 0) sampleRate = buffer.sampleRate

      const chunkDurationMs = buffer.duration * 1000
      const overlapStartInChunkMs = Math.max(0, safeStartMs - chunk.startOffsetMs)
      const overlapEndInChunkMs = Math.min(chunkDurationMs, safeEndMs - chunk.startOffsetMs)
      if (overlapEndInChunkMs <= overlapStartInChunkMs) {
        continue
      }

      const sliced = sliceAudioBufferToMono(buffer, overlapStartInChunkMs, overlapEndInChunkMs)
      monoSlices.push(sliced.samples)
      totalSamples += sliced.samples.length
    }

    if (sampleRate === 0 || totalSamples === 0) {
      return { samples: new Float32Array(0), sampleRate, durationMs: 0, startMs: safeStartMs, endMs: safeStartMs }
    }

    const out = new Float32Array(totalSamples)
    let offset = 0
    monoSlices.forEach((slice) => {
      out.set(slice, offset)
      offset += slice.length
    })
    const durationMs = (out.length / sampleRate) * 1000
    return { samples: out, sampleRate, durationMs, startMs: safeStartMs, endMs: safeStartMs + durationMs }
  }

  // NOTE: we intentionally avoid decoding the concatenated session blob for range access because
  // browser decoders can truncate/lie on long fMP4 fragment concatenations. See chunk-based decode above.

  async getRangeAudio(session: SessionRecord, startMs: number, endMs: number, _mimeTypeHint?: string | null): Promise<RecordingAudioSlice> {
    const sliced = await this.#decodeRangeToMonoSamples(session, startMs, endMs)
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

  async getSessionAudio(session: SessionRecord): Promise<RecordingAudioSlice> {
    await this.#ensureInit()
    const { playable } = await this.#getChunkIndex(session)
    if (playable.length === 0) {
      throw new Error('No playable audio available for download.')
    }
    const derivedEndMs = playable.reduce((max, chunk) => Math.max(max, chunk.endOffsetMs), 0)
    const declaredDurationMs = Math.max(0, session.durationMs ?? 0)
    const endMs = declaredDurationMs > 0 ? declaredDurationMs : derivedEndMs

    const sliced = await this.#decodeRangeToMonoSamples(session, 0, endMs)
    if (sliced.sampleRate <= 0 || sliced.samples.length === 0) {
      throw new Error('No audio samples decoded for download.')
    }
    const blob = encodeWavPcm16Mono(sliced.samples, sliced.sampleRate)
    const iso = new Date(session.startedAt ?? Date.now()).toISOString().replace(/[:.]/g, '-')

    return {
      kind: 'session',
      sessionId: session.id,
      startMs: sliced.startMs,
      endMs: sliced.endMs,
      durationMs: sliced.durationMs,
      mimeType: blob.type,
      blob,
      suggestedFilename: `${iso}_session.wav`,
    }
  }

  async inspectRange(
    session: SessionRecord,
    startMs: number,
    endMs: number,
    _mimeTypeHint?: string | null,
  ): Promise<RecordingRangeInspection> {
    const sliced = await this.#decodeRangeToMonoSamples(session, startMs, endMs)
    const { samples, sampleRate } = sliced
    const sampleCount = samples.length
    let sumSquares = 0
    let peak = 0
    for (let i = 0; i < sampleCount; i += 1) {
      const value = samples[i]
      sumSquares += value * value
      const abs = Math.abs(value)
      if (abs > peak) peak = abs
    }
    const rms = sampleCount > 0 ? Math.sqrt(sumSquares / sampleCount) : 0

    return {
      startMs: sliced.startMs,
      endMs: sliced.endMs,
      durationMs: sliced.durationMs,
      sampleRate,
      sampleCount,
      rms,
      peak,
    }
  }

  async getSnipAudio(session: SessionRecord, snipNumber: number, mimeTypeHint?: string | null): Promise<RecordingAudioSlice | null> {
    const snips = await this.listSnips(session, mimeTypeHint)
    const index = snipNumber - 1
    const snip = snips[index]
    if (!snip) return null
    return await this.getRangeAudio(session, snip.startMs, snip.endMs, mimeTypeHint)
  }

  clearSession(sessionId: string): void {
    void sessionId
  }
}

export const recordingSlicesApi = new RecordingSlicesApi()

