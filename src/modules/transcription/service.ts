export interface TranscriptionJobRequest {
  jobId: string
  sessionId: string
  snipIds: string[]
  windowStartMs: number
  windowEndMs: number
  overlapMs: number
}

export interface TranscriptionResultPayload {
  jobId: string
  text: string
  words: Array<{ text: string; startMs: number; endMs: number }>
}

export interface TranscriptionService {
  enqueue(request: TranscriptionJobRequest): Promise<void>
  cancel(jobId: string): Promise<void>
  refreshSettings(): void
}

class MockTranscriptionService implements TranscriptionService {
  async enqueue(request: TranscriptionJobRequest): Promise<void> {
    console.info('[MockTranscriptionService] enqueue', request.jobId)
    throw new Error('Transcription service not yet connected to Groq')
  }

  async cancel(jobId: string): Promise<void> {
    console.info('[MockTranscriptionService] cancel', jobId)
  }

  refreshSettings(): void {
    console.info('[MockTranscriptionService] refreshSettings noop')
  }
}

export const transcriptionService: TranscriptionService = new MockTranscriptionService()
