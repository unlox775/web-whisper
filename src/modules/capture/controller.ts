import { computeChunkVolumeProfile } from '../storage/chunk-volume'
import { manifestService, type SessionRecord, type SessionStatus } from '../storage/manifest'
import { logDebug, logError, logInfo, logWarn } from '../logging/logger'

export type RecorderState = 'idle' | 'starting' | 'recording' | 'stopping' | 'error'

export interface CaptureStartOptions {
  sessionId: string
  targetBitrate: number
  chunkDurationMs: number
  mimeType?: string
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
  attachAnalysisPort(port: MessagePort): void
  subscribe(listener: (state: CaptureStateSnapshot) => void): () => void
}

const AUDIO_CONSTRAINTS: MediaStreamConstraints = {
  audio: {
    echoCancellation: false,
    noiseSuppression: false,
    autoGainControl: false,
  },
}

const AAC_MIME = 'audio/mp4'
const AAC_HE_MIME = 'audio/mp4;codecs=mp4a.40.5'
const AAC_LC_MIME = 'audio/mp4;codecs=mp4a.40.2'
const OPUS_WEBM_MIME = 'audio/webm;codecs=opus'

const NO_AUDIO_TIMEOUT_MS = 9_000
const AUDIO_DETECTION_MAX_THRESHOLD = 0.003
const AUDIO_DETECTION_AVERAGE_THRESHOLD = 0.0008
const MAX_CONSECUTIVE_SILENT_CHUNKS = 3
const MIN_ELAPSED_FOR_SILENT_ABORT_MS = 4000

function selectMimeType(preferred?: string): string {
  const candidates = preferred
    ? [preferred]
    : [AAC_MIME, AAC_LC_MIME, AAC_HE_MIME, OPUS_WEBM_MIME, '']
  for (const mime of candidates) {
    if (!mime) continue
    if (MediaRecorder.isTypeSupported(mime)) {
      return mime
    }
  }
  if (MediaRecorder.isTypeSupported('audio/webm')) {
    return 'audio/webm'
  }
  throw new Error('No supported audio mime type for MediaRecorder')
}

class BrowserCaptureController implements CaptureController {
  #mediaRecorder: MediaRecorder | null = null
  #stream: MediaStream | null = null
  #sessionId: string | null = null
  #chunkSeq = 0
  #analysisPort: MessagePort | null = null
  #persistQueue: Promise<void> = Promise.resolve()
  #recorderStartedAt = 0
  #lastChunkEndMs = 0
  #chunkDurationMs = 0
  #mimeType: string | null = null
  #headerChunkBlob: Blob | null = null
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
  #audioFlowDetected = false
  #healthCheckIntervalId: number | null = null
  #healthAbortIssued = false
  #silentChunkCount = 0
  #consecutiveSilentChunks = 0

  get state(): CaptureStateSnapshot {
    return this.#state
  }

