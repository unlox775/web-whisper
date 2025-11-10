import { describe, expect, it } from 'vitest'
import { analyzeSessionFromFrames, type VolumeFrame } from '../../src/modules/analysis/session-analysis'

const frame = (index: number, startMs: number, durationMs: number, value: number): VolumeFrame => ({
  index,
  startMs,
  endMs: startMs + durationMs,
  rms: value,
  normalized: value,
})

describe('analyzeSessionFromFrames', () => {
  it('summarises sequential frames into quiet-region boundaries', () => {
    const frames: VolumeFrame[] = [
      frame(0, 0, 50, 0.2),
      frame(1, 50, 50, 0.18),
      frame(2, 100, 50, 0.75),
      frame(3, 150, 50, 0.82),
      frame(4, 200, 50, 0.78),
      frame(5, 250, 50, 0.15),
      frame(6, 300, 50, 0.12),
      frame(7, 350, 50, 0.65),
      frame(8, 400, 50, 0.7),
    ]

    const analysis = analyzeSessionFromFrames(frames, {
      totalDurationMs: 450,
      sampleRate: 48_000,
      frameDurationMs: 50,
    })

    expect(analysis).not.toBeNull()
    if (!analysis) return

    expect(analysis.frames).toHaveLength(frames.length)
    expect(analysis.stats.totalDurationMs).toBe(450)
    expect(analysis.stats.sampleRate).toBe(48_000)
    expect(analysis.segments.length).toBeGreaterThan(0)
  })

  it('returns null when no frames are provided', () => {
    const analysis = analyzeSessionFromFrames([], { totalDurationMs: 0 })
    expect(analysis).toBeNull()
  })
})
