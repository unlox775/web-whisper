import { describe, expect, it } from 'vitest'
import { computeSequentialTimings } from '../../src/modules/storage/chunk-timing'

describe('computeSequentialTimings', () => {
  it('builds sequential start/end times from verified durations', () => {
    const baseStart = 1_000
    const plan = computeSequentialTimings(baseStart, [
      { id: 'hdr', seq: 0, durationMs: 0 },
      { id: 'a', seq: 1, durationMs: 500 },
      { id: 'b', seq: 2, durationMs: 750 },
    ])

    expect(plan).toEqual([
      { id: 'hdr', seq: 0, durationMs: 0, startMs: 1_000, endMs: 1_000 },
      { id: 'a', seq: 1, durationMs: 500, startMs: 1_000, endMs: 1_500 },
      { id: 'b', seq: 2, durationMs: 750, startMs: 1_500, endMs: 2_250 },
    ])
  })

  it('coerces invalid durations to zero without breaking offsets', () => {
    const baseStart = 5_000
    const plan = computeSequentialTimings(baseStart, [
      { id: 'hdr', seq: 0, durationMs: NaN },
      { id: 'a', seq: 1, durationMs: -120 },
      { id: 'b', seq: 2, durationMs: Number.POSITIVE_INFINITY },
    ])

    expect(plan).toEqual([
      { id: 'hdr', seq: 0, durationMs: 0, startMs: 5_000, endMs: 5_000 },
      { id: 'a', seq: 1, durationMs: 0, startMs: 5_000, endMs: 5_000 },
      { id: 'b', seq: 2, durationMs: 0, startMs: 5_000, endMs: 5_000 },
    ])
  })
})
