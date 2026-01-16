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
  segments: TranscriptionSegment[]
}

export type TranscriptionSegment = [number, string]

export interface TranscriptionAudioRequest {
  apiKey: string
  audio: Blob
  model?: string
  language?: string
  temperature?: number
}

export interface TranscriptionAudioResult {
  text: string
  segments: TranscriptionSegment[]
  model: string
  language?: string | null
}

export interface TranscriptionService {
  enqueue(request: TranscriptionJobRequest): Promise<void>
  cancel(jobId: string): Promise<void>
  refreshSettings(): void
  transcribeAudio(request: TranscriptionAudioRequest): Promise<TranscriptionAudioResult>
}

type GroqResponseWord = {
  word?: string
  text?: string
  start?: number
  end?: number
}

type GroqResponseSegment = {
  text?: string
  start?: number
  end?: number
  words?: GroqResponseWord[]
}

type GroqTranscriptionResponse = {
  text?: string
  language?: string
  words?: GroqResponseWord[]
  segments?: GroqResponseSegment[]
}

const GROQ_TRANSCRIPTION_URL = 'https://api.groq.com/openai/v1/audio/transcriptions'
const DEFAULT_GROQ_MODEL = 'whisper-large-v3'

const normalizeSegment = (startSeconds: number | undefined, text: string | undefined): TranscriptionSegment | null => {
  const phrase = (text ?? '').trim()
  if (!phrase) return null
  const startMs = Number.isFinite(startSeconds) ? Math.max(0, (startSeconds ?? 0) * 1000) : 0
  return [startMs, phrase]
}

const extractSegments = (payload: GroqTranscriptionResponse): TranscriptionSegment[] => {
  const segments: TranscriptionSegment[] = []
  if (Array.isArray(payload.segments)) {
    payload.segments.forEach((segment) => {
      const normalized = normalizeSegment(segment.start, segment.text)
      if (normalized) segments.push(normalized)
    })
  }

  if (segments.length === 0 && Array.isArray(payload.words) && payload.words.length > 0) {
    const text = payload.words
      .map((word) => (word.word ?? word.text ?? '').trim())
      .filter((value) => value.length > 0)
      .join(' ')
      .trim()
    if (text) {
      const start = payload.words.find((word) => Number.isFinite(word.start))?.start
      const normalized = normalizeSegment(start, text)
      if (normalized) segments.push(normalized)
    }
  }

  if (segments.length === 0 && typeof payload.text === 'string') {
    const normalized = normalizeSegment(0, payload.text)
    if (normalized) segments.push(normalized)
  }

  return segments
}

class GroqTranscriptionService implements TranscriptionService {
  async enqueue(request: TranscriptionJobRequest): Promise<void> {
    console.info('[GroqTranscriptionService] enqueue', request.jobId)
    throw new Error('Queued transcription is not yet implemented.')
  }

  async cancel(jobId: string): Promise<void> {
    console.info('[GroqTranscriptionService] cancel', jobId)
  }

  refreshSettings(): void {
    console.info('[GroqTranscriptionService] refreshSettings noop')
  }

  async transcribeAudio(request: TranscriptionAudioRequest): Promise<TranscriptionAudioResult> {
    const apiKey = request.apiKey.trim()
    if (!apiKey) {
      throw new Error('Groq API key is missing. Add it in Settings to start transcription.')
    }

    const fileName = `snip-${Date.now()}.wav`
    const file = request.audio instanceof File ? request.audio : new File([request.audio], fileName, {
      type: request.audio.type || 'audio/wav',
    })

    const form = new FormData()
    form.append('file', file)
    form.append('model', request.model ?? DEFAULT_GROQ_MODEL)
    form.append('response_format', 'verbose_json')
    form.append('timestamp_granularities[]', 'word')
    if (request.temperature !== undefined) {
      form.append('temperature', String(request.temperature))
    }
    if (request.language) {
      form.append('language', request.language)
    }

    const response = await fetch(GROQ_TRANSCRIPTION_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      body: form,
    })

    const rawBody = await response.text()
    if (!response.ok) {
      let message = `Groq transcription failed (${response.status})`
      try {
        const payload = JSON.parse(rawBody) as { error?: { message?: string } }
        if (payload?.error?.message) {
          message = payload.error.message
        }
      } catch {
        if (rawBody) {
          message = `${message}: ${rawBody}`
        }
      }
      throw new Error(message)
    }

    const payload = JSON.parse(rawBody) as GroqTranscriptionResponse
    const segments = extractSegments(payload)
    const text =
      typeof payload.text === 'string'
        ? payload.text.trim()
        : segments.map((segment) => segment[1]).join(' ').trim()

    return {
      text,
      segments,
      model: request.model ?? DEFAULT_GROQ_MODEL,
      language: payload.language ?? request.language ?? null,
    }
  }
}

export const transcriptionService: TranscriptionService = new GroqTranscriptionService()