  #setState(patch: Partial<CaptureStateSnapshot>) {
    this.#state = { ...this.#state, ...patch }
    this.#listeners.forEach((listener) => listener(this.#state))
  }

  async start(options: CaptureStartOptions): Promise<void> {
    if (this.#mediaRecorder) {
      throw new Error('Recorder already running')
    }

    this.#setState({ state: 'starting', error: undefined })

    await manifestService.init()

    await logInfo('Requesting microphone stream')
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia(AUDIO_CONSTRAINTS)
    } catch (error) {
      await logError('Microphone stream request failed', {
        error: error instanceof Error ? error.message : String(error),
      })
      throw error
    }
    await logInfo('Microphone stream acquired', {
      tracks: stream.getAudioTracks().map((track) => ({ id: track.id, label: track.label })),
    })
    const mimeType = selectMimeType(options.mimeType)

    const recorder = new MediaRecorder(stream, {
      mimeType,
      audioBitsPerSecond: options.targetBitrate,
    })

    this.#stream = stream
    this.#mediaRecorder = recorder
    this.#sessionId = options.sessionId
    this.#chunkDurationMs = options.chunkDurationMs
    this.#chunkSeq = 0
    this.#headerChunkBlob = null
    this.#mimeType = mimeType
    const startedAt = Date.now()
    await logInfo('Started At:', {
      startedAt: startedAt
    })
    this.#recorderStartedAt = startedAt
    this.#lastChunkEndMs = startedAt

    recorder.addEventListener('dataavailable', (event) => {
      const data = event.data
      if (!data || !this.#sessionId) {
        return
      }
      const seq = this.#chunkSeq++
      const chunkStart = this.#lastChunkEndMs
      const manualTimecode = chunkStart - this.#recorderStartedAt
      const chunkDuration = data.size === 0 ? 0 : Date.now() - chunkStart
      const isFirstChunk = seq === 0
      const isHeaderChunk = isFirstChunk && (event.timecode === 0 || data.size < 2048)
      const chunkEnd = isHeaderChunk ? chunkStart : chunkStart + chunkDuration

      if (data.size === 0 && !isHeaderChunk) {
        const trackStates =
          this.#stream?.getAudioTracks().map((track) => ({
            id: track.id,
            enabled: track.enabled,
            muted: track.muted,
            readyState: track.readyState,
          })) ?? []

        void logWarn('Received empty audio chunk', {
          sessionId: this.#sessionId,
          seq,
          mimeType: this.#mimeType,
          recorderState: recorder.state,
          timecode: typeof event.timecode === 'number' ? event.timecode : null,
          trackStates,
          requestedTimesliceMs: this.#chunkDurationMs,
        })
        this.#registerSilentChunk('dataavailable-empty', {
          seq,
          elapsedMs: Date.now() - this.#recorderStartedAt,
        })
      }

      this.#lastChunkEndMs = chunkEnd
      if (isHeaderChunk) {
        this.#headerChunkBlob = data
      }
      void logDebug('Chunk captured', {
        sessionId: this.#sessionId,
        seq,
        size: data.size,
        durationMs: chunkEnd - chunkStart,
        isHeaderChunk,
        chunkStartMs: chunkStart,
        chunkEndMs: chunkEnd,
        timecode: manualTimecode,
      })
      const chunkId = `${this.#sessionId}-chunk-${seq}`
      this.#persistQueue = this.#persistQueue
        .then(() =>
          manifestService.appendChunk(
            {
              id: chunkId,
              sessionId: this.#sessionId!,
              seq,
              startMs: chunkStart,
              endMs: chunkEnd,
              verifiedAudioMsec: isHeaderChunk ? 0 : null,
            },
            data,
          ),
        )
        .then(async () => {
          this.#setState({
            lastChunkAt: chunkEnd,
            bytesBuffered: this.#state.bytesBuffered + data.size,
            chunksRecorded: this.#state.chunksRecorded + 1,
          })
          void logInfo('Chunk persisted', {
            sessionId: this.#sessionId,
            seq,
            size: data.size,
            startMs: chunkStart,
            endMs: chunkEnd,
          })
          if (!isHeaderChunk && data.size > 0 && chunkEnd > chunkStart) {
            try {
              let analysisBlob: Blob = data
              const headerBlob = this.#headerChunkBlob
              const mime = this.#mimeType ?? data.type
              if (headerBlob && mime && /mp4/i.test(mime)) {
                analysisBlob = new Blob([headerBlob, data], { type: headerBlob.type || data.type || mime })
              }
              const profile = await computeChunkVolumeProfile(analysisBlob, {
                chunkId,
                sessionId: this.#sessionId!,
                seq,
                chunkStartMs: chunkStart,
                chunkEndMs: chunkEnd,
              })
              const { maxNormalized, averageNormalized, frames } = profile
              const hasFrameEnergy = frames.some((value) => value >= AUDIO_DETECTION_AVERAGE_THRESHOLD)
              const hasAudio =
                maxNormalized >= AUDIO_DETECTION_MAX_THRESHOLD ||
                averageNormalized >= AUDIO_DETECTION_AVERAGE_THRESHOLD ||
                hasFrameEnergy
              await manifestService.storeChunkVolumeProfile(profile)
              if (hasAudio) {
                this.#registerHealthyChunk({
                  seq,
                  maxNormalized,
                  averageNormalized,
                })
              } else {
                this.#registerSilentChunk('chunk-silent', {
                  seq,
                  maxNormalized,
                  averageNormalized,
                  frameCount: frames.length,
                })
              }
              void logDebug('Chunk volume profile stored', {
                sessionId: this.#sessionId,
                seq,
                frameCount: frames.length,
              })
            } catch (error) {
              this.#registerSilentChunk('analysis-failed', {
                seq,
                error: error instanceof Error ? error.message : String(error),
              })
              void logWarn('Chunk volume profile failed', {
                sessionId: this.#sessionId,
                seq,
                error: error instanceof Error ? error.message : String(error),
              })
            }
          } else if (!isHeaderChunk) {
            void logDebug('Persisted zero-length chunk', {
              sessionId: this.#sessionId,
              seq,
              dataSize: data.size,
              durationMs: chunkEnd - chunkStart,
            })
          }
        })
        .catch((error) => {
          console.error('[CaptureController] Failed to persist chunk', error)
          this.#setState({ state: 'error', error: error instanceof Error ? error.message : String(error) })
          void logError('Chunk persistence failed', {
            sessionId: this.#sessionId,
            seq,
            error: error instanceof Error ? error.message : String(error),
          })
        })
    })

    recorder.addEventListener('stop', () => {
      void logInfo('MediaRecorder stop event fired', { sessionId: this.#sessionId })
      if (this.#state.state !== 'stopping') {
        this.#cleanupStream()
        this.#setState({ state: 'idle', sessionId: null, mimeType: null })
      }
    })

    recorder.addEventListener('error', (event) => {
      console.error('[CaptureController] Recorder error', event)
      this.#clearNoAudioTimer()
      this.#setState({ state: 'error', error: event.error?.message ?? 'Recorder error' })
      void logError('MediaRecorder error', {
        sessionId: this.#sessionId,
        error: event.error?.message,
      })
    })

    recorder.start(options.chunkDurationMs)
    void logInfo('MediaRecorder started', {
      sessionId: options.sessionId,
      mimeType,
      timeslice: options.chunkDurationMs,
    })
    void manifestService.updateSession(options.sessionId, {
      mimeType,
      status: 'recording',
      updatedAt: startedAt,
    })
    this.#setState({
      state: 'recording',
      sessionId: options.sessionId,
      startedAt,
      mimeType,
      bytesBuffered: 0,
      lastChunkAt: null,
      chunksRecorded: 0,
    })
    this.#audioFlowDetected = false
    this.#healthAbortIssued = false
    this.#silentChunkCount = 0
    this.#consecutiveSilentChunks = 0
    this.#clearHealthInterval()
    this.#healthCheckIntervalId = window.setInterval(() => this.#runHealthCheck(), 3000)
    this.#armNoAudioTimer()
  }

  async stop(): Promise<void> {
    const recorder = this.#mediaRecorder
    if (!recorder) {
      return
    }

    this.#clearNoAudioTimer()
    this.#clearHealthInterval()
    this.#setState({ state: 'stopping' })
    const sessionId = this.#sessionId

    if (recorder.state === 'recording') {
      void logInfo('Flush initiated before stop', {
        sessionId: sessionId ?? this.#sessionId,
        recorderState: recorder.state,
      })
      await this.#flushRecorder(recorder)
    }

    if (recorder.state !== 'inactive') {
      await new Promise<void>((resolve) => {
        recorder.addEventListener('stop', () => resolve(), { once: true })
        try {
          recorder.stop()
        } catch (error) {
          console.warn('[CaptureController] stop() threw before inactive state', error)
          resolve()
        }
      })
    }

    await this.flushPending()

    let sessionNotes: string | undefined
    if (sessionId) {
      const chunkMetadata = await manifestService.getChunkMetadata(sessionId)
      const hasPlayableChunk = chunkMetadata.some(
        (chunk) => chunk.seq > 0 && chunk.byteLength > 0 && chunk.endMs > chunk.startMs,
      )
      const status: SessionStatus = hasPlayableChunk ? 'ready' : 'error'
      const playableChunks = chunkMetadata.filter((chunk) => chunk.seq > 0 && chunk.endMs > chunk.startMs)
      const durationMs = playableChunks.length > 0 ? playableChunks[playableChunks.length - 1].endMs - playableChunks[0].startMs : 0
      const totalBytes = chunkMetadata.reduce((sum, chunk) => sum + chunk.byteLength, 0)

      if (!hasPlayableChunk) {
        sessionNotes = chunkMetadata.length === 0
          ? 'Error: no audio captured. Check microphone access and try again.'
          : 'Error: captured audio contained no playable samples.'

        await logError('Session completed without playable audio', {
          sessionId,
          chunkCount: chunkMetadata.length,
          totalBytes,
          mimeType: this.#mimeType,
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

    this.#cleanupStream()

    this.#mediaRecorder = null
    this.#sessionId = null
    this.#chunkDurationMs = 0

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

  async #flushRecorder(recorder: MediaRecorder): Promise<void> {
    let chunkCaptured = false
    let resolvedByTimeout = false

    const waitForChunk = new Promise<void>((resolve) => {
      const timeout = window.setTimeout(() => {
        resolvedByTimeout = true
        cleanup()
        resolve()
      }, 1200)

      const handleData = (event: BlobEvent) => {
        if (!event.data || event.data.size === 0) {
          return
        }
        chunkCaptured = true
        cleanup()
        resolve()
      }

      const handleStopOrError = () => {
        cleanup()
        resolve()
      }

      const cleanup = () => {
        window.clearTimeout(timeout)
        recorder.removeEventListener('dataavailable', handleData)
        recorder.removeEventListener('stop', handleStopOrError)
        recorder.removeEventListener('error', handleStopOrError)
      }

      recorder.addEventListener('dataavailable', handleData)
      recorder.addEventListener('stop', handleStopOrError, { once: true })
      recorder.addEventListener('error', handleStopOrError, { once: true })
    })

    try {
      recorder.requestData()
      void logDebug('requestData issued for final flush', {
        sessionId: this.#sessionId,
        recorderState: recorder.state,
      })
    } catch (error) {
      console.warn('[CaptureController] requestData failed during flush', error)
      return
    }

    await waitForChunk

    if (!chunkCaptured) {
      await logWarn('Final flush completed without non-empty chunk', {
        sessionId: this.#sessionId,
        reason: resolvedByTimeout ? 'timeout' : 'stop-event',
      })
    } else {
      await logInfo('Final flush produced chunk', {
        sessionId: this.#sessionId,
      })
    }
  }

  async flushPending(): Promise<void> {
    await this.#persistQueue
  }

  #clearHealthInterval() {
    if (this.#healthCheckIntervalId !== null) {
      window.clearInterval(this.#healthCheckIntervalId)
      this.#healthCheckIntervalId = null
    }
  }

  #runHealthCheck() {
    if (this.#state.state !== 'recording' || this.#healthAbortIssued) {
      return
    }
    const tracks = this.#stream?.getAudioTracks() ?? []
    if (tracks.length === 0) {
      void this.#handleUnhealthyStream('no-active-tracks', {
        elapsedMs: Date.now() - this.#recorderStartedAt,
      })
      return
    }
    const problematicTrack = tracks.find((track) => track.readyState !== 'live' || track.muted)
    if (problematicTrack) {
      void this.#handleUnhealthyStream('track-unhealthy', {
        trackId: problematicTrack.id,
        readyState: problematicTrack.readyState,
        muted: problematicTrack.muted,
        enabled: problematicTrack.enabled,
      })
      return
    }
    if (!this.#audioFlowDetected) {
      const elapsed = Date.now() - this.#recorderStartedAt
      if (elapsed > NO_AUDIO_TIMEOUT_MS && this.#state.chunksRecorded <= 1) {
        void this.#handleUnhealthyStream('no-chunks-produced', {
          elapsedMs: elapsed,
          chunksRecorded: this.#state.chunksRecorded,
        })
      }
    }
  }

  #registerHealthyChunk(details: { seq: number; maxNormalized: number; averageNormalized: number }) {
    this.#silentChunkCount = 0
    this.#consecutiveSilentChunks = 0
    void logDebug('Chunk passed audio health check', {
      sessionId: this.#sessionId,
      seq: details.seq,
      maxNormalized: details.maxNormalized,
      averageNormalized: details.averageNormalized,
    })
    this.#markAudioDetected({
      maxNormalized: details.maxNormalized,
      averageNormalized: details.averageNormalized,
    })
  }

  #registerSilentChunk(reason: string, details: Record<string, unknown>) {
    if (this.#healthAbortIssued || this.#state.state !== 'recording') {
      return
    }
    const elapsed = Date.now() - this.#recorderStartedAt
    this.#silentChunkCount += 1
    this.#consecutiveSilentChunks += 1
    const payload = {
      sessionId: this.#sessionId,
      reason,
      silentChunkCount: this.#silentChunkCount,
      consecutiveSilentChunks: this.#consecutiveSilentChunks,
      elapsedMs: elapsed,
      ...details,
    }
    if (this.#consecutiveSilentChunks >= MAX_CONSECUTIVE_SILENT_CHUNKS && elapsed >= MIN_ELAPSED_FOR_SILENT_ABORT_MS) {
      void logWarn('Silent chunk detected', payload)
      void this.#handleUnhealthyStream('consecutive-silent-chunks', payload)
    } else {
      void logDebug('Silent chunk detected', payload)
    }
  }

  async #handleUnhealthyStream(reason: string, details: Record<string, unknown> = {}) {
    if (this.#healthAbortIssued) {
      return
    }
    this.#healthAbortIssued = true
    this.#clearNoAudioTimer()
    this.#clearHealthInterval()
    await logWarn('Capture stream unhealthy — aborting', {
      sessionId: this.#sessionId,
      reason,
      ...details,
    })
    await this.#playWarningTone().catch(() => undefined)
    this.#setState({ error: 'No audio detected — recording stopped.' })
    if (this.#state.state === 'recording' || this.#state.state === 'starting') {
      void Promise.resolve()
        .then(() => this.stop())
        .catch((error) => {
          console.error('[CaptureController] Failed to stop after stream health abort', error)
          void logError('Capture abort stop failed', {
            sessionId: this.#sessionId,
            reason,
            error: error instanceof Error ? error.message : String(error),
          })
        })
    }
  }

  #armNoAudioTimer() {
    this.#clearNoAudioTimer()
    if (this.#state.state !== 'recording') {
      return
    }
    this.#noAudioTimeoutId = window.setTimeout(() => {
      void this.#handleNoAudioTimeout()
    }, NO_AUDIO_TIMEOUT_MS)
  }

  #clearNoAudioTimer() {
    if (this.#noAudioTimeoutId !== null) {
      window.clearTimeout(this.#noAudioTimeoutId)
      this.#noAudioTimeoutId = null
    }
  }

  #markAudioDetected(details?: { maxNormalized?: number; averageNormalized?: number }) {
    if (this.#audioFlowDetected) {
      return
    }
    this.#audioFlowDetected = true
    this.#clearNoAudioTimer()
    void logInfo('Audio flow detected', {
      sessionId: this.#sessionId,
      elapsedMs: Date.now() - this.#recorderStartedAt,
      maxNormalized: details?.maxNormalized ?? null,
      averageNormalized: details?.averageNormalized ?? null,
    })
  }

  async #handleNoAudioTimeout() {
    this.#noAudioTimeoutId = null
    if (this.#audioFlowDetected || this.#state.state !== 'recording' || !this.#sessionId || this.#healthAbortIssued) {
      return
    }
    await this.#handleUnhealthyStream('no-audio-timeout', {
      elapsedMs: Date.now() - this.#recorderStartedAt,
      chunksRecorded: this.#state.chunksRecorded,
    })
  }

  async #playWarningTone() {
    try {
      const AudioContextCtor =
        window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (typeof AudioContextCtor !== 'function') {
        return
      }
      const context = new AudioContextCtor()
      await context.resume().catch(() => undefined)
      const oscillator = context.createOscillator()
      const gain = context.createGain()
      oscillator.type = 'sine'
      oscillator.frequency.value = 660
      gain.gain.value = 0.05
      oscillator.connect(gain)
      gain.connect(context.destination)
      oscillator.start()
      await new Promise<void>((resolve) => window.setTimeout(resolve, 550))
      oscillator.stop()
      await new Promise<void>((resolve) => {
        oscillator.addEventListener('ended', () => resolve(), { once: true })
      })
      await context.close()
    } catch (error) {
      console.warn('[CaptureController] Warning tone failed', error)
    }
  }

  attachAnalysisPort(port: MessagePort): void {
    this.#analysisPort = port
    this.#analysisPort.start()
  }

  #cleanupStream() {
    if (this.#stream) {
      this.#stream.getTracks().forEach((track) => track.stop())
      this.#stream = null
    }
    if (this.#analysisPort) {
      this.#analysisPort.close()
      this.#analysisPort = null
    }
    this.#mimeType = null
    this.#clearHealthInterval()
  }

  subscribe(listener: (state: CaptureStateSnapshot) => void): () => void {
    this.#listeners.add(listener)
    listener(this.#state)
    return () => this.#listeners.delete(listener)
  }
}

export const captureController: CaptureController = new BrowserCaptureController()
