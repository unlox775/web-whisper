export interface VolumeFrame {
  index: number
  startMs: number
  endMs: number
  rms: number
  normalized: number
}

export interface QuietRegion {
  index: number
  startFrame: number
  endFrame: number
  startMs: number
  endMs: number
  durationMs: number
  minRms: number
  maxRms: number
  averageRms: number
  centerMs: number
  normalizedMin: number
  normalizedMax: number
}

export interface ChunkBoundary {
  index: number
  positionMs: number
  precedingDurationMs: number
  quietRegionIndex: number
  score: number
  reason: 'pause'
}

export interface ChunkSummary {
  index: number
  startMs: number
  endMs: number
  durationMs: number
  breakReason: 'pause' | 'end'
  boundaryIndex: number | null
}

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

export interface RecordingChunkAnalysis {
  frames: VolumeFrame[]
  quietRegions: QuietRegion[]
  chunkBoundaries: ChunkBoundary[]
  chunks: ChunkSummary[]
  stats: {
    sampleRate: number
    totalDurationMs: number
    frameDurationMs: number
    frameCount: number
    maxRms: number
    minRms: number
    scalingFactor: number
    noiseFloor: number
    threshold: number
    normalizedThreshold: number
  }
}

export interface ChunkingAnalysisConfig {
  frameDurationMs: number
  minQuietDurationMs: number
  minChunkMs: number
  targetChunkMs: number
  maxChunkMs: number
  silencePaddingMs: number
  thresholdMultiplier: number
  quietPercentile: number
  noisePercentile: number
  initialIgnoreMs: number
}

const DEFAULT_CONFIG: ChunkingAnalysisConfig = {
  frameDurationMs: 50,
  minQuietDurationMs: 600,
  minChunkMs: 5000,
  targetChunkMs: 10000,
  maxChunkMs: 60000,
  silencePaddingMs: 200,
  thresholdMultiplier: 1.6,
  quietPercentile: 0.3,
  noisePercentile: 0.12,
  initialIgnoreMs: 120,
}

const percentile = (values: number[], fraction: number) => {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const clampedFraction = Math.min(Math.max(fraction, 0), 1)
  const index = clampedFraction === 1 ? sorted.length - 1 : Math.floor(clampedFraction * sorted.length)
  return sorted[index]
}

export const mixDownToMono = (buffer: AudioBuffer) => {
  if (buffer.numberOfChannels === 1) {
    return buffer.getChannelData(0)
  }
  const { length, numberOfChannels } = buffer
  const output = new Float32Array(length)
  for (let channel = 0; channel < numberOfChannels; channel += 1) {
    const channelData = buffer.getChannelData(channel)
    for (let sample = 0; sample < length; sample += 1) {
      output[sample] += channelData[sample] / numberOfChannels
    }
  }
  return output
}

export const computeFrames = (
  samples: Float32Array,
  sampleRate: number,
  frameDurationMs: number,
): {
  frames: VolumeFrame[]
  rmsValues: number[]
  minRms: number
  maxRms: number
} => {
  const frameSampleCount = Math.max(1, Math.round((frameDurationMs / 1000) * sampleRate))
  const totalSamples = samples.length
  const frameCount = Math.ceil(totalSamples / frameSampleCount)
  const frames: VolumeFrame[] = new Array(frameCount)
  const rmsValues: number[] = new Array(frameCount)
  let globalMin = Number.POSITIVE_INFINITY
  let globalMax = 0

  for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
    const frameStartSample = frameIndex * frameSampleCount
    const frameEndSample = Math.min(totalSamples, frameStartSample + frameSampleCount)
    const frameLength = frameEndSample - frameStartSample
    if (frameLength <= 0) {
      frames[frameIndex] = {
        index: frameIndex,
        startMs: (frameStartSample / sampleRate) * 1000,
        endMs: (frameEndSample / sampleRate) * 1000,
        rms: 0,
        normalized: 0,
      }
      rmsValues[frameIndex] = 0
      continue
    }

    let sumSquares = 0
    for (let i = frameStartSample; i < frameEndSample; i += 1) {
      const sample = samples[i]
      sumSquares += sample * sample
    }
    const rms = Math.sqrt(sumSquares / frameLength)
    frames[frameIndex] = {
      index: frameIndex,
      startMs: (frameStartSample / sampleRate) * 1000,
      endMs: (frameEndSample / sampleRate) * 1000,
      rms,
      normalized: rms,
    }
    rmsValues[frameIndex] = rms
    if (rms < globalMin) {
      globalMin = rms
    }
    if (rms > globalMax) {
      globalMax = rms
    }
  }

  if (!Number.isFinite(globalMin)) {
    globalMin = 0
  }

  return { frames, rmsValues, minRms: globalMin, maxRms: globalMax }
}

