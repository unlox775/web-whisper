export type RecorderState = 'idle' | 'starting' | 'recording' | 'stopping' | 'error'

export interface CaptureStartOptions {
  sessionId: string
  targetBitrate: number
  chunkDurationMs: number
}

export interface CaptureStateSnapshot {
  sessionId: string | null
  state: RecorderState
  startedAt: number | null
  lastChunkAt: number | null
  bytesBuffered: number
  error?: string
}

export interface CaptureController {
  readonly state: CaptureStateSnapshot
  start(options: CaptureStartOptions): Promise<void>
  stop(): Promise<void>
  flushPending(): Promise<void>
  attachAnalysisPort(port: MessagePort): void
}

export class MockCaptureController implements CaptureController {
  readonly state: CaptureStateSnapshot = {
    sessionId: null,
    state: 'idle',
    startedAt: null,
    lastChunkAt: null,
    bytesBuffered: 0,
  }

  async start(options: CaptureStartOptions): Promise<void> {
    console.info('[MockCaptureController] start', options)
    throw new Error('Capture controller not yet implemented')
  }

  async stop(): Promise<void> {
    console.info('[MockCaptureController] stop')
    throw new Error('Capture controller not yet implemented')
  }

  async flushPending(): Promise<void> {
    console.info('[MockCaptureController] flushPending')
    throw new Error('Capture controller not yet implemented')
  }

  attachAnalysisPort(): void {
    console.info('[MockCaptureController] attachAnalysisPort (noop)')
  }
}

export const captureController = new MockCaptureController()
