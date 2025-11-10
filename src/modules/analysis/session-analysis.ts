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

export interface SegmentBoundary {
  index: number
  positionMs: number
  precedingDurationMs: number
  quietRegionIndex: number
  score: number
  reason: 'pause'
}

export interface SegmentSummary {
  index: number
  startMs: number
  endMs: number
  durationMs: number
  breakReason: 'pause' | 'end'
  boundaryIndex: number | null
}

export interface SessionAnalysis {
  frames: VolumeFrame[]
  quietRegions: QuietRegion[]
  boundaries: SegmentBoundary[]
  segments: SegmentSummary[]
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

export interface SessionAnalysisConfig {
  frameDurationMs: number
  minQuietDurationMs: number
  minSegmentMs: number
  targetSegmentMs: number
  maxSegmentMs: number
  silencePaddingMs: number
  thresholdMultiplier: number
  quietPercentile: number
  noisePercentile: number
  initialIgnoreMs: number
}

export const DEFAULT_SESSION_ANALYSIS_CONFIG: SessionAnalysisConfig = {
  frameDurationMs: 50,
  minQuietDurationMs: 600,
  minSegmentMs: 5_000,
  targetSegmentMs: 10_000,
  maxSegmentMs: 60_000,
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

export const computeVolumeFrames = (
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

export const computeNormalizedFrames = ({
  audioBuffer,
  frameDurationMs = DEFAULT_SESSION_ANALYSIS_CONFIG.frameDurationMs,
}: {
  audioBuffer: AudioBuffer
  frameDurationMs?: number
}) => {
  const monoData = mixDownToMono(audioBuffer)
  const { frames } = computeVolumeFrames(monoData, audioBuffer.sampleRate, frameDurationMs)
  const peakRms = frames.reduce((max, frame) => Math.max(max, frame.rms), 0)
  const scalingFactor = peakRms > 0 ? 0.92 / peakRms : 1
  const normalizedFrames = frames.map((frame) => Math.min(frame.rms * scalingFactor, 1))
  const frameCount = normalizedFrames.length
  const averageNormalized =
    frameCount > 0 ? normalizedFrames.reduce((sum, value) => sum + value, 0) / frameCount : 0
  const maxNormalized = frameCount > 0 ? Math.max(...normalizedFrames) : 0
  return {
    normalizedFrames,
    scalingFactor,
    maxNormalized,
    averageNormalized,
    frameDurationMs,
  }
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

const proposeSegments = (
  quietRegions: QuietRegion[],
  totalDurationMs: number,
  config: SessionAnalysisConfig,
): { boundaries: SegmentBoundary[]; segments: SegmentSummary[] } => {
  const boundaries: SegmentBoundary[] = []
  let lastCutMs = 0

  for (const region of quietRegions) {
    const segmentDuration = region.centerMs - lastCutMs
    if (segmentDuration < config.minSegmentMs) {
      continue
    }

    if (segmentDuration >= config.targetSegmentMs || segmentDuration >= config.maxSegmentMs) {
      const score = Math.max(0, 1 - region.normalizedMax)
      boundaries.push({
        index: boundaries.length,
        positionMs: region.centerMs,
        precedingDurationMs: segmentDuration,
        quietRegionIndex: region.index,
        score,
        reason: 'pause',
      })
      lastCutMs = region.centerMs
    }
  }

  const segments: SegmentSummary[] = []
  const sortedBoundaries = [...boundaries].sort((a, b) => a.positionMs - b.positionMs)
  let currentStart = 0
  sortedBoundaries.forEach((boundary, idx) => {
    const end = Math.min(boundary.positionMs, totalDurationMs)
    const durationMs = Math.max(0, end - currentStart)
    segments.push({
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
    segments.push({
      index: segments.length,
      startMs: currentStart,
      endMs: totalDurationMs,
      durationMs: Math.max(0, totalDurationMs - currentStart),
      breakReason: 'end',
      boundaryIndex: null,
    })
  }

  return { boundaries, segments }
}

export function analyzeSessionFromFrames(
  frames: VolumeFrame[],
  options: {
    totalDurationMs?: number
    config?: Partial<SessionAnalysisConfig>
    sampleRate?: number
    frameDurationMs?: number
  } = {},
): SessionAnalysis | null {
  const { totalDurationMs: overrideTotalDuration, config = {}, sampleRate = 0, frameDurationMs } = options
  if (frames.length === 0) {
    return null
  }

  const mergedConfig: SessionAnalysisConfig = { ...DEFAULT_SESSION_ANALYSIS_CONFIG, ...config }

  const normalizedValues = frames.map((frame) => frame.normalized)
  const peakRms = frames.reduce((max, frame) => Math.max(max, frame.rms), 0)
  const minRms = frames.reduce((min, frame) => Math.min(min, frame.rms), Number.POSITIVE_INFINITY)
  const scalingFactor = 1

  const noiseFloor = percentile(normalizedValues, mergedConfig.noisePercentile)
  const quietBand = percentile(normalizedValues, mergedConfig.quietPercentile)
  const thresholdCandidate = Math.max(
    noiseFloor * mergedConfig.thresholdMultiplier,
    (noiseFloor + quietBand) / 2,
  )
  const threshold = Math.min(thresholdCandidate, peakRms * 0.7)
  const normalizedThreshold = Math.min(threshold, 0.98)

  const totalDurationMs = Math.max(
    overrideTotalDuration ?? 0,
    frames[frames.length - 1]?.endMs ?? 0,
  )

  const quietRegions = attachNormalizedExtents(
    detectQuietRegions(
      frames,
      threshold,
      mergedConfig.minQuietDurationMs,
      mergedConfig.initialIgnoreMs,
    ),
    frames,
  )
  const { boundaries, segments } = proposeSegments(quietRegions, totalDurationMs, mergedConfig)

  return {
    frames,
    quietRegions,
    boundaries,
    segments,
    stats: {
      sampleRate,
      totalDurationMs,
      frameDurationMs: frameDurationMs ?? mergedConfig.frameDurationMs,
      frameCount: frames.length,
      maxRms: peakRms,
      minRms: Number.isFinite(minRms) ? minRms : 0,
      scalingFactor,
      noiseFloor,
      threshold,
      normalizedThreshold,
    },
  }
}

export async function analyzeSession(
  blob: Blob,
  config: Partial<SessionAnalysisConfig> = {},
): Promise<SessionAnalysis> {
  if (typeof window === 'undefined' || typeof window.AudioContext === 'undefined') {
    throw new Error('AudioContext is not supported in this environment.')
  }

  const mergedConfig: SessionAnalysisConfig = { ...DEFAULT_SESSION_ANALYSIS_CONFIG, ...config }
  const audioContext = new AudioContext()
  try {
    const arrayBuffer = await blob.arrayBuffer()
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer.slice(0))
    const totalDurationMs = audioBuffer.duration * 1000
    const monoData = mixDownToMono(audioBuffer)
    const { frames, rmsValues, minRms, maxRms } = computeVolumeFrames(
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
    const { boundaries, segments } = proposeSegments(quietRegions, totalDurationMs, mergedConfig)

    return {
      frames: framesWithScaling,
      quietRegions,
      boundaries,
      segments,
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
