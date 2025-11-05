import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import type { MouseEvent } from 'react'
import './App.css'
import { captureController } from './modules/capture/controller'
import {
  manifestService,
  type ChunkRecord,
  type SessionRecord,
} from './modules/storage/manifest'
import { settingsStore } from './modules/settings/store'

const SIMULATED_STREAM = [
  'Holding a steady floor — last snip landed cleanly.',
  'Uploader healthy, chunk latency ~1.2 s.',
  'Listening for extended pauses before the next break…',
  'Stashing 3.8 s of tail audio for zero-cross alignment.',
]

const STATUS_META: Record<SessionRecord['status'], { label: string; pillClass: string }> = {
  recording: { label: 'Recording', pillClass: 'pill-progress' },
  ready: { label: 'Ready', pillClass: 'pill-synced' },
  error: { label: 'Needs action', pillClass: 'pill-attention' },
}

const MB = 1024 * 1024
const BUFFER_LIMIT_BYTES = 200 * MB

const formatClock = (timestamp: number) =>
  new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' }).format(new Date(timestamp))

const formatDate = (timestamp: number) =>
  new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(new Date(timestamp))

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
  const [recordings, setRecordings] = useState<SessionRecord[]>([])
  const [selectedRecordingId, setSelectedRecordingId] = useState<string | null>(null)
  const [chunkMetadata, setChunkMetadata] = useState<ChunkRecord[]>([])
  const [isRecording, setIsRecording] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [bufferTotals, setBufferTotals] = useState<{ totalBytes: number; limitBytes: number }>(
    () => ({ totalBytes: 0, limitBytes: BUFFER_LIMIT_BYTES }),
  )
  const [transcriptionLines, setTranscriptionLines] = useState<string[]>(SIMULATED_STREAM.slice(0, 2))
  const streamCursor = useRef(1)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const audioUrlRef = useRef<string | null>(null)
  const [isLoadingPlayback, setIsLoadingPlayback] = useState(false)
  const [playbackError, setPlaybackError] = useState<string | null>(null)

  const loadSessions = useCallback(async () => {
    await manifestService.init()
    const [sessions, totals] = await Promise.all([
      manifestService.listSessions(),
      manifestService.storageTotals(),
    ])
    setRecordings(sessions)
    setBufferTotals({ totalBytes: totals.totalBytes, limitBytes: BUFFER_LIMIT_BYTES })
  }, [])

  useEffect(() => {
    void loadSessions()
  }, [loadSessions])

  useEffect(() => {
    if (!isRecording) {
      return
    }
    const interval = window.setInterval(() => {
      streamCursor.current = (streamCursor.current + 1) % SIMULATED_STREAM.length
      const nextLine = SIMULATED_STREAM[streamCursor.current]
      setTranscriptionLines((prev) => [...prev.slice(-2), nextLine])
      void loadSessions()
    }, 3500)
    return () => window.clearInterval(interval)
  }, [isRecording, loadSessions])

  useEffect(() => {
    let cancelled = false
    if (!selectedRecordingId) {
      setChunkMetadata([])
      return
    }
    ;(async () => {
      const metadata = await manifestService.getChunkMetadata(selectedRecordingId)
      if (!cancelled) {
        setChunkMetadata(metadata)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [selectedRecordingId])

  useEffect(() => {
    return () => {
      if (audioUrlRef.current) {
        URL.revokeObjectURL(audioUrlRef.current)
        audioUrlRef.current = null
      }
    }
  }, [])

  const selectedRecording = useMemo(
    () => recordings.find((session) => session.id === selectedRecordingId) ?? null,
    [recordings, selectedRecordingId],
  )

  const refreshAndClearErrors = useCallback(async () => {
    setErrorMessage(null)
    await loadSessions()
  }, [loadSessions])

  const startRecording = useCallback(async () => {
    if (isRecording) return
    let sessionId = ''
    try {
      setErrorMessage(null)
      const settings = await settingsStore.get()
      sessionId = window.crypto?.randomUUID?.() ?? `session-${Date.now()}`
      const now = Date.now()
      await manifestService.createSession({
        id: sessionId,
        title: `Recording ${new Intl.DateTimeFormat(undefined, {
          hour: '2-digit',
          minute: '2-digit',
          hour12: false,
        }).format(now)}`,
        startedAt: now,
        updatedAt: now,
        status: 'recording',
        totalBytes: 0,
        chunkCount: 0,
        durationMs: 0,
        mimeType: null,
        notes: 'Transcription pending…',
      })
      await captureController.start({
        sessionId,
        targetBitrate: settings.targetBitrate,
        chunkDurationMs: 4000,
      })
      setIsRecording(true)
      await loadSessions()
    } catch (error) {
      console.error('[UI] Failed to start recording', error)
      if (sessionId) {
        await manifestService.updateSession(sessionId, {
          status: 'error',
          notes: 'Recording failed to start.',
          updatedAt: Date.now(),
        })
      }
      await loadSessions()
      setErrorMessage(error instanceof Error ? error.message : String(error))
    }
  }, [isRecording, loadSessions])

  const stopRecording = useCallback(async () => {
    if (!isRecording) return
    try {
      await captureController.stop()
    } catch (error) {
      console.error('[UI] Failed to stop recording', error)
      setErrorMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setIsRecording(false)
      await loadSessions()
    }
  }, [isRecording, loadSessions])

  const handleRetry = async (event: MouseEvent<HTMLButtonElement>, record: SessionRecord) => {
    event.stopPropagation()
    console.info('[UI] retry placeholder', record.id)
    setErrorMessage('Retry logic will arrive with uploader implementation.')
  }

  const handleRecordToggle = async () => {
    if (isRecording) {
      await stopRecording()
    } else {
      await startRecording()
    }
  }

  const handlePlay = async () => {
    if (!selectedRecording) return
    setPlaybackError(null)
    setIsLoadingPlayback(true)
    try {
      const blob = await manifestService.buildSessionBlob(
        selectedRecording.id,
        selectedRecording.mimeType ?? 'audio/mp4',
      )
      if (!blob) {
        throw new Error('No audio available yet. Keep recording to capture chunks.')
      }
      if (audioUrlRef.current) {
        URL.revokeObjectURL(audioUrlRef.current)
      }
      const url = URL.createObjectURL(blob)
      audioUrlRef.current = url
      const audio = audioRef.current
      if (audio) {
        audio.src = url
        audio.play().catch((error) => {
          console.error('[UI] Playback failed', error)
          setPlaybackError('Unable to start playback. Tap play again or check output device.')
        })
      }
    } catch (error) {
      console.error('[UI] Failed to build playback blob', error)
      setPlaybackError(error instanceof Error ? error.message : String(error))
    } finally {
      setIsLoadingPlayback(false)
    }
  }

  const handleCloseDetail = async () => {
    setSelectedRecordingId(null)
    setChunkMetadata([])
    if (audioUrlRef.current) {
      URL.revokeObjectURL(audioUrlRef.current)
      audioUrlRef.current = null
    }
    if (audioRef.current) {
      audioRef.current.pause()
      audioRef.current.currentTime = 0
    }
    await refreshAndClearErrors()
  }

  const bufferLabel = `${(bufferTotals.totalBytes / MB).toFixed(1)} / ${(bufferTotals.limitBytes / MB).toFixed(0)} MB`

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
            <p className="buffer-value">{bufferLabel}</p>
          </div>
          <button className="settings-button" type="button" disabled>
            Settings (soon)
          </button>
        </div>
      </header>

      {errorMessage ? (
        <div className="alert-banner" role="alert">
          <p>{errorMessage}</p>
          <button type="button" onClick={() => setErrorMessage(null)}>
            Dismiss
          </button>
        </div>
      ) : null}

      <main className="content-grid">
        <section className="session-section" aria-label="Recording sessions">
          <ul className="session-list">
            {recordings.map((session) => {
              const statusMeta = STATUS_META[session.status]
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
                      <span className={`session-pill ${statusMeta.pillClass}`}>{statusMeta.label}</span>
                      <span className="session-times">
                        {formatClock(session.updatedAt)} @ {formatDate(session.startedAt)} {formatClock(session.startedAt)}
                      </span>
                    </header>
                    <h2 className="session-title">{session.title}</h2>
                    <p className="session-preview">{session.notes ?? 'Transcription pending…'}</p>
                    <footer className="session-footer">
                      <span className="session-meta">
                        {formatDuration(session.durationMs)} · {toMbLabel(session.totalBytes)}
                      </span>
                      {session.status === 'error' ? (
                        <button className="session-retry" type="button" onClick={(event) => void handleRetry(event, session)}>
                          Retry
                        </button>
                      ) : (
                        <span className="session-chunks">{session.chunkCount} chunks</span>
                      )}
                    </footer>
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
              onClick={handleRecordToggle}
              aria-pressed={isRecording}
            >
              {isRecording ? 'Stop recording' : 'Start recording'}
            </button>
            <p className="controls-copy">
              Recorder {isRecording ? 'running — chunks saving every 4 s.' : 'idle — tap start to begin a durable session.'}
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

      <audio ref={audioRef} hidden preload="none" />

      {selectedRecording ? (
        <div className="detail-overlay" role="dialog" aria-modal="true" aria-labelledby="recording-detail-title">
          <div className="detail-panel">
            <header className="detail-header">
              <div>
                <p className="detail-label">Recording</p>
                <h2 id="recording-detail-title">{selectedRecording.title}</h2>
              </div>
              <button className="detail-close" type="button" onClick={handleCloseDetail}>
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
                <p>
                  <strong>Format:</strong> {selectedRecording.mimeType ?? 'pending'}
                </p>
              </div>
              <button className="detail-play" type="button" onClick={handlePlay} disabled={isLoadingPlayback}>
                {isLoadingPlayback ? 'Preparing…' : 'Play'}
              </button>
              {playbackError ? <p className="detail-notes" role="alert">{playbackError}</p> : null}
              <div className="detail-transcription">
                <h3>Transcription</h3>
                <p className="detail-transcription-placeholder">Not yet implemented — will stream from Groq once wired.</p>
              </div>
              <div className="detail-chunks">
                <h3>Chunks</h3>
                {chunkMetadata.length === 0 ? (
                  <p className="detail-transcription-placeholder">No chunks persisted yet.</p>
                ) : (
                  <ul className="chunk-list">
                    {chunkMetadata.map((chunk) => (
                      <li key={chunk.id}>
                        <span>#{chunk.seq + 1}</span>
                        <span>{formatDuration(chunk.endMs - chunk.startMs)}</span>
                        <span>{toMbLabel(chunk.byteLength)}</span>
                      </li>
                    ))}
                  </ul>
                )}
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
