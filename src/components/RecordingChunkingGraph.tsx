import {
  memo,
  useMemo,
  useId,
  useRef,
  useState,
  useCallback,
  useEffect,
} from 'react'
import type { PointerEvent as ReactPointerEvent, UIEvent as ReactUIEvent } from 'react'
import type {
  RecordingChunkAnalysis,
  ChunkSummary,
  ChunkBoundary,
  QuietRegion,
} from '../modules/analysis/chunking'

type RecordingChunkingGraphProps = {
  analysis: RecordingChunkAnalysis
  targetRange?: {
    minMs: number
    idealMs: number
    maxMs: number
  }
  playback?: {
    positionMs: number
    isPlaying: boolean
  }
}

const formatDuration = (durationMs: number) => {
  if (!Number.isFinite(durationMs) || durationMs <= 0) {
    return '0.0s'
  }
  const seconds = durationMs / 1000
  if (seconds < 10) {
    return `${seconds.toFixed(1)}s`
  }
  if (seconds < 60) {
    return `${seconds.toFixed(0)}s`
  }
  const minutes = Math.floor(seconds / 60)
  const remainder = seconds % 60
  return `${minutes}m ${remainder.toFixed(0).padStart(2, '0')}s`
}

const LOG_SCALE_BASE = 10
// Each viewport spans 75 seconds of audio so the histogram starts zoomed out per product guidance.
const SCROLL_WINDOW_MS = 75_000
const BASE_VIEWPORT_WIDTH = 720
const SCROLL_INDICATOR_THRESHOLD = 12
const AUTO_SCROLL_THRESHOLD_RATIO = 0.75
const AUTO_SCROLL_MARGIN_RATIO = 0.1
const PLAYBACK_BAR_WIDTH = 3
const PLAYBACK_GLOW_WIDTH = 7

const toLogScale = (value: number, base = LOG_SCALE_BASE) => {
  if (!Number.isFinite(value) || value <= 0) {
    return 0
  }
  const clamped = Math.min(1, Math.max(0, value))
  const numerator = Math.log10(1 + (base - 1) * clamped)
  const denominator = Math.log10(base)
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) {
    return clamped
  }
  const scaled = numerator / denominator
  return Math.min(1, Math.max(0, scaled))
}

const SEGMENT_RESET_EPSILON_MS = 1

const buildAreaPaths = (
  frames: RecordingChunkAnalysis['frames'],
  totalDurationMs: number,
  height: number,
  width: number,
  transform: (value: number) => number,
) => {
  if (frames.length === 0 || totalDurationMs <= 0 || width <= 0) {
    return [] as string[]
  }

  const orderedFrames = [...frames].sort((a, b) => {
    if (a.startMs !== b.startMs) return a.startMs - b.startMs
    if (a.endMs !== b.endMs) return a.endMs - b.endMs
    return a.index - b.index
  })

  const segments: string[] = []
  let commands: string[] = []
  let segmentEndX = 0
  let lastMidpointMs = -Infinity

  const flushSegment = () => {
    if (commands.length > 1) {
      commands.push(`L ${segmentEndX.toFixed(2)} ${height}`)
      commands.push('Z')
      segments.push(commands.join(' '))
    }
    commands = []
  }

  orderedFrames.forEach((frame, idx) => {
    const midpointMs = (frame.startMs + frame.endMs) / 2
    const frameStartX = Math.min(width, Math.max(0, (frame.startMs / totalDurationMs) * width))
    const frameEndX = Math.min(width, Math.max(0, (frame.endMs / totalDurationMs) * width))
    const x = Math.min(width, Math.max(0, (midpointMs / totalDurationMs) * width))
    const normalized = transform(frame.normalized)
    const y = Math.max(0, Math.min(height, (1 - normalized) * height))

    const isNewSegment =
      commands.length === 0 || midpointMs + SEGMENT_RESET_EPSILON_MS < lastMidpointMs

    if (isNewSegment) {
      flushSegment()
      commands = [`M ${frameStartX.toFixed(2)} ${height}`]
    }

    commands.push(`L ${x.toFixed(2)} ${y.toFixed(2)}`)
    segmentEndX = Math.max(frameEndX, segmentEndX)
    lastMidpointMs = midpointMs

    if (idx === orderedFrames.length - 1) {
      flushSegment()
    }
  })

  if (commands.length > 0) {
    flushSegment()
  }

  return segments
}

