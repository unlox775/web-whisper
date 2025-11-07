import { describe, expect, it } from 'vitest'
import {
  analyzeRecordingChunkingFromProfiles,
  type ChunkVolumeProfile,
} from '../../src/modules/analysis/chunking'

const createProfile = ({
  chunkId,
  sessionId,
  seq,
  chunkStartMs,
  durationMs,
  frameDurationMs,
  frames,
}: {
  chunkId: string
  sessionId: string
  seq: number
  chunkStartMs: number
  durationMs: number
  frameDurationMs: number
  frames: number[]
}): ChunkVolumeProfile => {
  const chunkEndMs = chunkStartMs + durationMs
  const averageNormalized = frames.length > 0 ? frames.reduce((sum, value) => sum + value, 0) / frames.length : 0
  const maxNormalized = frames.length > 0 ? Math.max(...frames) : 0
  return {
    chunkId,
    sessionId,
    seq,
    chunkStartMs,
    chunkEndMs,
    durationMs,
    sampleRate: 48000,
    frameDurationMs,
    frames,
    maxNormalized,
    averageNormalized,
    scalingFactor: 1,
  }
}

describe('analyzeRecordingChunkingFromProfiles', () => {
  it('reconstructs frame timeline from normalized chunk profiles', () => {
    const base = 1_700_000_000_000
    const profileA = createProfile({
      chunkId: 'chunk-a',
      sessionId: 'session-1',
      seq: 1,
      chunkStartMs: base,
      durationMs: 150,
      frameDurationMs: 50,
      frames: [0.05, 0.4, 0.85],
    })
    const profileB = createProfile({
      chunkId: 'chunk-b',
      sessionId: 'session-1',
      seq: 2,
      chunkStartMs: base + 300,
      durationMs: 100,
      frameDurationMs: 50,
      frames: [0.1, 0.65],
    })

    const analysis = analyzeRecordingChunkingFromProfiles([profileA, profileB])

    expect(analysis).not.toBeNull()
    if (!analysis) {
      return
    }

    expect(analysis.frames.length).toBe(profileA.frames.length + profileB.frames.length)
    expect(analysis.stats.frameCount).toBe(analysis.frames.length)
    expect(analysis.frames[0].startMs).toBe(0)

    const expectedTotalDuration = (profileB.chunkStartMs - profileA.chunkStartMs) + profileB.durationMs
    expect(Math.round(analysis.stats.totalDurationMs)).toBe(expectedTotalDuration)
    expect(analysis.stats.maxRms).toBeCloseTo(Math.max(...profileA.frames, ...profileB.frames))
    expect(analysis.stats.minRms).toBeGreaterThanOrEqual(0)
  })

  it('supports legacy frame payloads with normalized fields', () => {
    const base = 1_700_000_100_000
    const legacyProfile = {
      chunkId: 'chunk-legacy',
      sessionId: 'session-legacy',
      seq: 1,
      chunkStartMs: base,
      chunkEndMs: base + 200,
      durationMs: 200,
      sampleRate: 44100,
      frameDurationMs: 50,
      frames: [
        { normalized: 0.2, startOffsetMs: 0, endOffsetMs: 50 },
        { normalized: 0.6, startOffsetMs: 50, endOffsetMs: 100 },
        { normalized: 0.1, startOffsetMs: 100, endOffsetMs: 150 },
        { normalized: 0.9, startOffsetMs: 150, endOffsetMs: 200 },
      ],
      maxNormalized: 0.9,
      averageNormalized: 0.45,
      scalingFactor: 1,
    }

    const analysis = analyzeRecordingChunkingFromProfiles(
      [legacyProfile as unknown as ChunkVolumeProfile],
      { totalDurationMs: 200 },
    )

    expect(analysis).not.toBeNull()
    if (!analysis) {
      return
    }
    expect(analysis.frames.length).toBe(4)
    expect(analysis.frames[analysis.frames.length - 1].endMs).toBeCloseTo(200)
    expect(analysis.stats.totalDurationMs).toBe(200)
    expect(analysis.stats.maxRms).toBeCloseTo(0.9)
  })
})
