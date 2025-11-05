export interface UploadRequest {
  sessionId: string
  chunkId: string
  startMs: number
  endMs: number
  sequence: number
  blob: Blob
}

export interface UploadResult {
  chunkId: string
  status: 'success' | 'retry' | 'failed'
  retryInMs?: number
  error?: string
}

export interface UploadWorkerPort {
  enqueue(request: UploadRequest): void
  cancel(sessionId: string): void
  sync(): Promise<void>
}

class MockUploadWorkerPort implements UploadWorkerPort {
  enqueue(request: UploadRequest): void {
    console.info('[MockUploadWorker] enqueue', request.chunkId)
  }

  cancel(sessionId: string): void {
    console.info('[MockUploadWorker] cancel session', sessionId)
  }

  async sync(): Promise<void> {
    console.info('[MockUploadWorker] sync noop')
  }
}

export const uploadWorkerPort: UploadWorkerPort = new MockUploadWorkerPort()
