import { memo, useMemo, useId } from 'react'
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

const buildAreaPath = (
  frames: RecordingChunkAnalysis['frames'],
  totalDurationMs: number,
  height: number,
  width: number,
) => {
  if (frames.length === 0 || totalDurationMs <= 0) {
    return ''
  }
  const commands: string[] = [`M 0 ${height}`]
  const lastFrame = frames[frames.length - 1]
  frames.forEach((frame) => {
    const midpointMs = (frame.startMs + frame.endMs) / 2
    const x = Math.min(width, (midpointMs / totalDurationMs) * width)
    const y = Math.max(0, Math.min(height, (1 - frame.normalized) * height))
    commands.push(`L ${x.toFixed(2)} ${y.toFixed(2)}`)
  })
  commands.push(`L ${Math.max(width, (lastFrame.endMs / totalDurationMs) * width).toFixed(2)} ${height}`)
  commands.push('Z')
  return commands.join(' ')
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

const RecordingChunkingGraphComponent = ({ analysis, targetRange }: RecordingChunkingGraphProps) => {
  const width = Math.max(640, analysis.frames.length)
  const height = 120
  const totalDurationMs = analysis.stats.totalDurationMs
  const gradientId = useId()

  const areaPath = useMemo(
    () => buildAreaPath(analysis.frames, totalDurationMs, height, width),
    [analysis.frames, totalDurationMs, height, width],
  )

  const quietRects = useMemo(
    () => buildQuietRects(analysis.quietRegions, totalDurationMs, width),
    [analysis.quietRegions, totalDurationMs, width],
  )

  const boundaryLines = useMemo(
    () => buildBoundaryLines(analysis.chunkBoundaries, totalDurationMs, width),
    [analysis.chunkBoundaries, totalDurationMs, width],
  )

  const chunkSummaries = useMemo(() => describeChunks(analysis.chunks), [analysis.chunks])

  const thresholdY = (1 - analysis.stats.normalizedThreshold) * height

  return (
    <div className="chunking-graph">
      <header className="chunking-graph-header">
        <h4>Volume histogram</h4>
        <div className="chunking-graph-meta">
          <span>Frames: {analysis.stats.frameCount}</span>
          <span>Duration: {formatDuration(totalDurationMs)}</span>
        </div>
      </header>
      <div className="chunking-graph-body">
        <svg
          className="chunking-graph-svg"
          role="img"
          viewBox={`0 0 ${width} ${height}`}
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
          {areaPath ? (
            <path d={areaPath} fill={`url(#${gradientId})`} stroke="rgba(94, 234, 212, 0.48)" strokeWidth={1} />
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
              <rect
                x={line.x - 2}
                y={0}
                width={4}
                height={height}
                fill="rgba(251, 146, 60, 0.24)"
              />
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