const detectQuietRegions = (
  frames: VolumeFrame[],
  threshold: number,
  minQuietDurationMs: number,
  initialIgnoreMs: number,
): QuietRegion[] => {
  const quietRegions: QuietRegion[] = []
  let regionStart: number | null = null
  let minRms = Number.POSITIVE_INFINITY
  let maxRms = 0
  let sumRms = 0
  let sampleCount = 0
  let hasSeenLoudFrame = false

  for (let index = 0; index < frames.length; index += 1) {
    const frame = frames[index]
    const meetsTimeGate = frame.startMs >= initialIgnoreMs
    if (meetsTimeGate && frame.rms > threshold) {
      hasSeenLoudFrame = true
    }
    const allowQuiet = hasSeenLoudFrame && meetsTimeGate
    const isQuiet = allowQuiet && frame.rms <= threshold
    if (isQuiet) {
      if (regionStart === null) {
        regionStart = index
        minRms = frame.rms
        maxRms = frame.rms
        sumRms = frame.rms
        sampleCount = 1
      } else {
        minRms = Math.min(minRms, frame.rms)
        maxRms = Math.max(maxRms, frame.rms)
        sumRms += frame.rms
        sampleCount += 1
      }
    }

    const isRegionEnding = (!isQuiet && regionStart !== null) || (index === frames.length - 1 && isQuiet)
    if (isRegionEnding && regionStart !== null) {
      const inclusiveEndFrame = isQuiet ? index : index - 1
      const startFrame = frames[regionStart]
      const endFrame = frames[inclusiveEndFrame]
      const durationMs = endFrame.endMs - startFrame.startMs
      if (durationMs >= minQuietDurationMs) {
        const centerMs = (startFrame.startMs + endFrame.endMs) / 2
        quietRegions.push({
          index: quietRegions.length,
          startFrame: regionStart,
          endFrame: inclusiveEndFrame,
          startMs: startFrame.startMs,
          endMs: endFrame.endMs,
          durationMs,
          minRms,
          maxRms,
          averageRms: sampleCount > 0 ? sumRms / sampleCount : 0,
          centerMs,
          normalizedMin: 0,
          normalizedMax: 0,
        })
      }
      regionStart = null
      minRms = Number.POSITIVE_INFINITY
      maxRms = 0
      sumRms = 0
      sampleCount = 0
    }
  }

  return quietRegions
}

const attachNormalizedExtents = (regions: QuietRegion[], frames: VolumeFrame[]) =>
  regions.map((region) => {
    const normalizedValues = frames
      .slice(region.startFrame, region.endFrame + 1)
      .map((frame) => frame.normalized)
    const normalizedMin = normalizedValues.length > 0 ? Math.min(...normalizedValues) : 0
    const normalizedMax = normalizedValues.length > 0 ? Math.max(...normalizedValues) : 0
    return {
      ...region,
      normalizedMin,
      normalizedMax,
    }
  })

