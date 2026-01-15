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

export type TranscriptionWord = {
  text: string
  startMs: number
  endMs: number
}

export interface TranscriptionAudioRequest {
  apiKey: string
  audio: Blob
  model?: string
  language?: string
  temperature?: number
}

export interface TranscriptionAudioResult {
  text: string
  words: TranscriptionWord[]
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

const toTranscriptionWord = (word: GroqResponseWord, fallbackText?: string): TranscriptionWord | null => {
  const text = (word.word ?? word.text ?? fallbackText ?? '').trim()
  if (!text) return null
  const startMs = Number.isFinite(word.start) ? Math.max(0, (word.start ?? 0) * 1000) : 0
  const endMs = Number.isFinite(word.end) ? Math.max(startMs, (word.end ?? 0) * 1000) : startMs
  return { text, startMs, endMs }
}

const extractWords = (payload: GroqTranscriptionResponse): TranscriptionWord[] => {
  const words: TranscriptionWord[] = []
  if (Array.isArray(payload.words)) {
    payload.words.forEach((word) => {
      const normalized = toTranscriptionWord(word)
      if (normalized) words.push(normalized)
    })
  }

  if (words.length === 0 && Array.isArray(payload.segments)) {
    payload.segments.forEach((segment) => {
      if (Array.isArray(segment.words) && segment.words.length > 0) {
        segment.words.forEach((word) => {
          const normalized = toTranscriptionWord(word)
          if (normalized) words.push(normalized)
        })
        return
      }
      const segmentText = (segment.text ?? '').trim()
      if (!segmentText) return
      const fallback = toTranscriptionWord({ start: segment.start, end: segment.end }, segmentText)
      if (fallback) words.push(fallback)
    })
  }

  if (words.length === 0 && typeof payload.text === 'string') {
    const fallbackText = payload.text.trim()
    if (fallbackText) {
      words.push({ text: fallbackText, startMs: 0, endMs: 0 })
    }
  }

  return words
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
    const words = extractWords(payload)
    const text = typeof payload.text === 'string' ? payload.text.trim() : words.map((word) => word.text).join(' ').trim()

    return {
      text,
      words,
      model: request.model ?? DEFAULT_GROQ_MODEL,
      language: payload.language ?? request.language ?? null,
    }
  }
}

export const transcriptionService: TranscriptionService = new GroqTranscriptionService()
