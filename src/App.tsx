import { useEffect, useMemo, useRef, useState } from 'react'
import type { MouseEvent } from 'react'
import './App.css'

type RecordingStatus = 'in-progress' | 'synced' | 'attention'

type RecordingSummary = {
  id: string
  title: string
  preview: string
  startedAt: string
  updatedAt: string
  durationMs: number
  status: RecordingStatus
  notes?: string
  totalBytes: number
  chunkCount: number
}

const SAMPLE_RECORDINGS: RecordingSummary[] = [
  {
    id: 'sess-2025-11-05-1',
    title: 'Adaptive cadence experiments',
    preview: 'Testing staggered pause detection after refactoring the snip buffer…',
    startedAt: '2025-11-05T10:02:00-07:00',
    updatedAt: '2025-11-05T10:17:12-07:00',
    durationMs: 14 * 60 * 1000 + 12 * 1000,
    status: 'in-progress',
    notes: 'Chunk 46/90 uploaded, awaiting Wi‑Fi resume.',
    totalBytes: 58_200_000,
    chunkCount: 46,
  },
  {
    id: 'sess-2025-11-04-2',
    title: 'QA audio fixtures planning',
    preview: 'Outlined required .m4a samples: baseline speech, hum, overlapping speakers…',
    startedAt: '2025-11-04T18:40:00-07:00',
    updatedAt: '2025-11-04T19:12:48-07:00',
    durationMs: 32 * 60 * 1000 + 48 * 1000,
    status: 'synced',
    totalBytes: 129_800_000,
    chunkCount: 96,
  },
  {
    id: 'sess-2025-11-04-1',
    title: 'Hotel Wi‑Fi outage postmortem',
    preview: 'Upload stalled mid-session; need background retry once signal returns.',
    startedAt: '2025-11-04T12:05:00-07:00',
    updatedAt: '2025-11-04T12:14:04-07:00',
    durationMs: 7 * 60 * 1000 + 4 * 1000,
    status: 'attention',
    notes: 'Upload timed out — retry required.',
    totalBytes: 20_400_000,
    chunkCount: 18,
  },
]

const SIMULATED_STREAM = [
  'Holding a steady floor — last snip landed at 14:17.2.',
  'Uploader healthy, chunk latency ~1.2 s.',
  'Listening for extended pauses before the next break…',
  'Stashing 3.8 s of tail audio for zero-cross alignment.',
]

const STATUS_META: Record<RecordingStatus, { label: string; pillClass: string }> = {
  'in-progress': { label: 'In progress', pillClass: 'pill-progress' },
  synced: { label: 'Synced', pillClass: 'pill-synced' },
  attention: { label: 'Needs action', pillClass: 'pill-attention' },
}

const MB = 1024 * 1024

const formatClock = (iso: string) =>
  new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' }).format(new Date(iso))

const formatDate = (iso: string) =>
  new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(new Date(iso))