const buildQuietRects = (
  regions: QuietRegion[],
  totalDurationMs: number,
  width: number,
): Array<{ x: number; rectWidth: number }> =>
  regions.map((region) => {
    const x = (region.startMs / totalDurationMs) * width
    const rectWidth = ((region.endMs - region.startMs) / totalDurationMs) * width
    return {
      x,
      rectWidth,
    }
  })

const buildBoundaryLines = (
  boundaries: ChunkBoundary[],
  totalDurationMs: number,
  width: number,
): Array<{ x: number }> =>
  boundaries.map((boundary) => ({
    x: (boundary.positionMs / totalDurationMs) * width,
  }))

const describeChunks = (chunks: ChunkSummary[]) =>
  chunks.map((chunk) => ({
    id: chunk.index,
    label: chunk.breakReason === 'end' ? 'Tail' : `Chunk #${chunk.index + 1}`,
    durationMs: chunk.durationMs,
    startMs: chunk.startMs,
    endMs: chunk.endMs,
    breakReason: chunk.breakReason,
  }))

const RecordingChunkingGraphComponent = ({ analysis, targetRange, playback }: RecordingChunkingGraphProps) => {
  const scrollContainerRef = useRef<HTMLDivElement | null>(null)
  const dragStateRef = useRef<{ pointerId: number; startX: number; scrollLeft: number } | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [showLeftIndicator, setShowLeftIndicator] = useState(false)
  const [showRightIndicator, setShowRightIndicator] = useState(false)
  const height = 120
  const totalDurationMs = analysis.stats.totalDurationMs
  const estimatedDuration =
    totalDurationMs > 0 ? totalDurationMs : analysis.stats.frameCount * analysis.stats.frameDurationMs
  const baseViewportWidth =
    typeof window !== 'undefined'
      ? Math.min(960, Math.max(BASE_VIEWPORT_WIDTH, Math.floor(window.innerWidth * 0.8)))
      : BASE_VIEWPORT_WIDTH
  const width =
    estimatedDuration > 0
      ? Math.max(baseViewportWidth, Math.round((estimatedDuration / SCROLL_WINDOW_MS) * baseViewportWidth))
      : baseViewportWidth
  const gradientId = useId()
  const playbackPositionMs = playback?.positionMs ?? null
  const hasUsableDuration = estimatedDuration > 0 && width > 0
  const clampedPlaybackMs =
    playbackPositionMs === null || !hasUsableDuration
      ? null
      : Math.min(Math.max(playbackPositionMs, 0), estimatedDuration)
  const playbackRatio = clampedPlaybackMs === null || !hasUsableDuration ? null : clampedPlaybackMs / estimatedDuration
  const playbackX = playbackRatio === null ? null : playbackRatio * width
  const playbackIndicator = useMemo(() => {
    if (playbackX === null || !hasUsableDuration) {
      return null
    }
    const center = Math.min(width, Math.max(0, playbackX))
    const clampPosition = (barWidth: number) =>
      Math.max(0, Math.min(Math.max(width - barWidth, 0), center - barWidth / 2))
    return {
      center,
      mainX: clampPosition(PLAYBACK_BAR_WIDTH),
      mainWidth: PLAYBACK_BAR_WIDTH,
      glowX: clampPosition(PLAYBACK_GLOW_WIDTH),
      glowWidth: PLAYBACK_GLOW_WIDTH,
    }
  }, [hasUsableDuration, playbackX, width])
  const isPlaybackActive = Boolean(playback?.isPlaying)

  const updateIndicators = useCallback(() => {
    const container = scrollContainerRef.current
    if (!container) {
      setShowLeftIndicator(false)
      setShowRightIndicator(false)
      return
    }
    const { scrollLeft, clientWidth, scrollWidth } = container
    setShowLeftIndicator(scrollLeft > SCROLL_INDICATOR_THRESHOLD)
    setShowRightIndicator(scrollLeft + clientWidth < scrollWidth - SCROLL_INDICATOR_THRESHOLD)
  }, [])

  const handleScroll = useCallback(
    (event: ReactUIEvent<HTMLDivElement>) => {
      if (isDragging) {
        event.preventDefault()
      }
      updateIndicators()
    },
    [isDragging, updateIndicators],
  )

  const handlePointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const container = scrollContainerRef.current
    if (!container) {
      return
    }
    container.setPointerCapture(event.pointerId)
    dragStateRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      scrollLeft: container.scrollLeft,
    }
    setIsDragging(true)
  }, [])

  const handlePointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const container = scrollContainerRef.current
      const dragState = dragStateRef.current
      if (!container || !dragState || dragState.pointerId !== event.pointerId) {
        return
      }
      event.preventDefault()
      const delta = event.clientX - dragState.startX
      container.scrollLeft = dragState.scrollLeft - delta
      updateIndicators()
    },
    [updateIndicators],
  )

  const endDrag = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const container = scrollContainerRef.current
      const dragState = dragStateRef.current
      if (!container || !dragState || dragState.pointerId !== event.pointerId) {
        return
      }
      container.releasePointerCapture(event.pointerId)
      dragStateRef.current = null
      setIsDragging(false)
      updateIndicators()
    },
    [updateIndicators],
  )

  useEffect(() => {
    updateIndicators()
  }, [width, updateIndicators])

  useEffect(() => {
    const container = scrollContainerRef.current
    if (!container) {
      return
    }
    if (playbackIndicator === null) {
      return
    }
    if (isDragging) {
      return
    }
    if (!isPlaybackActive) {
      return
    }
    const viewportWidth = container.clientWidth
    if (viewportWidth <= 0) {
      return
    }
    const maxScrollLeft = Math.max(0, container.scrollWidth - viewportWidth)
    if (maxScrollLeft <= 0) {
      return
    }
    const scrollLeft = container.scrollLeft
    const viewportStart = scrollLeft
    const viewportEnd = scrollLeft + viewportWidth
    const thresholdOffset = viewportWidth * AUTO_SCROLL_THRESHOLD_RATIO
    const marginOffset = viewportWidth * AUTO_SCROLL_MARGIN_RATIO

    let nextScrollLeft: number | null = null

    if (playbackIndicator.center >= viewportStart + thresholdOffset) {
      nextScrollLeft = Math.min(maxScrollLeft, playbackIndicator.center - thresholdOffset)
    } else if (playbackIndicator.center <= viewportStart) {
      nextScrollLeft = Math.max(0, playbackIndicator.center - marginOffset)
    } else if (playbackIndicator.center >= viewportEnd) {
      nextScrollLeft = Math.min(maxScrollLeft, playbackIndicator.center - thresholdOffset)
    }

    if (nextScrollLeft !== null && Math.abs(nextScrollLeft - scrollLeft) > 0.5) {
      if (typeof container.scrollTo === 'function') {
        container.scrollTo({
          left: nextScrollLeft,
          behavior: 'smooth',
        })
      } else {
        container.scrollLeft = nextScrollLeft
      }
      if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
        window.requestAnimationFrame(() => {
          updateIndicators()
        })
      } else {
        updateIndicators()
      }
    }
  }, [isDragging, isPlaybackActive, playbackIndicator, updateIndicators])

  const areaPaths = useMemo(
    () => buildAreaPaths(analysis.frames, estimatedDuration, height, width, toLogScale),
    [analysis.frames, estimatedDuration, height, width],
  )

  const quietRects = useMemo(
    () => buildQuietRects(analysis.quietRegions, estimatedDuration, width),
    [analysis.quietRegions, estimatedDuration, width],
  )

  const boundaryLines = useMemo(
    () => buildBoundaryLines(analysis.chunkBoundaries, estimatedDuration, width),
    [analysis.chunkBoundaries, estimatedDuration, width],
  )

  const chunkSummaries = useMemo(() => describeChunks(analysis.chunks), [analysis.chunks])

  const thresholdY = (1 - toLogScale(analysis.stats.normalizedThreshold)) * height
  const scrollClassName = [
    'chunking-graph-scroll',
    isDragging ? 'is-dragging' : '',
    showLeftIndicator ? 'show-left-indicator' : '',
    showRightIndicator ? 'show-right-indicator' : '',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div className="chunking-graph">
      <header className="chunking-graph-header">
        <h4>Volume histogram</h4>
        <div className="chunking-graph-meta">
          <span>Frames: {analysis.stats.frameCount}</span>
          <span>Duration: {formatDuration(estimatedDuration)}</span>
        </div>
      </header>
      <div className="chunking-graph-body">
        <div
          className={scrollClassName}
          ref={scrollContainerRef}
          onScroll={handleScroll}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onPointerLeave={(event) => {
            if (isDragging) {
              endDrag(event)
            }
          }}
        >
          <svg
            className="chunking-graph-svg"
            role="img"
            viewBox={`0 0 ${width} ${height}`}
            width={width}
            height={height}
            aria-label="Volume histogram with proposed chunk boundaries"
            preserveAspectRatio="none"
          >
            <rect x={0} y={0} width={width} height={height} fill="rgba(15, 23, 42, 0.85)" />
            {quietRects.map((rect, index) => (
              <rect
                key={`quiet-${index}`}
                x={rect.x}
                y={0}
                width={Math.max(1.5, rect.rectWidth)}
                height={height}
                fill="rgba(56, 189, 248, 0.12)"
              />
            ))}
            {areaPaths.map((segmentPath, index) => (
              <path
                key={`histogram-${index}`}
                d={segmentPath}
                fill={`url(#${gradientId})`}
                stroke="rgba(94, 234, 212, 0.48)"
                strokeWidth={1}
              />
            ))}
              {playbackIndicator ? (
                <g className="chunking-playback-indicator" aria-hidden="true">
                  <rect
                    x={playbackIndicator.glowX}
                    y={0}
                    width={playbackIndicator.glowWidth}
                    height={height}
                    fill="rgba(34, 197, 94, 0.28)"
                  />
                  <rect
                    x={playbackIndicator.mainX}
                    y={0}
                    width={playbackIndicator.mainWidth}
                    height={height}
                    fill="rgba(34, 197, 94, 0.95)"
                  />
                </g>
              ) : null}
            <line
              x1={0}
              y1={thresholdY}
              x2={width}
              y2={thresholdY}
              strokeDasharray="6 6"
              stroke="rgba(250, 204, 21, 0.9)"
              strokeWidth={1}
            />
            {boundaryLines.map((line, index) => (
              <g key={`boundary-${index}`}>
                <rect x={line.x - 2} y={0} width={4} height={height} fill="rgba(251, 146, 60, 0.24)" />
                <line x1={line.x} y1={0} x2={line.x} y2={height} stroke="#facc15" strokeWidth={1.5} />
              </g>
            ))}
            <defs>
              <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="rgba(94, 234, 212, 0.55)" />
                <stop offset="100%" stopColor="rgba(56, 189, 248, 0.15)" />
              </linearGradient>
            </defs>
          </svg>
        </div>
        {targetRange ? (
          <div className="chunking-target-hint">
            Target chunk length: {formatDuration(targetRange.minMs)} – {formatDuration(targetRange.maxMs)} (ideal{' '}
            {formatDuration(targetRange.idealMs)})
          </div>
        ) : null}
        <dl className="chunking-stats">
          <div>
            <dt>Noise floor</dt>
            <dd>{analysis.stats.noiseFloor.toFixed(5)}</dd>
          </div>
          <div>
            <dt>Silence threshold</dt>
            <dd>{analysis.stats.threshold.toFixed(5)}</dd>
          </div>
          <div>
            <dt>Peak RMS</dt>
            <dd>{analysis.stats.maxRms.toFixed(5)}</dd>
          </div>
          <div>
            <dt>Quiet regions</dt>
            <dd>{analysis.quietRegions.length}</dd>
          </div>
          <div>
            <dt>Proposed breaks</dt>
            <dd>{analysis.chunkBoundaries.length}</dd>
          </div>
        </dl>
      </div>
      <div className="chunking-chunk-list">
        <h5>Proposed chunks</h5>
        {chunkSummaries.length === 0 ? (
          <p className="chunking-empty">No proposed breaks yet. Recording may be too short or lacks silence.</p>
        ) : (
          <ul>
            {chunkSummaries.map((chunk) => (
              <li key={chunk.id}>
                <span className="chunking-chunk-label">{chunk.label}</span>
                <span>{formatDuration(chunk.durationMs)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

export const RecordingChunkingGraph = memo(RecordingChunkingGraphComponent)

