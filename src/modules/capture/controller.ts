import { ensureMp3EncoderLoaded, getMp3EncoderCtor } from './mp3-encoder'
import { computeChunkVolumeProfile } from '../storage/chunk-volume'
import { manifestService, type SessionRecord, type SessionStatus } from '../storage/manifest'
import { logDebug, logError, logInfo, logWarn } from '../logging/logger'

export type RecorderState = 'idle' | 'starting' | 'recording' | 'stopping' | 'error'

export interface CaptureStartOptions {
  sessionId: string
  /** Target MP3 bitrate in bits/sec (e.g., 64000). */
  targetBitrate: number
  chunkDurationMs: number
}

export interface CaptureStateSnapshot {
  sessionId: string | null
  state: RecorderState
  startedAt: number | null
  lastChunkAt: number | null
  bytesBuffered: number
  mimeType: string | null
  chunksRecorded: number
  error?: string
}

export interface CaptureController {
  readonly state: CaptureStateSnapshot
  start(options: CaptureStartOptions): Promise<void>
  stop(): Promise<void>
  flushPending(): Promise<void>
  attachAnalysisPort(_port: MessagePort): void
  subscribe(listener: (state: CaptureStateSnapshot) => void): () => void
}

const AUDIO_CONSTRAINTS: MediaStreamConstraints = {
  audio: {
    echoCancellation: false,
    noiseSuppression: false,
    autoGainControl: false,
  },
}

const MP3_MIME = 'audio/mpeg'
const NO_AUDIO_TIMEOUT_MS = 9_000

const floatToInt16 = (input: Float32Array): Int16Array => {
  const out = new Int16Array(input.length)
  for (let i = 0; i < input.length; i += 1) {
    const s = Math.max(-1, Math.min(1, input[i]))
    out[i] = s < 0 ? Math.round(s * 0x8000) : Math.round(s * 0x7fff)
  }
  return out
}

