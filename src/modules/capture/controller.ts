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
  #lastChunkEndMs = 0
  #chunkDurationMs = 0
  #mimeType: string | null = null
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
    this.#mimeType = mimeType
    const startedAt = Date.now()
    this.#lastChunkEndMs = startedAt

    recorder.addEventListener('dataavailable', (event) => {
      const data = event.data
      if (!data || data.size === 0 || !this.#sessionId) {
        if (data && data.size === 0) {
          const trackStates =
            this.#stream?.getAudioTracks().map((track) => ({
              id: track.id,
              enabled: track.enabled,
              muted: track.muted,
              readyState: track.readyState,
            })) ?? []

          void logWarn('Received empty audio chunk', {
            sessionId: this.#sessionId,
            seq: this.#chunkSeq,
            mimeType: this.#mimeType,
            recorderState: recorder.state,
            timecode: typeof event.timecode === 'number' ? event.timecode : null,
            trackStates,
            requestedTimesliceMs: this.#chunkDurationMs,
          })
        }
        return
      }
      const seq = this.#chunkSeq++
      const chunkStart = this.#lastChunkEndMs
      const hasTimecode = typeof event.timecode === 'number' && Number.isFinite(event.timecode)
      const fallbackDuration = Math.max(32, Date.now() - chunkStart)
      const chunkDuration = hasTimecode ? Math.max(0, event.timecode) : fallbackDuration
      const isFirstChunk = seq === 0
      const isHeaderChunk = isFirstChunk && (!hasTimecode || event.timecode === 0 || data.size < 2048)
      const chunkEnd = isHeaderChunk ? chunkStart : chunkStart + chunkDuration
      this.#lastChunkEndMs = chunkEnd
      void logDebug('Chunk captured', {
        sessionId: this.#sessionId,
        seq,
        size: data.size,
        durationMs: chunkEnd - chunkStart,
        isHeaderChunk,
      })
      this.#persistQueue = this.#persistQueue
        .then(() =>
          manifestService.appendChunk(
            {
              id: `${this.#sessionId}-chunk-${seq}`,
              sessionId: this.#sessionId!,
              seq,
              startMs: chunkStart,
              endMs: chunkEnd,
            },
            data,
          ),
        )
        .then(() => {
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
  }

  async stop(): Promise<void> {
    const recorder = this.#mediaRecorder
    if (!recorder) {
      return
    }

    this.#setState({ state: 'stopping' })
    const sessionId = this.#sessionId

    if (recorder.state === 'recording') {
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
    }
  }

  async flushPending(): Promise<void> {
    await this.#persistQueue
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
  }

  subscribe(listener: (state: CaptureStateSnapshot) => void): () => void {
    this.#listeners.add(listener)
    listener(this.#state)
    return () => this.#listeners.delete(listener)
  }
}

export const captureController: CaptureController = new BrowserCaptureController()
