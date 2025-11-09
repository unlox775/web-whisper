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
  // Start with zero offset so seq0 aligns with the provided session start time.
  let rollingOffset = 0

  return durations.map((chunk) => {
    // Coerce any invalid duration to zero so jittery metadata never breaks the timeline.
    const safeDuration = Number.isFinite(chunk.durationMs) && chunk.durationMs > 0 ? Math.round(chunk.durationMs) : 0
    // Build the monotonic start timestamp by adding the cumulative offset to the base.
    const startMs = Math.round(baseStartMs + rollingOffset)
    // The end timestamp is the start plus the verified duration (header chunks stay zero-length).
    const endMs = chunk.seq === 0 ? startMs : Math.round(startMs + safeDuration)
    // Accumulate the duration so the next chunk begins where this one finishes.
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
