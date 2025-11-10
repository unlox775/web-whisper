import { computeNormalizedFrames } from '../analysis/session-analysis'

export interface ChunkVolumeProfile {
  chunkId: string
  sessionId: string
  seq: number
  chunkStartMs: number
  chunkEndMs: number
  durationMs: number
  sampleRate: number
  frameDurationMs: number
  frames: number[]
  maxNormalized: number
  averageNormalized: number
  scalingFactor: number
}

export async function computeChunkVolumeProfile(
  blob: Blob,
  options: {
    chunkId: string
    sessionId: string
    seq: number
    chunkStartMs: number
    chunkEndMs: number
    frameDurationMs?: number
  },
): Promise<ChunkVolumeProfile> {
  if (typeof window === 'undefined' || typeof window.AudioContext === 'undefined') {
    throw new Error('AudioContext is not supported in this environment.')
  }

  const {
    chunkId,
    sessionId,
    seq,
    chunkStartMs,
    chunkEndMs,
    frameDurationMs,
  } = options

  const audioContext = new AudioContext()
  try {
    const arrayBuffer = await blob.arrayBuffer()
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer.slice(0))
    const { normalizedFrames, scalingFactor, maxNormalized, averageNormalized } = computeNormalizedFrames({
      audioBuffer,
      frameDurationMs,
    })

    return {
      chunkId,
      sessionId,
      seq,
      chunkStartMs,
      chunkEndMs,
      durationMs: audioBuffer.duration * 1000,
      sampleRate: audioBuffer.sampleRate,
      frameDurationMs: frameDurationMs ?? 50,
      frames: normalizedFrames,
      maxNormalized,
      averageNormalized,
      scalingFactor,
    }
  } finally {
    await audioContext.close().catch(() => {
      /* noop */
    })
  }
}
