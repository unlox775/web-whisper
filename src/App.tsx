import { useMemo, useState } from 'react'
import './App.css'

type RecordingStatus = 'recording' | 'uploading' | 'transcribing' | 'ready' | 'error'

type RecordingSummary = {
  id: string
  startedAt: string
  durationLabel: string
  preview: string
  status: RecordingStatus
  lastUpdated: string
  errorMessage?: string
}

const SAMPLE_RECORDINGS: RecordingSummary[] = [
  {
    id: 'sess-2025-11-05-1',
    startedAt: 'Nov 5, 10:02',
    durationLabel: '14m 12s',
    preview: 'Team sync kickoff, covering cadence heuristics and buffer safeguards…',
    status: 'uploading',
    lastUpdated: '10:17',
  },
  {
    id: 'sess-2025-11-04-2',
    startedAt: 'Nov 4, 18:40',
    durationLabel: '32m 48s',
    preview: 'Retrospective on QA audio fixtures with overlapping speakers and hum control…',
    status: 'ready',
    lastUpdated: 'Completed',
  },
  {
    id: 'sess-2025-11-04-1',
    startedAt: 'Nov 4, 12:05',
    durationLabel: '07m 04s',
    preview: 'Upload stalled during hotel Wi-Fi outage, marked for manual retry.',
    status: 'error',
    lastUpdated: 'Needs retry',
    errorMessage: 'Upload timed out — tap “Retry upload” to resume.',
  },
]

const LIVE_TRANSCRIPTION_SAMPLE = [
  '…and that gives us a 1.5 second tail so the snip feels natural.',
  'Right now the upload queue is clear — keep recording, we are still live.',
  'Let me drop a note to verify the background hum tolerance with the fixtures.',
]

const STATUS_LABELS: Record<RecordingStatus, string> = {
  recording: 'Recording',
  uploading: 'Uploading',
  transcribing: 'Transcribing',
  ready: 'Ready',
  error: 'Attention needed',
}

function App() {
  const [isRecording, setIsRecording] = useState(false)
  const [recordings] = useState<RecordingSummary[]>(SAMPLE_RECORDINGS)
  const [transcriptionLines] = useState<string[]>(LIVE_TRANSCRIPTION_SAMPLE)

  const bufferUsage = useMemo(() => ({ pendingMb: 28.4, limitMb: 200 }), [])

  const toggleRecording = () => {
    setIsRecording((prev) => !prev)
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="app-title">
          <h1>Durable Recorder</h1>
          <span className={`status-badge ${isRecording ? 'status-recording' : 'status-idle'}`}>
            {isRecording ? 'Recording' : 'Idle'}
          </span>
        </div>
        <div className="header-actions">
          <div className="buffer-indicator" role="status" aria-live="polite">
            <span className="buffer-label">Buffer</span>
            <span className="buffer-value">
              {bufferUsage.pendingMb.toFixed(1)} / {bufferUsage.limitMb} MB
            </span>
          </div>
          <button className="settings-button" type="button">
            Settings
          </button>
        </div>
      </header>

      <main className="content">
        <section className="recordings-panel" aria-label="Recording sessions">
          <header className="panel-header">
            <h2>Sessions</h2>
            <button className="refresh-button" type="button">
              Refresh
            </button>
          </header>
          <ul className="recordings-list">
            {recordings.map((session) => (
              <li key={session.id} className="recording-card">
                <div className="card-heading">
                  <span className={`pill pill-${session.status}`}>
                    {STATUS_LABELS[session.status]}
                  </span>
                  <span className="timestamp">Started {session.startedAt}</span>
                </div>
                <p className="recording-preview">{session.preview}</p>
                <div className="card-footer">
                  <span className="duration">Duration {session.durationLabel}</span>
                  {session.status === 'error' ? (
                    <button className="retry-button" type="button">
                      Retry upload
                    </button>
                  ) : (
                    <span className="last-updated">{session.lastUpdated}</span>
                  )}
                </div>
                {session.errorMessage ? (
                  <p className="error-hint" role="alert">
                    {session.errorMessage}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        </section>

        <aside className="controls-panel" aria-label="Capture controls">
          <div className="controls-card">
            <p className="controls-caption">Capture</p>
            <button
              className={`record-toggle ${isRecording ? 'record-toggle-stop' : 'record-toggle-start'}`}
              type="button"
              onClick={toggleRecording}
            >
              {isRecording ? 'Stop recording' : 'Start recording'}
            </button>
            <button className="marker-button" type="button" disabled={!isRecording}>
              Drop snip marker
            </button>
            <p className="controls-hint">
              Recording is {isRecording ? 'live. Uploading chunks automatically.' : 'paused. Ready when you are.'}
            </p>
          </div>
        </aside>
      </main>

      <section className="transcription-panel" aria-live="polite" aria-label="Live transcription">
        <header className="transcription-header">
          <h2>Live transcription</h2>
          <span className="transcription-meta">Auto-snipping enabled · 1 s overlap</span>
        </header>
        <div className="transcription-stream">
          {transcriptionLines.map((line, index) => (
            <p key={`${index}-${line.slice(0, 8)}`} className="transcription-line">
              {line}
            </p>
          ))}
          <div className="transcription-fade" aria-hidden="true" />
        </div>
      </section>
    </div>
  )
}

export default App