const formatDuration = (durationMs: number) => {
  const totalSeconds = Math.max(0, Math.round(durationMs / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  const hours = Math.floor(minutes / 60)
  const remainingMinutes = minutes % 60
  if (hours > 0) {
    return `${hours}h ${remainingMinutes.toString().padStart(2, '0')}m`
  }
  return `${remainingMinutes}m ${seconds.toString().padStart(2, '0')}s`
}

const toMbLabel = (bytes: number) => `${(bytes / MB).toFixed(1)} MB`

function App() {
  const [isRecording, setIsRecording] = useState(false)
  const [recordings] = useState<RecordingSummary[]>(SAMPLE_RECORDINGS)
  const [selectedRecordingId, setSelectedRecordingId] = useState<string | null>(null)
  const [transcriptionLines, setTranscriptionLines] = useState<string[]>(SIMULATED_STREAM.slice(0, 2))
  const streamCursor = useRef(1)

  useEffect(() => {
    if (!isRecording) {
      return
    }
    const interval = window.setInterval(() => {
      streamCursor.current = (streamCursor.current + 1) % SIMULATED_STREAM.length
      const nextLine = SIMULATED_STREAM[streamCursor.current]
      setTranscriptionLines((prev) => [...prev.slice(-2), nextLine])
    }, 3200)
    return () => window.clearInterval(interval)
  }, [isRecording])

  const bufferUsage = useMemo(() => {
    const totalBytes = recordings.reduce((sum, session) => sum + session.totalBytes, 0)
    const limitBytes = 200 * MB
    return {
      totalBytes,
      limitBytes,
      label: `${(totalBytes / MB).toFixed(1)} / ${(limitBytes / MB).toFixed(0)} MB`,
    }
  }, [recordings])

  const selectedRecording = useMemo(
    () => recordings.find((session) => session.id === selectedRecordingId) ?? null,
    [recordings, selectedRecordingId],
  )

  const toggleRecording = () => {
    setIsRecording((prev) => !prev)
  }

  const handleRetry = (event: MouseEvent<HTMLButtonElement>, record: RecordingSummary) => {
    event.stopPropagation()
    console.info('[UI] retry upload requested', record.id)
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="brand">
          <h1>Durable Recorder</h1>
          <p className="brand-subtitle">Continuous capture, chunked for resilience.</p>
        </div>
        <div className="header-controls">
          <div className="buffer-card" role="status" aria-live="polite">
            <p className="buffer-label">Buffered locally</p>
            <p className="buffer-value">{bufferUsage.label}</p>
          </div>
          <button className="settings-button" type="button" disabled>
            Settings (soon)
          </button>
        </div>
      </header>

      <main className="content-grid">
        <section className="session-section" aria-label="Recording sessions">
          <ul className="session-list">
            {recordings.map((session) => {
              const status = STATUS_META[session.status]
              return (
                <li key={session.id}>
                  <article
                    className="session-card"
                    role="button"
                    tabIndex={0}
                    onClick={() => setSelectedRecordingId(session.id)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault()
                        setSelectedRecordingId(session.id)
                      }
                    }}
                  >
                    <header className="session-topline">
                      <span className={`session-pill ${status.pillClass}`}>{status.label}</span>
                      <span className="session-times">
                        {formatClock(session.updatedAt)} @ {formatDate(session.startedAt)} {formatClock(session.startedAt)}
                      </span>
                    </header>
                    <h2 className="session-title">{session.title}</h2>
                    <p className="session-preview">{session.preview}</p>
                    <footer className="session-footer">
                      <span className="session-meta">{formatDuration(session.durationMs)} · {toMbLabel(session.totalBytes)}</span>
                      {session.status === 'attention' ? (
                        <button className="session-retry" type="button" onClick={(event) => handleRetry(event, session)}>
                          Retry
                        </button>
                      ) : (
                        <span className="session-chunks">{session.chunkCount} chunks</span>
                      )}
                    </footer>
                    {session.notes ? (
                      <p className="session-notes" role="note">
                        {session.notes}
                      </p>
                    ) : null}
                  </article>
                </li>
              )
            })}
          </ul>
        </section>

        <aside className="controls-panel" aria-label="Capture controls">
          <div className="controls-card">
            <h2>Capture</h2>
            <button
              className={`record-toggle ${isRecording ? 'record-toggle-stop' : 'record-toggle-start'}`}
              type="button"
              onClick={toggleRecording}
            >
              {isRecording ? 'Stop recording' : 'Start recording'}
            </button>
            <p className="controls-copy">
              Recorder {isRecording ? 'running — UI reflects upcoming MVP targets.' : 'idle — capture loop pending implementation.'}
            </p>
          </div>
        </aside>
      </main>

      <section className="transcription-panel" aria-live="polite" aria-label="Live transcription preview">
        <header className="transcription-header">
          <h2>Live transcription (simulated)</h2>
          <span className="transcription-meta">Real streaming will appear here once Groq integration lands.</span>
        </header>
        <div className="transcription-stream">
          {transcriptionLines.map((line, index) => (
            <p key={`${index}-${line.slice(0, 12)}`} className="transcription-line">
              {line}
            </p>
          ))}
          <div className="transcription-fade" aria-hidden="true" />
        </div>
      </section>

      {selectedRecording ? (
        <div className="detail-overlay" role="dialog" aria-modal="true" aria-labelledby="recording-detail-title">
          <div className="detail-panel">
            <header className="detail-header">
              <div>
                <p className="detail-label">Recording</p>
                <h2 id="recording-detail-title">{selectedRecording.title}</h2>
              </div>
              <button className="detail-close" type="button" onClick={() => setSelectedRecordingId(null)}>
                Close
              </button>
            </header>
            <div className="detail-body">
              <div className="detail-summary">
                <p>
                  <strong>Captured:</strong> {formatDate(selectedRecording.startedAt)} {formatClock(selectedRecording.startedAt)} →{' '}
                  {formatClock(selectedRecording.updatedAt)}
                </p>
                <p>
                  <strong>Length:</strong> {formatDuration(selectedRecording.durationMs)} · {selectedRecording.chunkCount} chunks ·{' '}
                  {toMbLabel(selectedRecording.totalBytes)}
                </p>
              </div>
              <button className="detail-play" type="button" onClick={() => console.info('Playback stub', selectedRecording.id)}>
                Play (stub)
              </button>
              <div className="detail-transcription">
                <h3>Transcription</h3>
                <p className="detail-transcription-placeholder">Not yet implemented — will stream from Groq once wired.</p>
              </div>
              {selectedRecording.notes ? <p className="detail-notes">{selectedRecording.notes}</p> : null}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}

export default App
