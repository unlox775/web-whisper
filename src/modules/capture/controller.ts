import { manifestService } from '../storage/manifest'

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
  error?: string
}

export interface CaptureController {
  readonly state: CaptureStateSnapshot
  start(options: CaptureStartOptions): Promise<void>
  stop(): Promise<void>
  flushPending(): Promise<void>
  attachAnalysisPort(port: MessagePort): void
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
  #state: CaptureStateSnapshot = {
    sessionId: null,
    state: 'idle',
    startedAt: null,
    lastChunkAt: null,
    bytesBuffered: 0,
    mimeType: null,
  }

  get state(): CaptureStateSnapshot {
    return this.#state
  }

  #setState(patch: Partial<CaptureStateSnapshot>) {
    this.#state = { ...this.#state, ...patch }
  }

  async start(options: CaptureStartOptions): Promise<void> {
    if (this.#mediaRecorder) {
      throw new Error('Recorder already running')
    }

    this.#setState({ state: 'starting', error: undefined })

    await manifestService.init()

    const stream = await navigator.mediaDevices.getUserMedia(AUDIO_CONSTRAINTS)
    const mimeType = selectMimeType(options.mimeType)

    const recorder = new MediaRecorder(stream, {
      mimeType,
      audioBitsPerSecond: options.targetBitrate,
    })

    this.#stream = stream
    this.#mediaRecorder = recorder
    this.#sessionId = options.sessionId
    this.#chunkSeq = 0
    const startedAt = Date.now()
    this.#lastChunkEndMs = startedAt

    recorder.addEventListener('dataavailable', (event) => {
      const data = event.data
      if (!data || data.size === 0 || !this.#sessionId) {
        return
      }
      const seq = this.#chunkSeq++
      const chunkStart = this.#lastChunkEndMs
      const chunkEnd = Date.now()
      this.#lastChunkEndMs = chunkEnd
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
          this.#setState({ lastChunkAt: Date.now(), bytesBuffered: this.#state.bytesBuffered + data.size })
        })
        .catch((error) => {
          console.error('[CaptureController] Failed to persist chunk', error)
          this.#setState({ state: 'error', error: error instanceof Error ? error.message : String(error) })
        })
    })

    recorder.addEventListener('stop', () => {
      this.#cleanupStream()
      this.#setState({ state: 'idle', sessionId: null, mimeType: null })
    })

    recorder.addEventListener('error', (event) => {
      console.error('[CaptureController] Recorder error', event)
      this.#setState({ state: 'error', error: event.error?.message ?? 'Recorder error' })
    })

    recorder.start(options.chunkDurationMs)
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
    })
  }

  async stop(): Promise<void> {
    if (!this.#mediaRecorder) {
      return
    }
    this.#setState({ state: 'stopping' })
    const recorder = this.#mediaRecorder
    if (recorder.state !== 'inactive') {
      recorder.stop()
    }
    await this.flushPending()
    const sessionId = this.#sessionId
    this.#sessionId = null
    this.#mediaRecorder = null
    if (sessionId) {
      await manifestService.updateSession(sessionId, {
        status: 'ready',
        updatedAt: Date.now(),
      })
    }
    this.#setState({ state: 'idle' })
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
  }
}

export const captureController: CaptureController = new BrowserCaptureController()