class PcmMp3CaptureController implements CaptureController {
  #stream: MediaStream | null = null
  #audioContext: AudioContext | null = null
  #source: MediaStreamAudioSourceNode | null = null
  #processor: ScriptProcessorNode | null = null
  #muteGain: GainNode | null = null
  #sessionId: string | null = null
  #chunkSeq = 0
  #persistQueue: Promise<void> = Promise.resolve()
  #startedAt = 0
  #sampleRate = 48_000
  #targetKbps = 64
  #chunkTargetSamples = 0
  #totalSamplesWritten = 0
  #pendingBlocks: Int16Array[] = []
  #pendingSamples = 0
  #listeners = new Set<(state: CaptureStateSnapshot) => void>()
  #state: CaptureStateSnapshot = {
    sessionId: null,
    state: 'idle',
    startedAt: null,
    lastChunkAt: null,
    bytesBuffered: 0,
    mimeType: null,
    chunksRecorded: 0,
  }
  #noAudioTimeoutId: number | null = null
  #hasSeenAudioProcess = false

  get state(): CaptureStateSnapshot {
    return this.#state
  }

  #setState(patch: Partial<CaptureStateSnapshot>) {
    this.#state = { ...this.#state, ...patch }
    this.#listeners.forEach((listener) => listener(this.#state))
  }

  async start(options: CaptureStartOptions): Promise<void> {
    if (this.#state.state === 'recording' || this.#state.state === 'starting') {
      throw new Error('Recorder already running')
    }

    this.#setState({ state: 'starting', error: undefined })
    await manifestService.init()

    await logInfo('Requesting microphone stream')
    const stream = await navigator.mediaDevices.getUserMedia(AUDIO_CONSTRAINTS)
    await logInfo('Microphone stream acquired', {
      tracks: stream.getAudioTracks().map((track) => ({ id: track.id, label: track.label })),
    })

    const AudioContextCtor =
      window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (typeof AudioContextCtor !== 'function') {
      throw new Error('AudioContext unavailable')
    }
    const context = new AudioContextCtor()
    await context.resume().catch(() => undefined)

    const source = context.createMediaStreamSource(stream)
    const processor = context.createScriptProcessor(4096, 1, 1)
    const muteGain = context.createGain()
    muteGain.gain.value = 0

    source.connect(processor)
    processor.connect(muteGain)
    muteGain.connect(context.destination)

    this.#stream = stream
    this.#audioContext = context
    this.#source = source
    this.#processor = processor
    this.#muteGain = muteGain
    this.#sessionId = options.sessionId
    this.#chunkSeq = 0
    this.#pendingBlocks = []
    this.#pendingSamples = 0
    this.#totalSamplesWritten = 0
    this.#startedAt = Date.now()
    this.#sampleRate = context.sampleRate
    this.#targetKbps = Math.max(8, Math.round(options.targetBitrate / 1000))
    this.#chunkTargetSamples = Math.max(1, Math.round((options.chunkDurationMs / 1000) * this.#sampleRate))
    this.#hasSeenAudioProcess = false

    await logInfo('PCM capture started', {
      sessionId: options.sessionId,
      startedAt: this.#startedAt,
      sampleRate: this.#sampleRate,
      chunkDurationMs: options.chunkDurationMs,
      mp3Kbps: this.#targetKbps,
    })

    // Ensure MP3 encoder is available before we start producing chunks.
    await ensureMp3EncoderLoaded()

    // Update the session start time to the actual moment PCM capture begins (after mic + audio graph setup),
    // so session.durationMs and subsequent range-based logic do not include setup latency.
    await manifestService.updateSession(options.sessionId, {
      startedAt: this.#startedAt,
      updatedAt: this.#startedAt,
      mimeType: MP3_MIME,
      status: 'recording',
    })

    // Keep state update here to reflect the updated startedAt.
    this.#setState({
      state: 'recording',
      sessionId: options.sessionId,
      startedAt: this.#startedAt,
      lastChunkAt: this.#startedAt,
      mimeType: MP3_MIME,
      bytesBuffered: 0,
      chunksRecorded: 0,
    })

    processor.onaudioprocess = (event) => {
      if (!this.#sessionId || this.#state.state !== 'recording') return
      this.#hasSeenAudioProcess = true
      const input = event.inputBuffer.getChannelData(0)
      const block = floatToInt16(input)
      this.#pendingBlocks.push(block)
      this.#pendingSamples += block.length
      if (this.#pendingSamples >= this.#chunkTargetSamples) {
        void this.#flushFullChunk().catch((error) => {
          console.error('[PCM Capture] chunk flush failed', error)
          this.#setState({ state: 'error', error: error instanceof Error ? error.message : String(error) })
          void logError('PCM chunk flush failed', {
            sessionId: this.#sessionId,
            error: error instanceof Error ? error.message : String(error),
          })
        })
      }
    }

    this.#armNoAudioTimer()
  }

  async #flushFullChunk(): Promise<void> {
    if (!this.#sessionId) return
    if (this.#pendingSamples < this.#chunkTargetSamples) return

    // Consume exactly chunkTargetSamples from the pending block queue.
    const target = this.#chunkTargetSamples
    const chunks: Int16Array[] = []
    let remaining = target
    while (remaining > 0 && this.#pendingBlocks.length > 0) {
      const head = this.#pendingBlocks[0]
      if (head.length <= remaining) {
        chunks.push(head)
        this.#pendingBlocks.shift()
        remaining -= head.length
      } else {
        chunks.push(head.subarray(0, remaining))
        this.#pendingBlocks[0] = head.subarray(remaining)
        remaining = 0
      }
    }
    this.#pendingSamples -= target

    await this.#persistPcmAsMp3Chunk(chunks)
  }

  async #flushRemainderChunk(): Promise<void> {
    if (!this.#sessionId) return
    if (this.#pendingSamples <= 0) return
    const chunks = this.#pendingBlocks
    this.#pendingBlocks = []
    this.#pendingSamples = 0
    await this.#persistPcmAsMp3Chunk(chunks)
  }

  async #persistPcmAsMp3Chunk(int16Blocks: Int16Array[]): Promise<void> {
    if (!this.#sessionId) return
    const sessionId = this.#sessionId
    const seq = this.#chunkSeq++

    const Mp3Encoder = getMp3EncoderCtor()
    const encoder = new Mp3Encoder(1, this.#sampleRate, this.#targetKbps)
    const mp3Parts: BlobPart[] = []
    let samplesEncoded = 0
    for (const block of int16Blocks) {
      if (block.length === 0) continue
      samplesEncoded += block.length
      const encoded = encoder.encodeBuffer(block)
      if (encoded.length > 0) {
        const bytes = new Uint8Array(encoded.length)
        bytes.set(encoded)
        mp3Parts.push(bytes)
      }
    }
    const flushed = encoder.flush()
    if (flushed.length > 0) {
      const bytes = new Uint8Array(flushed.length)
      bytes.set(flushed)
      mp3Parts.push(bytes)
    }
    const blob = new Blob(mp3Parts, { type: MP3_MIME })

    const chunkStartMs = this.#startedAt + Math.round((this.#totalSamplesWritten / this.#sampleRate) * 1000)
    const chunkEndMs = this.#startedAt + Math.round(((this.#totalSamplesWritten + samplesEncoded) / this.#sampleRate) * 1000)
    this.#totalSamplesWritten += samplesEncoded

    const chunkId = `${sessionId}-chunk-${seq}`
    void logDebug('PCM chunk encoded', {
      sessionId,
      seq,
      sampleRate: this.#sampleRate,
      samples: samplesEncoded,
      durationMs: chunkEndMs - chunkStartMs,
      mp3Bytes: blob.size,
      mp3Kbps: this.#targetKbps,
      chunkStartMs,
      chunkEndMs,
    })

    this.#persistQueue = this.#persistQueue
      .then(() =>
        manifestService.appendChunk(
          {
            id: chunkId,
            sessionId,
            seq,
            startMs: chunkStartMs,
            endMs: chunkEndMs,
            verifiedAudioMsec: null,
          },
          blob,
        ),
      )
      .then(async () => {
        this.#setState({
          lastChunkAt: chunkEndMs,
          bytesBuffered: this.#state.bytesBuffered + blob.size,
          chunksRecorded: this.#state.chunksRecorded + 1,
        })
        await logInfo('Chunk persisted', {
          sessionId,
          seq,
          size: blob.size,
          startMs: chunkStartMs,
          endMs: chunkEndMs,
          mimeType: MP3_MIME,
        })
        try {
          const profile = await computeChunkVolumeProfile(blob, {
            chunkId,
            sessionId,
            seq,
            chunkStartMs,
            chunkEndMs,
          })
          await manifestService.storeChunkVolumeProfile(profile)
          void logDebug('Chunk volume profile stored', {
            sessionId,
            seq,
            frameCount: profile.frames.length,
          })
        } catch (error) {
          void logWarn('Chunk volume profile failed', {
            sessionId,
            seq,
            error: error instanceof Error ? error.message : String(error),
          })
        }
      })
  }

  async stop(): Promise<void> {
    if (this.#state.state !== 'recording') {
      return
    }
    this.#setState({ state: 'stopping' })
    this.#clearNoAudioTimer()

    // Flush any remaining partial chunk before teardown.
    await this.#flushRemainderChunk()
    await this.flushPending()

    const sessionId = this.#sessionId
    let sessionNotes: string | undefined
    if (sessionId) {
      const chunkMetadata = await manifestService.getChunkMetadata(sessionId)
      const hasPlayableChunk = chunkMetadata.some((chunk) => chunk.byteLength > 0 && chunk.endMs > chunk.startMs)
      const status: SessionStatus = hasPlayableChunk ? 'ready' : 'error'
      const durationMs =
        chunkMetadata.length > 0 ? chunkMetadata[chunkMetadata.length - 1].endMs - chunkMetadata[0].startMs : 0
      const totalBytes = chunkMetadata.reduce((sum, chunk) => sum + chunk.byteLength, 0)

      if (!hasPlayableChunk) {
        sessionNotes = chunkMetadata.length === 0
          ? 'Error: no audio captured. Check microphone access and try again.'
          : 'Error: captured audio contained no playable samples.'
        await logError('Session completed without playable audio', {
          sessionId,
          chunkCount: chunkMetadata.length,
          totalBytes,
          mimeType: MP3_MIME,
        })
      }

      const updatePatch: Partial<SessionRecord> = {
        status,
        updatedAt: Date.now(),
        durationMs,
        totalBytes,
        chunkCount: chunkMetadata.length,
      }
      if (sessionNotes) {
        updatePatch.notes = sessionNotes
      }
      await manifestService.updateSession(sessionId, updatePatch)
      await logInfo('Session timing reconciled', {
        sessionId,
        status,
        durationMs,
        totalBytes,
        chunkCount: chunkMetadata.length,
        hasPlayableChunk,
      })
    }

    this.#cleanup()
    this.#sessionId = null
    this.#setState({
      state: 'idle',
      sessionId: null,
      startedAt: null,
      lastChunkAt: null,
      mimeType: null,
      chunksRecorded: 0,
      bytesBuffered: 0,
      error: sessionNotes,
    })
  }

  async flushPending(): Promise<void> {
    await this.#persistQueue
  }

  attachAnalysisPort(_port: MessagePort): void {
    // PCM path doesn't use an external analysis port yet.
  }

  #cleanup() {
    if (this.#processor) {
      this.#processor.onaudioprocess = null
      try {
        this.#processor.disconnect()
      } catch {}
      this.#processor = null
    }
    if (this.#source) {
      try {
        this.#source.disconnect()
      } catch {}
      this.#source = null
    }
    if (this.#muteGain) {
      try {
        this.#muteGain.disconnect()
      } catch {}
      this.#muteGain = null
    }
    if (this.#audioContext) {
      void this.#audioContext.close().catch(() => undefined)
      this.#audioContext = null
    }
    if (this.#stream) {
      this.#stream.getTracks().forEach((track) => track.stop())
      this.#stream = null
    }
  }

  #armNoAudioTimer() {
    this.#clearNoAudioTimer()
    this.#noAudioTimeoutId = window.setTimeout(() => {
      if (!this.#hasSeenAudioProcess && this.#state.state === 'recording') {
        this.#setState({ error: 'No audio detected — recording may be muted.' })
        void logWarn('No PCM audio callback detected within timeout', {
          sessionId: this.#sessionId,
          timeoutMs: NO_AUDIO_TIMEOUT_MS,
        })
      }
    }, NO_AUDIO_TIMEOUT_MS)
  }

  #clearNoAudioTimer() {
    if (this.#noAudioTimeoutId !== null) {
      window.clearTimeout(this.#noAudioTimeoutId)
      this.#noAudioTimeoutId = null
    }
  }

  subscribe(listener: (state: CaptureStateSnapshot) => void): () => void {
    this.#listeners.add(listener)
    listener(this.#state)
    return () => this.#listeners.delete(listener)
  }
}

export const captureController: CaptureController = new PcmMp3CaptureController()