const proposeChunkBoundaries = (
  quietRegions: QuietRegion[],
  totalDurationMs: number,
  config: ChunkingAnalysisConfig,
): { boundaries: ChunkBoundary[]; chunks: ChunkSummary[] } => {
  const boundaries: ChunkBoundary[] = []
  let lastCutMs = 0

  for (const region of quietRegions) {
    const chunkDuration = region.centerMs - lastCutMs
    if (chunkDuration < config.minChunkMs) {
      continue
    }

    if (chunkDuration >= config.targetChunkMs || chunkDuration >= config.maxChunkMs) {
      const score = Math.max(0, 1 - region.normalizedMax)
      boundaries.push({
        index: boundaries.length,
        positionMs: region.centerMs,
        precedingDurationMs: chunkDuration,
        quietRegionIndex: region.index,
        score,
        reason: 'pause',
      })
      lastCutMs = region.centerMs
    }
  }

  const chunks: ChunkSummary[] = []
  const sortedBoundaries = [...boundaries].sort((a, b) => a.positionMs - b.positionMs)
  let currentStart = 0
  sortedBoundaries.forEach((boundary, idx) => {
    const end = Math.min(boundary.positionMs, totalDurationMs)
    const durationMs = Math.max(0, end - currentStart)
    chunks.push({
      index: idx,
      startMs: currentStart,
      endMs: end,
      durationMs,
      breakReason: 'pause',
      boundaryIndex: boundary.index,
    })
    currentStart = boundary.positionMs
  })

  if (currentStart < totalDurationMs) {
    chunks.push({
      index: chunks.length,
      startMs: currentStart,
      endMs: totalDurationMs,
      durationMs: Math.max(0, totalDurationMs - currentStart),
      breakReason: 'end',
      boundaryIndex: null,
    })
  }

  return { boundaries, chunks }
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
    frameDurationMs = DEFAULT_CONFIG.frameDurationMs,
  } = options

  const audioContext = new AudioContext()
  try {
    const arrayBuffer = await blob.arrayBuffer()
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer.slice(0))
    const monoData = mixDownToMono(audioBuffer)
    const { frames, maxRms } = computeFrames(
      monoData,
      audioBuffer.sampleRate,
      frameDurationMs,
    )

    const peakRms = maxRms
    const scalingFactor = peakRms > 0 ? 0.92 / peakRms : 1
    const normalizedFrames = frames.map((frame) => Math.min(frame.rms * scalingFactor, 1))
    const frameCount = normalizedFrames.length
    const averageNormalized =
      frameCount > 0 ? normalizedFrames.reduce((sum, value) => sum + value, 0) / frameCount : 0
    const maxNormalized = frameCount > 0 ? Math.max(...normalizedFrames) : 0

    return {
      chunkId,
      sessionId,
      seq,
      chunkStartMs,
      chunkEndMs,
      durationMs: audioBuffer.duration * 1000,
      sampleRate: audioBuffer.sampleRate,
      frameDurationMs,
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

export function analyzeRecordingChunkingFromProfiles(
  profiles: ChunkVolumeProfile[],
  options: {
    totalDurationMs?: number
    config?: Partial<ChunkingAnalysisConfig>
  } = {},
): RecordingChunkAnalysis | null {
  const { totalDurationMs: overrideTotalDuration, config = {} } = options
  if (profiles.length === 0) {
    return null
  }

  const mergedConfig: ChunkingAnalysisConfig = { ...DEFAULT_CONFIG, ...config }
  const sortedProfiles = [...profiles].sort((a, b) => {
    if (a.chunkStartMs !== b.chunkStartMs) return a.chunkStartMs - b.chunkStartMs
    return a.seq - b.seq
  })

  const minChunkStartMs = sortedProfiles.reduce(
    (min, profile) => Math.min(min, profile.chunkStartMs),
    Number.POSITIVE_INFINITY,
  )

  const frames: VolumeFrame[] = []
  const normalizedValues: number[] = []
  let globalMin = Number.POSITIVE_INFINITY
  let globalMax = 0
  let frameIndex = 0
  let inferredTotalDuration = 0

  sortedProfiles.forEach((profile) => {
    const startOffset = profile.chunkStartMs - minChunkStartMs
    const durationMs = Number.isFinite(profile.durationMs) ? profile.durationMs : 0
    inferredTotalDuration = Math.max(inferredTotalDuration, startOffset + durationMs)

    const frameValues = Array.isArray(profile.frames)
      ? profile.frames
      : []
    const coercedValues: number[] =
      frameValues.length > 0 && typeof frameValues[0] === 'number'
        ? (frameValues as number[])
        : frameValues.map((frame: unknown) => {
            if (frame && typeof frame === 'object' && 'normalized' in (frame as Record<string, unknown>)) {
              const normalized = (frame as Record<string, unknown>).normalized
              return typeof normalized === 'number' ? normalized : 0
            }
            if (frame && typeof frame === 'object' && 'rms' in (frame as Record<string, unknown>)) {
              const rms = (frame as Record<string, unknown>).rms
              return typeof rms === 'number' ? rms : 0
            }
            return 0
          })

    const frameDuration = profile.frameDurationMs > 0 ? profile.frameDurationMs : mergedConfig.frameDurationMs

    coercedValues.forEach((value, idx) => {
      const clampedValue = Number.isFinite(value) ? Math.max(0, value) : 0
      const startMs = startOffset + idx * frameDuration
      const endMs = Math.min(startOffset + durationMs, startMs + frameDuration)
      frames.push({
        index: frameIndex,
        startMs,
        endMs,
        rms: clampedValue,
        normalized: clampedValue,
      })
      normalizedValues.push(clampedValue)
      if (clampedValue < globalMin) {
        globalMin = clampedValue
      }
      if (clampedValue > globalMax) {
        globalMax = clampedValue
      }
      frameIndex += 1
    })
  })

  if (frames.length === 0) {
    return null
  }

  if (!Number.isFinite(globalMin)) {
    globalMin = 0
  }

  const peakRms = globalMax
  const scalingFactor = 1
  const framesWithScaling = frames

  const noiseFloor = percentile(normalizedValues, mergedConfig.noisePercentile)
  const quietBand = percentile(normalizedValues, mergedConfig.quietPercentile)
  const thresholdCandidate = Math.max(
    noiseFloor * mergedConfig.thresholdMultiplier,
    (noiseFloor + quietBand) / 2,
  )
  const threshold = Math.min(thresholdCandidate, peakRms * 0.7)
  const normalizedThreshold = Math.min(threshold, 0.98)

  const inferredDurationMs =
    framesWithScaling.length > 0 ? Math.max(inferredTotalDuration, framesWithScaling[framesWithScaling.length - 1].endMs) : 0
  const totalDurationMs = Math.max(overrideTotalDuration ?? 0, inferredDurationMs)

  const quietRegions = attachNormalizedExtents(
    detectQuietRegions(
      framesWithScaling,
      threshold,
      mergedConfig.minQuietDurationMs,
      mergedConfig.initialIgnoreMs,
    ),
    framesWithScaling,
  )
  const { boundaries, chunks } = proposeChunkBoundaries(quietRegions, totalDurationMs, mergedConfig)

  const sampleRate = sortedProfiles[0]?.sampleRate ?? 0
  const frameDurationMs = sortedProfiles[0]?.frameDurationMs ?? mergedConfig.frameDurationMs

  return {
    frames: framesWithScaling,
    quietRegions,
    chunkBoundaries: boundaries,
    chunks,
    stats: {
      sampleRate,
      totalDurationMs,
      frameDurationMs,
      frameCount: framesWithScaling.length,
      maxRms: peakRms,
      minRms: globalMin,
      scalingFactor,
      noiseFloor,
      threshold,
      normalizedThreshold,
    },
  }
}

export async function analyzeRecordingChunking(
  blob: Blob,
  config: Partial<ChunkingAnalysisConfig> = {},
): Promise<RecordingChunkAnalysis> {
  if (typeof window === 'undefined' || typeof window.AudioContext === 'undefined') {
    throw new Error('AudioContext is not supported in this environment.')
  }

  const mergedConfig: ChunkingAnalysisConfig = { ...DEFAULT_CONFIG, ...config }
  const audioContext = new AudioContext()
  try {
    const arrayBuffer = await blob.arrayBuffer()
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer.slice(0))
    const totalDurationMs = audioBuffer.duration * 1000
    const monoData = mixDownToMono(audioBuffer)
    const { frames, rmsValues, minRms, maxRms } = computeFrames(
      monoData,
      audioBuffer.sampleRate,
      mergedConfig.frameDurationMs,
    )

    const peakRms = maxRms
    const scalingFactor = peakRms > 0 ? 0.92 / peakRms : 1
    const framesWithScaling = frames.map((frame) => ({
      ...frame,
      normalized: Math.min(frame.rms * scalingFactor, 1),
    }))

    const noiseFloor = percentile(rmsValues, mergedConfig.noisePercentile)
    const quietBand = percentile(rmsValues, mergedConfig.quietPercentile)
    const thresholdCandidate = Math.max(
      noiseFloor * mergedConfig.thresholdMultiplier,
      (noiseFloor + quietBand) / 2,
    )
    const threshold = Math.min(thresholdCandidate, peakRms * 0.7)
    const normalizedThreshold = Math.min(threshold * scalingFactor, 0.98)

    const quietRegions = attachNormalizedExtents(
      detectQuietRegions(
        framesWithScaling,
        threshold,
        mergedConfig.minQuietDurationMs,
        mergedConfig.initialIgnoreMs,
      ),
      framesWithScaling,
    )
    const { boundaries, chunks } = proposeChunkBoundaries(quietRegions, totalDurationMs, mergedConfig)

    return {
      frames: framesWithScaling,
      quietRegions,
      chunkBoundaries: boundaries,
      chunks,
      stats: {
        sampleRate: audioBuffer.sampleRate,
        totalDurationMs,
        frameDurationMs: mergedConfig.frameDurationMs,
        frameCount: framesWithScaling.length,
        maxRms: peakRms,
        minRms,
        scalingFactor,
        noiseFloor,
        threshold,
        normalizedThreshold,
      },
    }
  } finally {
    await audioContext.close().catch(() => {
      /* noop */
    })
  }
}

