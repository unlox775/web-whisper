import type { ChunkTimingStatus } from './manifest'

export const DEFAULT_CHUNK_TIMING_STATUS: ChunkTimingStatus = 'unverified'

export interface SequencedChunkDuration {
  id: string
  seq: number
  durationMs: number
}

export interface SequencedChunkTiming extends SequencedChunkDuration {
  startMs: number
  endMs: number
}

/**
 * Deterministically rebuilds absolute start/end timestamps for a session's chunk sequence.
 * The algorithm assumes `durationMs` already reflects the verified audio length for each chunk.
 * Chunk `seq === 0` is treated as the header/handshake chunk and therefore has zero duration.
 */
export function computeSequentialTimings(
  baseStartMs: number,
  durations: SequencedChunkDuration[],
): SequencedChunkTiming[] {
  let rollingOffset = 0

  return durations.map((chunk) => {
    const safeDuration = Number.isFinite(chunk.durationMs) && chunk.durationMs > 0 ? Math.round(chunk.durationMs) : 0
    const startMs = Math.round(baseStartMs + rollingOffset)
    const endMs = chunk.seq === 0 ? startMs : Math.round(startMs + safeDuration)
    if (chunk.seq !== 0) {
      rollingOffset += safeDuration
    }
    return {
      ...chunk,
      durationMs: safeDuration,
      startMs,
      endMs,
    }
  })
}
