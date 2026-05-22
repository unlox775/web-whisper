import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  manifestService,
  type SessionRecord,
  type SessionStatus,
} from '../modules/storage/manifest'
import './RecordingsListV2.css'

type LabEvent = {
  id: number
  at: number
  label: string
  detail?: string
  count: number
}

type DbCall = {
  id: number
  label: string
  offset: number
  limit: number
  rows: number
  durationMs: number
  estimatedBytes: number
}

type LoadedPage = {
  offset: number
  limit: number
}

export type RecordingsListV2Props = {
  pageSize?: number
  rowHeight?: number
  overscanRows?: number
  onOpenRecording?: (session: SessionRecord) => void
}

type SessionDisplayStatus = SessionStatus

const STATUS_META: Record<SessionDisplayStatus, { label: string; pillClass: string }> = {
  recording: { label: 'Recording', pillClass: 'pill-progress' },
  ready: { label: 'Ready', pillClass: 'pill-synced' },
  error: { label: 'Error', pillClass: 'pill-attention' },
}

const DEFAULT_PAGE_SIZE = 50
const DEFAULT_ROW_HEIGHT = 86
const DEFAULT_OVERSCAN_ROWS = 8
const MAX_EVENTS = 80

const formatClock = (timestamp: number) =>
  new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' }).format(new Date(timestamp))

const formatSessionDateTime = (timestamp: number) =>
  new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(timestamp))

const formatCompactDataSize = (bytes: number) => {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = bytes
  let unitIndex = 0
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex += 1
  }
  return `${Math.round(value)} ${units[unitIndex]}`
}

const formatSessionDuration = (durationMs: number) => {
  const totalSeconds = Math.max(0, Math.round(durationMs / 1000))
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`
  }
  if (minutes > 0) {
    return `${minutes}:${seconds.toString().padStart(2, '0')}`
  }
  return `0:${seconds.toString().padStart(2, '0')}`
}

const estimateSessionBytes = (session: SessionRecord) => {
  const jsonBytes = new TextEncoder().encode(JSON.stringify(session)).byteLength
  return jsonBytes
}

const rangeLabel = (start: number, end: number) => `${start.toLocaleString()}-${end.toLocaleString()}`

export function RecordingsListV2({
  pageSize = DEFAULT_PAGE_SIZE,
  rowHeight = DEFAULT_ROW_HEIGHT,
  overscanRows = DEFAULT_OVERSCAN_ROWS,
  onOpenRecording,
}: RecordingsListV2Props) {
  const [sessionsByIndex, setSessionsByIndex] = useState<Map<number, SessionRecord>>(() => new Map())
  const [loadedPages, setLoadedPages] = useState<LoadedPage[]>([])
  const [loadingPages, setLoadingPages] = useState<Set<number>>(() => new Set())
  const [totalCount, setTotalCount] = useState(0)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewportHeight, setViewportHeight] = useState(0)
  const [events, setEvents] = useState<LabEvent[]>([])
  const [dbCalls, setDbCalls] = useState<DbCall[]>([])
  const [error, setError] = useState<string | null>(null)
  const scrollerRef = useRef<HTMLDivElement | null>(null)
  const eventIdRef = useRef(0)
  const dbCallIdRef = useRef(0)

  const pushEvent = useCallback((label: string, detail?: string) => {
    setEvents((prev) => {
      const latest = prev[0]
      if (latest?.label === label && latest.detail === detail) {
        return [{ ...latest, at: Date.now(), count: latest.count + 1 }, ...prev.slice(1)]
      }
      const next: LabEvent = {
        id: ++eventIdRef.current,
        at: Date.now(),
        label,
        detail,
        count: 1,
      }
      return [next, ...prev].slice(0, MAX_EVENTS)
    })
  }, [])

  const loadedCount = sessionsByIndex.size
  const totalLoadedBytes = useMemo(() => {
    let total = 0
    sessionsByIndex.forEach((session) => {
      total += estimateSessionBytes(session)
    })
    return total
  }, [sessionsByIndex])

  const startIndex = Math.max(0, Math.floor(scrollTop / rowHeight) - overscanRows)
  const visibleCapacity = Math.max(1, Math.ceil(viewportHeight / rowHeight) + overscanRows * 2)
  const endIndex = Math.min(Math.max(totalCount, loadedCount), startIndex + visibleCapacity)
  const pageStart = Math.floor(startIndex / pageSize) * pageSize
  const pageEnd = Math.floor(Math.max(endIndex - 1, 0) / pageSize) * pageSize

  const loadPage = useCallback(
    async (offset: number) => {
      if (loadingPages.has(offset)) return
      if (loadedPages.some((page) => page.offset === offset)) return

      setLoadingPages((prev) => new Set(prev).add(offset))
      pushEvent('db page requested', `offset ${offset}, limit ${pageSize}`)
      const started = performance.now()
      try {
        const page = await manifestService.listSessionsPage(offset, pageSize)
        const durationMs = Math.round(performance.now() - started)
        const estimatedBytes = page.sessions.reduce((sum, session) => sum + estimateSessionBytes(session), 0)
        setSessionsByIndex((prev) => {
          const next = new Map(prev)
          page.sessions.forEach((session, index) => {
            next.set(page.offset + index, session)
          })
          return next
        })
        setLoadedPages((prev) =>
          [...prev, { offset: page.offset, limit: page.limit }].sort((a, b) => a.offset - b.offset),
        )
        setTotalCount(page.totalCount)
        setDbCalls((prev) => [
          {
            id: ++dbCallIdRef.current,
            label: 'manifest.listSessionsPage',
            offset: page.offset,
            limit: page.limit,
            rows: page.sessions.length,
            durationMs,
            estimatedBytes,
          },
          ...prev,
        ].slice(0, 30))
        pushEvent(
          'db page loaded',
          `${page.sessions.length} rows in ${durationMs}ms (${formatCompactDataSize(estimatedBytes)})`,
        )
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        setError(message)
        pushEvent('db page failed', message)
      } finally {
        setLoadingPages((prev) => {
          const next = new Set(prev)
          next.delete(offset)
          return next
        })
      }
    },
    [loadedPages, loadingPages, pageSize, pushEvent],
  )

  useEffect(() => {
    void loadPage(0)
  }, [loadPage])

  useEffect(() => {
    const node = scrollerRef.current
    if (!node) return
    const updateSize = () => setViewportHeight(node.clientHeight)
    updateSize()
    const resizeObserver = new ResizeObserver(updateSize)
    resizeObserver.observe(node)
    return () => resizeObserver.disconnect()
  }, [])

  useEffect(() => {
    if (totalCount === 0 && loadedCount === 0) return
    for (let offset = pageStart; offset <= pageEnd; offset += pageSize) {
      void loadPage(offset)
    }
  }, [loadPage, loadedCount, pageEnd, pageSize, pageStart, totalCount])

  const visibleRows = useMemo(() => {
    const rows: Array<{ index: number; session: SessionRecord | null }> = []
    for (let index = startIndex; index < endIndex; index += 1) {
      rows.push({ index, session: sessionsByIndex.get(index) ?? null })
    }
    return rows
  }, [endIndex, sessionsByIndex, startIndex])

  const totalHeight = Math.max(totalCount, loadedCount, 1) * rowHeight
  const visibleRangeText =
    endIndex > startIndex ? rangeLabel(startIndex + 1, endIndex) : 'none'
  const loadedRangesText =
    loadedPages.length === 0
      ? 'none'
      : loadedPages
          .map((page) => rangeLabel(page.offset + 1, page.offset + page.limit))
          .join(', ')

  const handleScroll = (event: React.UIEvent<HTMLDivElement>) => {
    const nextTop = event.currentTarget.scrollTop
    setScrollTop(nextTop)
  }

  const handleOpen = (session: SessionRecord) => {
    pushEvent('recording click', `${session.title || session.id} (${session.id.slice(0, 8)})`)
    onOpenRecording?.(session)
  }

  return (
    <div className="recordings-lab-shell">
      <main className="recordings-lab-preview" aria-label="Recordings list V2 preview">
        <header className="recordings-lab-preview-header">
          <div>
            <p className="recordings-lab-eyebrow">V2 lab component</p>
            <h1>Recordings list</h1>
          </div>
          <div className="recordings-lab-preview-actions">
            <a className="recordings-lab-home-link" href="./">
              Back to home
            </a>
            <div className="recordings-lab-mini-stat">
              <span>{loadedCount.toLocaleString()}</span>
              <small>/ {totalCount.toLocaleString()} rows loaded</small>
            </div>
          </div>
        </header>
        {error ? <p className="recordings-lab-error">Storage read failed: {error}</p> : null}
        <div ref={scrollerRef} className="recordings-v2-scroller" onScroll={handleScroll}>
          <div className="recordings-v2-runway" style={{ height: totalHeight }}>
            <div
              className="recordings-v2-window"
              style={{
                transform: `translateY(${startIndex * rowHeight}px)`,
              }}
            >
              {visibleRows.map(({ index, session }) => (
                <div key={index} className="recordings-v2-row" style={{ height: rowHeight }}>
                  {session ? (
                    <RecordingCard session={session} onOpen={handleOpen} />
                  ) : (
                    <article className="session-card recordings-v2-skeleton" aria-label={`Loading row ${index + 1}`}>
                      <span />
                      <span />
                    </article>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      </main>
      <aside className="recordings-lab-telemetry" aria-label="Recordings list telemetry">
        <section className="recordings-lab-panel">
          <p className="recordings-lab-eyebrow">Live telemetry</p>
          <div className="recordings-lab-grid">
            <Metric label="Total rows" value={totalCount.toLocaleString()} />
            <Metric label="Loaded rows" value={loadedCount.toLocaleString()} />
            <Metric label="Loaded payload" value={formatCompactDataSize(totalLoadedBytes)} />
            <Metric label="Render window" value={visibleRangeText} />
            <Metric label="Page size" value={pageSize.toLocaleString()} />
            <Metric label="Loading pages" value={loadingPages.size.toLocaleString()} />
          </div>
        </section>
        <section className="recordings-lab-panel">
          <h2>Loaded ranges</h2>
          <p className="recordings-lab-mono">{loadedRangesText}</p>
        </section>
        <section className="recordings-lab-panel">
          <h2>Database calls</h2>
          <div className="recordings-lab-call-list">
            {dbCalls.length === 0 ? (
              <p className="recordings-lab-muted">No calls yet.</p>
            ) : (
              dbCalls.map((call) => (
                <article key={call.id} className="recordings-lab-call">
                  <strong>{call.label}</strong>
                  <span>
                    offset {call.offset}, {call.rows}/{call.limit} rows, {call.durationMs}ms,{' '}
                    {formatCompactDataSize(call.estimatedBytes)}
                  </span>
                </article>
              ))
            )}
          </div>
        </section>
        <section className="recordings-lab-panel recordings-lab-events">
          <h2>Event ticker</h2>
          <div className="recordings-lab-event-list">
            {events.length === 0 ? (
              <p className="recordings-lab-muted">Waiting for activity.</p>
            ) : (
              events.map((event) => (
                <article key={event.id} className="recordings-lab-event">
                  <time>{formatClock(event.at)}</time>
                  <div>
                    <strong>
                      {event.label}
                      {event.count > 1 ? ` x${event.count}` : ''}
                    </strong>
                    {event.detail ? <span>{event.detail}</span> : null}
                  </div>
                </article>
              ))
            )}
          </div>
        </section>
      </aside>
    </div>
  )
}

function RecordingCard({ session, onOpen }: { session: SessionRecord; onOpen: (session: SessionRecord) => void }) {
  const statusMeta = STATUS_META[session.status]
  const previewText =
    session.status === 'recording'
      ? 'Recording in progress...'
      : session.status === 'error'
        ? session.notes || 'Recording error.'
        : session.notes || 'Recording complete. Preview text is intentionally not loaded in V2.'

  return (
    <article
      className={`session-card${session.status === 'error' ? ' has-error' : ''}`}
      role="button"
      tabIndex={0}
      onClick={() => onOpen(session)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onOpen(session)
        }
      }}
    >
      <header className="session-topline">
        <div className="session-topline-left">
          <span className={`session-pill ${statusMeta.pillClass}`}>{statusMeta.label}</span>
          <span className="session-duration-label">{formatSessionDuration(session.durationMs)}</span>
        </div>
        <div className="session-topline-right">
          <span className="session-meta">
            {formatSessionDateTime(session.startedAt)} · {formatCompactDataSize(session.totalBytes)}
          </span>
        </div>
      </header>
      <div className="session-preview-row">
        <p className="session-preview">{previewText}</p>
      </div>
    </article>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="recordings-lab-metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}
