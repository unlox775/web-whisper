import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { captureController } from './modules/capture/controller'
import { RecordingAnalysisGraph } from './components/RecordingAnalysisGraph'
import { type SessionAnalysis, type SegmentSummary } from './modules/analysis/session-analysis'
import './App.css'
import {
  manifestService,
  type ChunkVolumeProfileRecord,
  type LogEntryRecord,
  type LogSessionRecord,
  type StoredChunk,
  type SessionRecord,
} from './modules/storage/manifest'
import { SessionAnalysisProvider } from './modules/analysis/session-analysis-provider'
import { recordingSlicesApi, type RecordingAudioSlice } from './modules/playback/recording-slices'
import { settingsStore, type RecorderSettings } from './modules/settings/store'
import {
  getActiveLogSession,
  initializeLogger,
  logError,
  logInfo,
  shutdownLogger,
} from './modules/logging/logger'

type DeveloperTable = {
  name: string
  rows: Array<Record<string, unknown>>
}

type ChunkInspectionRow = Record<string, unknown> & {
  id?: string
  sessionId?: string
  seq?: number
  startMs?: number
  endMs?: number
  blobSize?: number
  verifiedByteLength?: number | null
  sizeMismatch?: boolean
  startIso?: string
  endIso?: string
}

type AudioState = {
  playing: boolean
  duration: number
  position: number
}

type ChunkPlaybackEntry = {
  audio: HTMLAudioElement
  cleanup: () => void
  startTime: number
  endTime: number
}

type DoctorSegmentStatus = 'ok' | 'warn' | 'error'

type DoctorSegmentResult = {
  index: number
  startMs: number
  endMs: number
  status: DoctorSegmentStatus
  reason?: string
  meta?: Record<string, unknown>
}

type DoctorReportMetrics = {
  expectedDurationMs: number | null
  observedDurationMs: number | null
  expectedItemCount: number | null
  observedItemCount: number | null
}

type DoctorReport = {
  stepMs: number
  totalDurationMs: number
  segments: DoctorSegmentResult[]
  summary: {
    ok: number
    warn: number
    error: number
    total: number
  }
  metrics: DoctorReportMetrics
}

type DoctorSanityFinding = {
  level: 'info' | 'warn' | 'error'
  message: string
  meta?: Record<string, unknown>
}

type DoctorSanityReport = {
  findings: DoctorSanityFinding[]
  metrics: {
    sessionDurationMs: number | null
    chunkMaxEndMs: number | null
    chunkSumDurationMs: number | null
    snipCount: number | null
    snipMaxEndMs: number | null
    snipSumDurationMs: number | null
    chunkTimebase: 'absolute' | 'offset' | 'unknown'
    chunkMaxOffsetMs: number | null
  }
}

const SIMULATED_STREAM = [
  'Holding a steady floor — last snip landed cleanly.',
  'Uploader healthy, chunk latency ~1.2 s.',
  'Listening for extended pauses before the next break…',
  'Stashing 3.8 s of tail audio for zero-cross alignment.',
]

const STATUS_META: Record<SessionRecord['status'], { label: string; pillClass: string }> = {
  recording: { label: 'Recording', pillClass: 'pill-progress' },
  ready: { label: 'Ready', pillClass: 'pill-synced' },
  error: { label: 'Error', pillClass: 'pill-attention' },
}

const MB = 1024 * 1024
const DEFAULT_STORAGE_LIMIT_BYTES = 200 * MB

const formatClock = (timestamp: number) =>
  new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' }).format(new Date(timestamp))

const formatDate = (timestamp: number) =>
  new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(new Date(timestamp))

/** Formats a millisecond duration into a compact human-readable label. */
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

/** Produces a human-readable data size string with significant digits preserved. */
const formatDataSize = (bytes: number) => {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = bytes
  let unitIndex = 0
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex += 1
  }
  const formatter = new Intl.NumberFormat(undefined, {
    maximumSignificantDigits: 4,
    minimumSignificantDigits: 1,
  })
  return `${formatter.format(value)} ${units[unitIndex]}`
}

/** Returns an integer-rounded data size for quick-glance UI elements. */
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

/**
 * Formats the verified end timestamp for a session by combining the start time and duration.
 * Falls back to the start time when the duration is missing or zero so the UI remains sensible.
 */
const formatSessionEnd = (startMs: number, durationMs: number): string => {
  // Clamp the duration so negative or NaN values do not skew the calculation.
  const safeDuration = Number.isFinite(durationMs) && durationMs > 0 ? durationMs : 0
  // Build the absolute end timestamp by adding the verified duration to the start.
  const endMs = startMs + safeDuration
  // Decide whether the end falls on a different calendar day than the start.
  const startDate = new Date(startMs)
  const endDate = new Date(endMs)
  const spansMultipleDays = startDate.toDateString() !== endDate.toDateString()
  // Include the date when the span crosses midnight; otherwise keep the display compact.
  return spansMultipleDays
    ? `${formatDate(endMs)} ${formatClock(endMs)}`
    : formatClock(endMs)
}

/** Converts a duration into `hh:mm:ss`, dropping leading hours or minutes when unnecessary. */
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

/** Formats a timestamp as a concise date/time string for session metadata tables. */
const formatSessionDateTime = (timestamp: number) =>
  new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(timestamp))

/** Converts a playback position (seconds) into a `m:ss` display. */
const formatTimecode = (seconds: number) => {
  if (!Number.isFinite(seconds)) return '0:00'
  const clamped = Math.max(0, seconds)
  const mins = Math.floor(clamped / 60)
  const secs = Math.floor(clamped % 60)
  return `${mins}:${secs.toString().padStart(2, '0')}`
}

const LOG_TIME_BASE_OPTIONS: Intl.DateTimeFormatOptions = {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
}

const preciseLogTimeFormatter = (() => {
  try {
    return new Intl.DateTimeFormat(undefined, {
      ...LOG_TIME_BASE_OPTIONS,
      fractionalSecondDigits: 2,
    } as Intl.DateTimeFormatOptions)
  } catch {
    return null
  }
})()

const fallbackLogTimeFormatter = new Intl.DateTimeFormat(undefined, LOG_TIME_BASE_OPTIONS)

const formatLogTime = (timestamp: number) => {
  const formatter = preciseLogTimeFormatter ?? fallbackLogTimeFormatter
  return formatter.format(new Date(timestamp))
}

function App() {
  const [settings, setSettings] = useState<RecorderSettings | null>(null)
  const [recordings, setRecordings] = useState<SessionRecord[]>([])
  const [selectedRecordingId, setSelectedRecordingId] = useState<string | null>(null)
  const [chunkData, setChunkData] = useState<StoredChunk[]>([])
  const [captureState, setCaptureState] = useState(captureController.state)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [bufferTotals, setBufferTotals] = useState<{ totalBytes: number; limitBytes: number }>({
    totalBytes: 0,
    limitBytes: DEFAULT_STORAGE_LIMIT_BYTES,
  })
  const [transcriptionLines, setTranscriptionLines] = useState<string[]>(SIMULATED_STREAM.slice(0, 2))
  const [highlightedSessionId, setHighlightedSessionId] = useState<string | null>(null)
  const [isTranscriptionMounted, setTranscriptionMounted] = useState(false)
  const [isTranscriptionVisible, setTranscriptionVisible] = useState(false)
  const [recordingElapsedMs, setRecordingElapsedMs] = useState(0)
  const [chunkPlayingId, setChunkPlayingId] = useState<string | null>(null)
  const [snipPlayingId, setSnipPlayingId] = useState<string | null>(null)
  const [playbackVolume, setPlaybackVolume] = useState(1)
  const [isVolumeSliderOpen, setVolumeSliderOpen] = useState(false)
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  const [isDeveloperOverlayOpen, setDeveloperOverlayOpen] = useState(false)
  const [developerOverlayLoading, setDeveloperOverlayLoading] = useState(false)
  const [developerTables, setDeveloperTables] = useState<DeveloperTable[]>([])
  const [selectedDeveloperTable, setSelectedDeveloperTable] = useState<string | null>(null)
  const [developerOverlayMode, setDeveloperOverlayMode] = useState<'tables' | 'logs'>('tables')
  const [logSessions, setLogSessions] = useState<LogSessionRecord[]>([])
  const [selectedLogSession, setSelectedLogSession] = useState<LogSessionRecord | null>(null)
  const [logEntries, setLogEntries] = useState<LogEntryRecord[]>([])
  const [debugDetailsOpen, setDebugDetailsOpen] = useState(false)
  const [detailSliceMode, setDetailSliceMode] = useState<'chunks' | 'snips'>('chunks')
  const [doctorOpen, setDoctorOpen] = useState(false)
  const [doctorSelections, setDoctorSelections] = useState({
    chunkCoverageScan: true,
    rangeAccessScan: true,
    chunkDecodeScan: true,
    sanityChecks: true,
    snipScan: true,
  })
  const [doctorRunning, setDoctorRunning] = useState(false)
  const [doctorProgress, setDoctorProgress] = useState<{ label: string; completed: number; total: number } | null>(null)
  const [doctorError, setDoctorError] = useState<string | null>(null)
  const [doctorCopyStatus, setDoctorCopyStatus] = useState<string | null>(null)
  const [doctorExportText, setDoctorExportText] = useState<string | null>(null)
  const [doctorReports, setDoctorReports] = useState<{
    chunkCoverage?: DoctorReport
    rangeAccess?: DoctorReport
    chunkDecode?: DoctorReport
    sanity?: DoctorSanityReport
    snipScan?: DoctorReport
  } | null>(null)
  const [isLoadingPlayback, setIsLoadingPlayback] = useState(false)
  const [playbackError, setPlaybackError] = useState<string | null>(null)
  const [audioState, setAudioState] = useState<AudioState>({ playing: false, duration: 0, position: 0 })
  const [selectedRecordingDurationMs, setSelectedRecordingDurationMs] = useState<number | null>(null)
  const [isAnalysisGraphOpen, setAnalysisGraphOpen] = useState(false)
  const [analysisState, setAnalysisState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const [sessionAnalysis, setSessionAnalysis] = useState<SessionAnalysis | null>(null)
  const [analysisError, setAnalysisError] = useState<string | null>(null)

  const streamCursor = useRef(1)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const audioUrlRef = useRef<string | null>(null)
  const chunkUrlMapRef = useRef<Map<string, string>>(new Map())
  const chunkAudioRef = useRef<Map<string, ChunkPlaybackEntry>>(new Map())
  const snipUrlMapRef = useRef<Map<string, string>>(new Map())
  const snipAudioRef = useRef<Map<string, ChunkPlaybackEntry>>(new Map())
  const snipSliceCacheRef = useRef<Map<string, RecordingAudioSlice>>(new Map())
  const doctorRunIdRef = useRef(0)
  const sessionUpdatesRef = useRef<Map<string, number>>(new Map())
  const sessionsInitializedRef = useRef(false)
  const sessionAnalysisProviderRef = useRef<SessionAnalysisProvider | null>(null)

  const developerMode = settings?.developerMode ?? false
  const storageLimitBytes = settings?.storageLimitBytes ?? DEFAULT_STORAGE_LIMIT_BYTES

  /** Loads the latest session manifest snapshot and triggers background verification. */
  const loadSessions = useCallback(async () => {
    // Ensure the manifest is usable before any list or summary calls.
    await manifestService.init()
    // Data-loss OK migration: purge legacy MP4 sessions/chunks/volumes.
    await manifestService.purgeLegacyMp4Sessions()
    // Reuse or create a single provider instance so verification caching survives reloads.
    const provider = sessionAnalysisProviderRef.current ?? new SessionAnalysisProvider()
    sessionAnalysisProviderRef.current = provider
    // Fetch sessions and overall storage usage concurrently for snappier UI updates.
    const [sessions, totals] = await Promise.all([
      manifestService.listSessions(),
      manifestService.storageTotals(),
    ])

    const previousMap = sessionUpdatesRef.current
    let highlightCandidate: SessionRecord | null = null
    if (sessionsInitializedRef.current) {
      for (const session of sessions) {
        if (session.status !== 'ready' || session.chunkCount === 0) continue
        if (!previousMap.has(session.id)) continue
        const previousUpdatedAt = previousMap.get(session.id)
        if (previousUpdatedAt !== undefined && previousUpdatedAt !== session.updatedAt) {
          if (!highlightCandidate || session.updatedAt > highlightCandidate.updatedAt) {
            highlightCandidate = session
          }
        }
      }
    }

    sessionUpdatesRef.current = new Map(sessions.map((session) => [session.id, session.updatedAt]))
    if (!sessionsInitializedRef.current) {
      sessionsInitializedRef.current = true
    } else if (highlightCandidate) {
      setHighlightedSessionId(highlightCandidate.id)
    }

    setRecordings(sessions)
    // Update the buffer usage indicator with the latest totals and quota.
    setBufferTotals({ totalBytes: totals.totalBytes, limitBytes: storageLimitBytes })

    // Identify sessions that still need timing verification so charts remain monotonic.
    const sessionsNeedingVerification = sessions.filter(
      (session) => session.chunkCount > 0 && (session.timingStatus ?? 'unverified') !== 'verified',
    )
    sessionsNeedingVerification.forEach((session) => {
      void provider
        .ensureTimings(session.id)
        .then((result) => {
          const updatedSession = result.session
          if (result.status !== 'verified' || !updatedSession) {
            return
          }
          // Merge the verified session back into state so timestamps show the corrected values.
          setRecordings((prev) =>
            prev.map((existing) =>
              existing.id === updatedSession.id ? { ...existing, ...updatedSession } : existing,
            ),
          )
          // Remember the updated timestamp so future comparisons recognise the change.
          sessionUpdatesRef.current.set(updatedSession.id, updatedSession.updatedAt)
        })
        .catch((error) => {
          // Soft-fail on verification misses so the UI can still display existing data.
          console.warn('[UI] Session timing verification failed', {
            sessionId: session.id,
            error,
          })
        })
    })
  }, [storageLimitBytes])

  useEffect(() => settingsStore.subscribe((value) => setSettings({ ...value })), [])

  useEffect(() => {
    void initializeLogger()
    return () => {
      void shutdownLogger()
    }
  }, [])

  useEffect(() => {
    void manifestService.reconcileDanglingSessions()
  }, [])

  useEffect(() => {
    const unsubscribe = captureController.subscribe((state) => setCaptureState({ ...state }))
    return unsubscribe
  }, [])

  useEffect(() => {
    void loadSessions()
  }, [loadSessions])

  useEffect(() => {
    if (!captureState.sessionId || captureState.state !== 'recording') {
      return
    }
    const interval = window.setInterval(() => {
      streamCursor.current = (streamCursor.current + 1) % SIMULATED_STREAM.length
      const nextLine = SIMULATED_STREAM[streamCursor.current]
      setTranscriptionLines((prev) => [...prev.slice(-2), nextLine])
      void loadSessions()
    }, 3200)
    return () => window.clearInterval(interval)
  }, [captureState.sessionId, captureState.state, loadSessions])

  useEffect(() => {
    if (captureState.state === 'recording' && captureState.startedAt) {
      const tick = () => setRecordingElapsedMs(Date.now() - captureState.startedAt!)
      tick()
      const interval = window.setInterval(tick, 250)
      return () => window.clearInterval(interval)
    }
    setRecordingElapsedMs(0)
    return () => {}
  }, [captureState.state, captureState.startedAt])

  useEffect(() => {
    if (captureState.state === 'recording') {
      setTranscriptionMounted(true)
      setTranscriptionLines(SIMULATED_STREAM.slice(0, 2))
      streamCursor.current = 1
      requestAnimationFrame(() => setTranscriptionVisible(true))
    } else {
      setTranscriptionVisible(false)
    }
  }, [captureState.state])

  useEffect(() => {
    if (!highlightedSessionId) {
      return
    }
    const timeout = window.setTimeout(() => setHighlightedSessionId(null), 2400)
    return () => window.clearTimeout(timeout)
  }, [highlightedSessionId])

  useEffect(() => {
    if (isTranscriptionVisible) {
      return
    }
    if (!isTranscriptionMounted) {
      return
    }
    const timeout = window.setTimeout(() => setTranscriptionMounted(false), 400)
    return () => window.clearTimeout(timeout)
  }, [isTranscriptionMounted, isTranscriptionVisible])

  useEffect(() => {
    if (typeof window === 'undefined' || !('ontouchstart' in window)) {
      return
    }

    const preventMultiTouch = (event: TouchEvent) => {
      if (event.touches.length > 1) {
        event.preventDefault()
      }
    }

    const preventGesture = (event: Event) => {
      event.preventDefault()
    }

    document.addEventListener('touchmove', preventMultiTouch, { passive: false })
    document.addEventListener('gesturestart' as any, preventGesture as EventListener)
    document.addEventListener('gesturechange' as any, preventGesture as EventListener)
    document.addEventListener('gestureend' as any, preventGesture as EventListener)

    return () => {
      document.removeEventListener('touchmove', preventMultiTouch)
      document.removeEventListener('gesturestart' as any, preventGesture as EventListener)
      document.removeEventListener('gesturechange' as any, preventGesture as EventListener)
      document.removeEventListener('gestureend' as any, preventGesture as EventListener)
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    if (!selectedRecordingId) {
      setChunkData([])
      setDebugDetailsOpen(false)
      setAnalysisGraphOpen(false)
      setSessionAnalysis(null)
      setAnalysisState('idle')
      setAnalysisError(null)
      return
    }
    ;(async () => {
      const metadata = await manifestService.getChunkData(selectedRecordingId)
      if (!cancelled) {
        setChunkData(metadata)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [selectedRecordingId])

  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return

    const handleTime = () => setAudioState((prev) => ({ ...prev, position: audio.currentTime }))
    const handleDuration = () =>
      setAudioState((prev) => ({ ...prev, duration: Number.isFinite(audio.duration) ? audio.duration : 0 }))
    const handlePlay = () => setAudioState((prev) => ({ ...prev, playing: true }))
    const handlePause = () => setAudioState((prev) => ({ ...prev, playing: false }))
    const handleEnded = () =>
      setAudioState((prev) => ({ ...prev, playing: false, position: audio.duration || prev.position }))

    audio.addEventListener('timeupdate', handleTime)
    audio.addEventListener('durationchange', handleDuration)
    audio.addEventListener('play', handlePlay)
    audio.addEventListener('pause', handlePause)
    audio.addEventListener('ended', handleEnded)

    return () => {
      audio.removeEventListener('timeupdate', handleTime)
      audio.removeEventListener('durationchange', handleDuration)
      audio.removeEventListener('play', handlePlay)
      audio.removeEventListener('pause', handlePause)
      audio.removeEventListener('ended', handleEnded)
    }
  }, [selectedRecordingId])

  useEffect(() => {
    const urlMap = chunkUrlMapRef.current
    const audioEntries = chunkAudioRef.current
    const currentIds = new Set(chunkData.map((chunk) => chunk.id))

    Array.from(urlMap.entries()).forEach(([id, url]) => {
      if (!currentIds.has(id)) {
        URL.revokeObjectURL(url)
        urlMap.delete(id)
      }
    })

    for (const [id, entry] of audioEntries.entries()) {
      if (!currentIds.has(id)) {
        entry.cleanup()
        entry.audio.pause()
        entry.audio.currentTime = entry.startTime
        audioEntries.delete(id)
      }
    }

    setChunkPlayingId((prev) => (prev && currentIds.has(prev) ? prev : null))
  }, [chunkData])

  useEffect(() => {
    return () => {
      chunkAudioRef.current.forEach((entry) => {
        entry.cleanup()
        entry.audio.pause()
        entry.audio.currentTime = entry.startTime
      })
      chunkAudioRef.current.clear()
      chunkUrlMapRef.current.forEach((url) => URL.revokeObjectURL(url))
      chunkUrlMapRef.current.clear()
    }
  }, [])

  useEffect(() => {
    if (!debugDetailsOpen) {
      chunkAudioRef.current.forEach((entry) => {
        entry.cleanup()
        entry.audio.pause()
        entry.audio.currentTime = entry.startTime
      })
      chunkAudioRef.current.clear()
      setChunkPlayingId(null)
      snipAudioRef.current.forEach((entry) => {
        entry.cleanup()
        entry.audio.pause()
        entry.audio.currentTime = entry.startTime
      })
      snipAudioRef.current.clear()
      setSnipPlayingId(null)
    }
  }, [debugDetailsOpen])

  useEffect(() => {
    // Switching modes should not keep stale per-slice playback alive.
    chunkAudioRef.current.forEach((entry) => {
      entry.cleanup()
      entry.audio.pause()
      entry.audio.currentTime = entry.startTime
    })
    chunkAudioRef.current.clear()
    setChunkPlayingId(null)
    snipAudioRef.current.forEach((entry) => {
      entry.cleanup()
      entry.audio.pause()
      entry.audio.currentTime = entry.startTime
    })
    snipAudioRef.current.clear()
    setSnipPlayingId(null)
  }, [detailSliceMode])

  useEffect(() => {
    const mainAudio = audioRef.current
    if (mainAudio) {
      mainAudio.volume = playbackVolume
    }
    chunkAudioRef.current.forEach((entry) => {
      entry.audio.volume = playbackVolume
    })
    snipAudioRef.current.forEach((entry) => {
      entry.audio.volume = playbackVolume
    })
  }, [playbackVolume])

  useEffect(() => {
    if (!developerMode) {
      setDeveloperOverlayOpen(false)
      setDebugDetailsOpen(false)
      setAnalysisGraphOpen(false)
      setSessionAnalysis(null)
      setAnalysisState('idle')
      setAnalysisError(null)
      setDeveloperTables([])
      setSelectedDeveloperTable(null)
      setDeveloperOverlayMode('tables')
      setLogSessions([])
      setSelectedLogSession(null)
      setLogEntries([])
    }
  }, [developerMode])

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

  useEffect(() => {
    if (!selectedRecording) {
      setSelectedRecordingDurationMs(null)
      return
    }
    setSelectedRecordingDurationMs(selectedRecording.durationMs)
  }, [selectedRecording])

  useEffect(() => {
    const wantsSessionAnalysis =
      developerMode && selectedRecording && (isAnalysisGraphOpen || (debugDetailsOpen && detailSliceMode === 'snips'))
    if (!wantsSessionAnalysis) {
      setAnalysisState('idle')
      setSessionAnalysis(null)
      setAnalysisError(null)
      return
    }
    if (selectedRecording.chunkCount === 0) {
      setAnalysisState('error')
      setAnalysisError('No audio chunks available yet. Capture a few seconds of audio and try again.')
      setSessionAnalysis(null)
      return
    }

    const provider = sessionAnalysisProviderRef.current ?? new SessionAnalysisProvider()
    sessionAnalysisProviderRef.current = provider

    let cancelled = false
    setAnalysisState('loading')
    setAnalysisError(null)
    setSessionAnalysis(null)

    ;(async () => {
      try {
        const result = await provider.prepareAnalysisForSession({
          session: selectedRecording,
          mimeTypeHint: selectedRecording.mimeType ?? null,
        })
        if (cancelled) {
          return
        }
        if (result.analysis) {
          // Feed the verified frames into the graph component.
          setSessionAnalysis(result.analysis)
          setAnalysisState('ready')
          setAnalysisError(null)
        } else {
          // Surface a friendlier warning when volumes are still baking.
          setSessionAnalysis(null)
          setAnalysisState('error')
          const missingCount = result.verification.missingChunkIds.length
          setAnalysisError(
            missingCount > 0
              ? `Waiting on verified audio durations for ${missingCount} chunk${missingCount === 1 ? '' : 's'}.`
              : 'No volume profiles available yet. Capture additional audio and retry.',
          )
        }
      } catch (error) {
        if (cancelled) {
          return
        }
        const message = error instanceof Error ? error.message : String(error)
        setAnalysisState('error')
        setAnalysisError(message)
        // Emit a structured log so we can inspect failures in the developer console.
        void logError('Session analysis failed', {
          sessionId: selectedRecording.id,
          error: message,
        })
      }
    })()

    return () => {
      cancelled = true
    }
  }, [
    developerMode,
    debugDetailsOpen,
    detailSliceMode,
    isAnalysisGraphOpen,
    selectedRecording?.id,
    selectedRecording?.updatedAt,
    selectedRecording?.chunkCount,
    selectedRecording?.mimeType,
  ])

  const isHeaderSegment = useCallback((chunk: StoredChunk) => {
    const mimeType = chunk.blob.type || selectedRecording?.mimeType || ''
    const isMp4Like = /mp4|m4a/i.test(mimeType)
    if (!isMp4Like) {
      return false
    }
    const durationMs = Math.max(0, chunk.endMs - chunk.startMs)
    return chunk.seq === 0 && (durationMs <= 10 || chunk.byteLength < 4096)
  }, [selectedRecording?.mimeType])

  const headerChunk = useMemo(() => chunkData.find(isHeaderSegment) ?? null, [chunkData, isHeaderSegment])

  const playableChunkCount = useMemo(
    () => chunkData.filter((chunk) => !isHeaderSegment(chunk)).length,
    [chunkData, isHeaderSegment],
  )

    const createChunkCompositeBlob = useCallback(
      (chunk: StoredChunk) => {
        const mimeType = chunk.blob.type || selectedRecording?.mimeType || 'audio/mp4'
        if (!headerChunk || headerChunk.id === chunk.id) {
          return chunk.blob
        }
        const isMp4Like = /mp4|m4a/i.test(mimeType)
        if (!isMp4Like) {
          return chunk.blob
        }
        return new Blob([headerChunk.blob, chunk.blob], { type: mimeType })
      },
      [headerChunk, selectedRecording?.mimeType],
    )

    const ensureChunkPlaybackUrl = useCallback(
      (chunk: StoredChunk) => {
        const map = chunkUrlMapRef.current
        const existing = map.get(chunk.id)
        if (existing) {
          return existing
        }
        const blob = createChunkCompositeBlob(chunk)
        const url = URL.createObjectURL(blob)
        map.set(chunk.id, url)
        return url
      },
      [createChunkCompositeBlob],
    )

    const handleChunkDownload = useCallback(
      (chunk: StoredChunk) => {
        const url = ensureChunkPlaybackUrl(chunk)
        if (!url) {
          return
        }
        const baseDate = selectedRecording?.startedAt ?? chunk.startMs ?? Date.now()
        const iso = new Date(baseDate).toISOString().replace(/[:.]/g, '-')
        const seqLabel = String(chunk.seq + 1).padStart(2, '0')
        const mimeType = chunk.blob.type || selectedRecording?.mimeType || 'application/octet-stream'
        const extension = /mpeg/i.test(mimeType)
          ? 'mp3'
          : /webm/i.test(mimeType)
            ? 'webm'
            : /mp4|m4a/i.test(mimeType)
              ? 'mp4'
              : 'bin'
        const link = document.createElement('a')
        link.href = url
        link.download = `${iso}_chunk-${seqLabel}.${extension}`
        link.rel = 'noopener'
        document.body.appendChild(link)
        link.click()
        document.body.removeChild(link)
      },
      [ensureChunkPlaybackUrl, selectedRecording?.mimeType, selectedRecording?.startedAt],
    )

  const ensureSnipSlice = useCallback(
    async (segment: SegmentSummary): Promise<RecordingAudioSlice | null> => {
      if (!selectedRecording) {
        return null
      }
      const cacheKey = `snip-${segment.index}`
      const existing = snipSliceCacheRef.current.get(cacheKey)
      if (existing) {
        return existing
      }
      const slice = await recordingSlicesApi.getRangeAudio(
        selectedRecording,
        segment.startMs,
        segment.endMs,
        selectedRecording.mimeType ?? null,
      )
      snipSliceCacheRef.current.set(cacheKey, slice)
      return slice
    },
    [selectedRecording],
  )

  const ensureSnipPlaybackUrl = useCallback(
    async (segment: SegmentSummary): Promise<{ url: string; slice: RecordingAudioSlice } | null> => {
      const cacheKey = `snip-${segment.index}`
      const existingUrl = snipUrlMapRef.current.get(cacheKey)
      const slice = await ensureSnipSlice(segment)
      if (!slice) {
        return null
      }
      if (existingUrl) {
        return { url: existingUrl, slice }
      }
      const url = URL.createObjectURL(slice.blob)
      snipUrlMapRef.current.set(cacheKey, url)
      return { url, slice }
    },
    [ensureSnipSlice],
  )

  const handleSnipDownload = useCallback(
    async (segment: SegmentSummary, snipNumber: number) => {
      const resolved = await ensureSnipPlaybackUrl(segment)
      if (!resolved) {
        return
      }
      const { url, slice } = resolved
      const link = document.createElement('a')
      link.href = url
      link.download = slice.suggestedFilename || `snip-${String(snipNumber).padStart(2, '0')}.wav`
      link.rel = 'noopener'
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
    },
    [ensureSnipPlaybackUrl],
  )

  const refreshAndClearErrors = useCallback(async () => {
    setErrorMessage(null)
    await loadSessions()
  }, [loadSessions])

  const startRecording = useCallback(async () => {
    if (captureState.state === 'recording') return
    let sessionId = ''
    try {
      await logInfo('Recorder start requested', { previousState: captureState.state })
      setErrorMessage(null)
      const activeSettings = await settingsStore.get()
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
        timingStatus: 'unverified',
      })
      await captureController.start({
        sessionId,
        targetBitrate: activeSettings.targetBitrate,
        chunkDurationMs: 4000,
      })
      await logInfo('Recorder started', {
        sessionId,
        targetBitrate: activeSettings.targetBitrate,
        chunkDurationMs: 4000,
      })
      await loadSessions()
    } catch (error) {
      console.error('[UI] Failed to start recording', error)
      await logError('Recorder failed to start', {
        sessionId,
        error: error instanceof Error ? error.message : String(error),
      })
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
  }, [captureState.state, loadSessions])

  const stopRecording = useCallback(async () => {
    if (captureState.state !== 'recording') return
    try {
      await logInfo('Recorder stop requested', { sessionId: captureState.sessionId })
      await captureController.stop()
      await logInfo('Recorder stopped', { sessionId: captureState.sessionId })
    } catch (error) {
      console.error('[UI] Failed to stop recording', error)
      setErrorMessage(error instanceof Error ? error.message : String(error))
      await logError('Recorder failed to stop', {
        sessionId: captureState.sessionId,
        error: error instanceof Error ? error.message : String(error),
      })
    } finally {
      await loadSessions()
    }
  }, [captureState.sessionId, captureState.state, loadSessions])

  const handleRecordToggle = async () => {
    if (captureState.state === 'recording') {
      await stopRecording()
    } else {
      await startRecording()
    }
  }

  const preparePlaybackSource = useCallback(
    async (forceReload = false) => {
      if (!selectedRecording) return false
      const mime = selectedRecording.mimeType ?? 'audio/mp4'
      const blob = await manifestService.buildSessionBlob(selectedRecording.id, mime)
      if (!blob) {
        throw new Error('No audio available yet. Keep recording to capture chunks.')
      }
      await logInfo('Playback source prepared', {
        sessionId: selectedRecording.id,
        blobSize: blob.size,
        blobType: blob.type,
      })
      if (audioUrlRef.current && !forceReload) {
        return true
      }
      if (audioUrlRef.current) {
        URL.revokeObjectURL(audioUrlRef.current)
      }
      const url = URL.createObjectURL(blob)
      audioUrlRef.current = url
      const audio = audioRef.current
      if (audio) {
        audio.src = url
        audio.currentTime = 0
        setAudioState({ playing: false, duration: Number.isFinite(audio.duration) ? audio.duration : 0, position: 0 })
      }
      return true
    },
    [selectedRecording],
  )

  useEffect(() => {
    if (!selectedRecording || selectedRecording.status === 'recording' || selectedRecording.chunkCount === 0) {
      return
    }
    void preparePlaybackSource(true).catch((error) => {
      console.error('[UI] Failed to prepare playback on detail open', error)
    })
  }, [
    preparePlaybackSource,
    selectedRecording,
    selectedRecording?.id,
    selectedRecording?.updatedAt,
    selectedRecording?.chunkCount,
    selectedRecording?.status,
  ])

  const handlePlaybackToggle = useCallback(async () => {
    if (!selectedRecording) return
    setPlaybackError(null)
    setIsLoadingPlayback(true)
    try {
      if (!audioUrlRef.current) {
        await preparePlaybackSource()
      }
      const audio = audioRef.current
      if (!audio) {
        throw new Error('Audio element unavailable')
      }
      if (audio.paused) {
        await audio.play()
        await logInfo('Playback started', { sessionId: selectedRecording.id })
      } else {
        audio.pause()
        await logInfo('Playback paused', { sessionId: selectedRecording.id })
      }
    } catch (error) {
      console.error('[UI] Playback toggle failed', error)
      setPlaybackError(error instanceof Error ? error.message : String(error))
      await logError('Playback toggle failed', {
        sessionId: selectedRecording.id,
        error: error instanceof Error ? error.message : String(error),
      })
    } finally {
      setIsLoadingPlayback(false)
    }
  }, [preparePlaybackSource, selectedRecording])

  const handleCloseDetail = async () => {
    chunkAudioRef.current.forEach((entry) => {
      entry.cleanup()
      entry.audio.pause()
      entry.audio.currentTime = entry.startTime
    })
    chunkAudioRef.current.clear()
    chunkUrlMapRef.current.forEach((url) => URL.revokeObjectURL(url))
    chunkUrlMapRef.current.clear()
    setChunkPlayingId(null)
    snipAudioRef.current.forEach((entry) => {
      entry.cleanup()
      entry.audio.pause()
      entry.audio.currentTime = entry.startTime
    })
    snipAudioRef.current.clear()
    snipUrlMapRef.current.forEach((url) => URL.revokeObjectURL(url))
    snipUrlMapRef.current.clear()
    snipSliceCacheRef.current.clear()
    setSnipPlayingId(null)
    setDetailSliceMode('chunks')
    setDoctorOpen(false)
    setDoctorRunning(false)
    setDoctorProgress(null)
    setDoctorError(null)
    setDoctorReports(null)
    setVolumeSliderOpen(false)
    setSelectedRecordingId(null)
    setChunkData([])
    setSelectedRecordingDurationMs(null)
    setDebugDetailsOpen(false)
    setAnalysisGraphOpen(false)
    setSessionAnalysis(null)
    setAnalysisState('idle')
    setAnalysisError(null)
    setPlaybackError(null)
    setAudioState({ playing: false, duration: 0, position: 0 })
    if (selectedRecordingId) {
      await logInfo('Detail view closed', { sessionId: selectedRecordingId })
    }
    if (selectedRecordingId) {
      recordingSlicesApi.clearSession(selectedRecordingId)
    }
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

  const formatPercent = (count: number, total: number) =>
    total > 0 ? `${Math.round((count / total) * 100)}%` : '0%'

  const formatTimecodeTenths = (ms: number) => {
    const totalSeconds = Math.max(0, ms / 1000)
    const minutes = Math.floor(totalSeconds / 60)
    const seconds = totalSeconds - minutes * 60
    const secondsFixed = seconds < 10 ? `0${seconds.toFixed(1)}` : seconds.toFixed(1)
    return `${minutes}:${secondsFixed}`
  }

  const summarizeReport = (segments: DoctorSegmentResult[]): DoctorReport['summary'] => {
    const summary = { ok: 0, warn: 0, error: 0, total: segments.length }
    segments.forEach((segment) => {
      if (segment.status === 'ok') summary.ok += 1
      else if (segment.status === 'warn') summary.warn += 1
      else summary.error += 1
    })
    return summary
  }

  const groupSegmentsByReason = (segments: DoctorSegmentResult[]) => {
    const groups = new Map<string, { reason: string; status: DoctorSegmentStatus; count: number; examples: DoctorSegmentResult[] }>()
    segments.forEach((segment) => {
      const reason = segment.reason ?? '(no reason)'
      const key = `${segment.status}:${reason}`
      const existing = groups.get(key)
      if (existing) {
        existing.count += 1
        if (existing.examples.length < 6) existing.examples.push(segment)
      } else {
        groups.set(key, { reason, status: segment.status, count: 1, examples: [segment] })
      }
    })
    return Array.from(groups.values()).sort((a, b) => {
      const statusOrder: Record<DoctorSegmentStatus, number> = { error: 0, warn: 1, ok: 2 }
      if (statusOrder[a.status] !== statusOrder[b.status]) return statusOrder[a.status] - statusOrder[b.status]
      return b.count - a.count
    })
  }

  const buildCompactDoctorReport = (payload: {
    session: SessionRecord
    doctorReports: typeof doctorReports
    logs: Array<{ level?: string; message?: string; timestamp?: number }>
  }) => {
    const { session, doctorReports, logs } = payload
    const lines: string[] = []
    lines.push('Web Whisper — Doctor Report (compact)')
    lines.push(`Session: ${session.id}`)
    lines.push(`StartedAt: ${new Date(session.startedAt).toISOString()}`)
    lines.push(`DurationMs: ${session.durationMs}  (=${(session.durationMs / 1000).toFixed(1)}s)`)
    lines.push(`Mime: ${session.mimeType ?? 'unknown'}  Chunks: ${session.chunkCount}  Timing: ${session.timingStatus ?? 'unverified'}`)
    lines.push('')

    if (doctorReports?.sanity) {
      const m = doctorReports.sanity.metrics
      lines.push('Sanity:')
      lines.push(
        `- chunkTimebase=${m.chunkTimebase} session=${((m.sessionDurationMs ?? 0) / 1000).toFixed(1)}s chunkMax=${(
          (m.chunkMaxOffsetMs ?? 0) / 1000
        ).toFixed(1)}s chunkSum=${((m.chunkSumDurationMs ?? 0) / 1000).toFixed(1)}s snips=${m.snipCount ?? 0} snipMax=${(
          (m.snipMaxEndMs ?? 0) / 1000
        ).toFixed(1)}s`,
      )
      doctorReports.sanity.findings.forEach((f) => lines.push(`- ${f.level.toUpperCase()}: ${f.message}`))
      lines.push('')
    }

    const addScan = (label: string, report?: DoctorReport) => {
      if (!report) return
      lines.push(`${label}: OK=${report.summary.ok} WARN=${report.summary.warn} ERR=${report.summary.error} TOTAL=${report.summary.total}`)
      lines.push(
        `- expected=${((report.metrics.expectedDurationMs ?? 0) / 1000).toFixed(1)}s observed=${(
          (report.metrics.observedDurationMs ?? 0) / 1000
        ).toFixed(1)}s items=${report.metrics.observedItemCount ?? 0}/${report.metrics.expectedItemCount ?? 0}`,
      )
      const groups = groupSegmentsByReason(report.segments).filter((g) => g.status !== 'ok').slice(0, 5)
      groups.forEach((g) => {
        const examples = g.examples
          .slice(0, 3)
          .map((seg) => `${formatTimecodeTenths(seg.startMs)}–${formatTimecodeTenths(seg.endMs)}`)
          .join(', ')
        lines.push(`- ${g.status.toUpperCase()}: ${g.reason} (${g.count}) e.g. ${examples}`)
      })
      lines.push('')
    }

    addScan('Chunk coverage', doctorReports?.chunkCoverage)
    addScan('Range access', doctorReports?.rangeAccess)
    addScan('Per-chunk decode', doctorReports?.chunkDecode)
    addScan('Snip scan', doctorReports?.snipScan)

    if (logs.length > 0) {
      lines.push('Recent logs (last 30):')
      logs.slice(-30).forEach((entry) => {
        const ts = typeof entry.timestamp === 'number' ? new Date(entry.timestamp).toISOString() : ''
        const level = entry.level ?? ''
        const msg = (entry.message ?? '').replace(/\s+/g, ' ').slice(0, 200)
        lines.push(`- ${ts} ${level} ${msg}`.trim())
      })
      lines.push('')
    }

    let text = lines.join('\n')
    const MAX = 45_000
    if (text.length > MAX) {
      text = `${text.slice(0, MAX)}\n\n[TRUNCATED: report exceeded ${MAX} chars]\n`
    }
    return text
  }

  const downloadDoctorJson = (label: string, payload: unknown) => {
    const json = JSON.stringify(payload, null, 2)
    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `${label.replace(/\s+/g, '-').toLowerCase()}-doctor-report.json`
    link.rel = 'noopener'
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  }

  const copyToClipboard = async (text: string) => {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return
    }
    const textarea = document.createElement('textarea')
    textarea.value = text
    textarea.style.position = 'fixed'
    textarea.style.left = '-9999px'
    textarea.style.top = '0'
    document.body.appendChild(textarea)
    textarea.focus()
    textarea.select()
    document.execCommand('copy')
    document.body.removeChild(textarea)
  }

  const inferChunkTimebase = (chunks: StoredChunk[], baseStartMs: number): 'absolute' | 'offset' | 'unknown' => {
    const sample = chunks.find((chunk) => chunk.seq > 0) ?? null
    if (!sample) return 'unknown'
    if (sample.startMs > 1_000_000_000_000 && baseStartMs > 1_000_000_000_000) return 'absolute'
    if (sample.startMs >= 0 && sample.startMs < 86_400_000) return 'offset'
    return 'unknown'
  }

  const toOffsetSpan = (chunk: Pick<StoredChunk, 'startMs' | 'endMs'>, baseStartMs: number, timebase: string) => {
    if (timebase === 'absolute') {
      return { startMs: chunk.startMs - baseStartMs, endMs: chunk.endMs - baseStartMs }
    }
    return { startMs: chunk.startMs, endMs: chunk.endMs }
  }

  const runDoctorDiagnostics = useCallback(async () => {
    if (!selectedRecording) return

    const runId = doctorRunIdRef.current + 1
    doctorRunIdRef.current = runId
    const isCancelled = () => doctorRunIdRef.current !== runId

    setDoctorRunning(true)
    setDoctorError(null)
    setDoctorReports(null)

    await manifestService.init()
    // Pull fresh chunk data for diagnostics so we don't race the detail-open effect.
    const chunksForDoctor = await manifestService.getChunkData(selectedRecording.id)
    const playableChunksForDoctor = chunksForDoctor.filter((chunk) => chunk.seq > 0)
    const baseStartMsCandidate =
      chunksForDoctor.find((chunk) => chunk.seq === 0)?.startMs ??
      playableChunksForDoctor[0]?.startMs ??
      selectedRecording.startedAt
    const baseStartMs = Number.isFinite(baseStartMsCandidate) ? Math.round(baseStartMsCandidate) : selectedRecording.startedAt
    const chunkTimebase = inferChunkTimebase(playableChunksForDoctor, baseStartMs)
    const playableChunkOffsets = playableChunksForDoctor.map((chunk) => ({
      ...chunk,
      ...toOffsetSpan(chunk, baseStartMs, chunkTimebase),
    }))

    const durationMsGuess =
      selectedRecordingDurationMs ??
      (playableChunkOffsets.length > 0 ? Math.max(...playableChunkOffsets.map((chunk) => chunk.endMs)) : selectedRecording.durationMs ?? 0)
    const totalDurationMs = Math.max(0, durationMsGuess)
    const stepMs = 100
    const segmentCount = totalDurationMs > 0 ? Math.ceil(totalDurationMs / stepMs) : 0

    const reports: NonNullable<typeof doctorReports> = {}

    const yieldToUI = async () => {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    }

    const runChunkCoverageScan = async () => {
      const segments: DoctorSegmentResult[] = []
      setDoctorProgress({ label: 'Chunk coverage scan', completed: 0, total: segmentCount })

      let coveredMs = 0
      for (let i = 0; i < segmentCount; i += 1) {
        if (isCancelled()) return
        const startMs = i * stepMs
        const endMs = Math.min(totalDurationMs, startMs + stepMs)
        const chunk = playableChunkOffsets.find((row) => row.startMs <= startMs && row.endMs > startMs) ?? null
        if (!chunk) {
          segments.push({ index: i, startMs, endMs, status: 'error', reason: 'No chunk covers this time range' })
        } else if (!Number.isFinite(chunk.byteLength) || chunk.byteLength <= 0) {
          segments.push({
            index: i,
            startMs,
            endMs,
            status: 'error',
            reason: 'Chunk blob is empty',
            meta: { chunkId: chunk.id, seq: chunk.seq, byteLength: chunk.byteLength },
          })
        } else if (chunk.endMs <= chunk.startMs) {
          segments.push({
            index: i,
            startMs,
            endMs,
            status: 'warn',
            reason: 'Chunk timing metadata looks invalid',
            meta: { chunkId: chunk.id, seq: chunk.seq, chunkStartMs: chunk.startMs, chunkEndMs: chunk.endMs },
          })
        } else {
          coveredMs += endMs - startMs
          segments.push({
            index: i,
            startMs,
            endMs,
            status: 'ok',
            meta: { chunkId: chunk.id, seq: chunk.seq },
          })
        }

        if (i % 50 === 0) {
          setDoctorProgress({ label: 'Chunk coverage scan', completed: i + 1, total: segmentCount })
          await yieldToUI()
        }
      }
      setDoctorProgress({ label: 'Chunk coverage scan', completed: segmentCount, total: segmentCount })
      reports.chunkCoverage = {
        stepMs,
        totalDurationMs,
        segments,
        summary: summarizeReport(segments),
        metrics: {
          expectedDurationMs: totalDurationMs,
          observedDurationMs: coveredMs,
          expectedItemCount: segmentCount,
          observedItemCount: segmentCount - summarizeReport(segments).error,
        },
      }
    }

    const runRangeAccessScan = async () => {
      const segments: DoctorSegmentResult[] = []
      setDoctorProgress({ label: 'Range access scan (0.1s)', completed: 0, total: segmentCount })

      let observedMs = 0
      let observedCount = 0
      for (let i = 0; i < segmentCount; i += 1) {
        if (isCancelled()) return
        const startMs = i * stepMs
        const endMs = Math.min(totalDurationMs, startMs + stepMs)
        try {
          const inspection = await recordingSlicesApi.inspectRange(
            selectedRecording,
            startMs,
            endMs,
            selectedRecording.mimeType ?? null,
          )
          observedMs += inspection.durationMs
          observedCount += 1
          const expectedMs = endMs - startMs
          const hasTooShort = inspection.durationMs < Math.min(expectedMs * 0.5, expectedMs - 10)
          const silent = inspection.sampleCount > 0 && inspection.rms <= 0.00001 && inspection.peak <= 0.00005
          const status: DoctorSegmentStatus = hasTooShort ? 'warn' : silent ? 'warn' : 'ok'
          const reason = hasTooShort ? 'Decoded slice shorter than expected' : silent ? 'Slice appears silent' : undefined
          segments.push({
            index: i,
            startMs,
            endMs,
            status,
            reason,
            meta: {
              durationMs: inspection.durationMs,
              sampleCount: inspection.sampleCount,
              rms: inspection.rms,
              peak: inspection.peak,
            },
          })
        } catch (error) {
          segments.push({
            index: i,
            startMs,
            endMs,
            status: 'error',
            reason: error instanceof Error ? error.message : String(error),
          })
        }

        if (i % 20 === 0) {
          setDoctorProgress({ label: 'Range access scan (0.1s)', completed: i + 1, total: segmentCount })
          await yieldToUI()
        }
      }
      setDoctorProgress({ label: 'Range access scan (0.1s)', completed: segmentCount, total: segmentCount })
      reports.rangeAccess = {
        stepMs,
        totalDurationMs,
        segments,
        summary: summarizeReport(segments),
        metrics: {
          expectedDurationMs: totalDurationMs,
          observedDurationMs: observedMs,
          expectedItemCount: segmentCount,
          observedItemCount: observedCount,
        },
      }
    }

    const runChunkDecodeScan = async () => {
      setDoctorProgress({ label: 'Per-chunk decode scan', completed: 0, total: playableChunksForDoctor.length })
      const segments: DoctorSegmentResult[] = []
      if (typeof window === 'undefined' || typeof window.AudioContext === 'undefined') {
        reports.chunkDecode = {
          stepMs: 1,
          totalDurationMs,
          segments: [
            {
              index: 0,
              startMs: 0,
              endMs: 0,
              status: 'error',
              reason: 'AudioContext is not supported in this environment.',
            },
          ],
          summary: { ok: 0, warn: 0, error: 1, total: 1 },
          metrics: { expectedDurationMs: null, observedDurationMs: null, expectedItemCount: null, observedItemCount: null },
        }
        return
      }

      const audioContext = new AudioContext()
      let expectedMs = 0
      let decodedMs = 0
      let decodedCount = 0
      try {
        for (let i = 0; i < playableChunkOffsets.length; i += 1) {
          if (isCancelled()) return
          const chunk = playableChunkOffsets[i]
          const seq = chunk.seq
          expectedMs += Math.max(0, chunk.endMs - chunk.startMs)
          try {
            const slice = await recordingSlicesApi.getChunkAudio(selectedRecording, seq)
            if (!slice) {
              segments.push({
                index: i,
                startMs: chunk.startMs,
                endMs: chunk.endMs,
                status: 'error',
                reason: 'Chunk not found',
                meta: { seq },
              })
            } else {
              const arrayBuffer = await slice.blob.arrayBuffer()
              const decoded = await audioContext.decodeAudioData(arrayBuffer.slice(0))
              const chunkDecodedMs = Math.max(0, decoded.duration * 1000)
              decodedMs += chunkDecodedMs
              decodedCount += 1
              const expectedChunkMs = Math.max(0, chunk.endMs - chunk.startMs)
              const driftMs = Math.abs(chunkDecodedMs - expectedChunkMs)
              const status: DoctorSegmentStatus = driftMs > 250 ? 'warn' : 'ok'
              const reason = driftMs > 250 ? 'Decoded duration differs from expected chunk timing' : undefined
              segments.push({
                index: i,
                startMs: chunk.startMs,
                endMs: chunk.endMs,
                status,
                reason,
                meta: {
                  seq,
                  blobType: slice.mimeType,
                  blobBytes: slice.blob.size,
                  decodedMs: chunkDecodedMs,
                  expectedMs: expectedChunkMs,
                  driftMs,
                  note: 'Standalone chunk decoding can include timestamp offsets; compare against range scans.',
                },
              })
            }
          } catch (error) {
            segments.push({
              index: i,
              startMs: chunk.startMs,
              endMs: chunk.endMs,
              status: 'error',
              reason: error instanceof Error ? error.message : String(error),
              meta: { seq },
            })
          }

          if (i % 5 === 0) {
            setDoctorProgress({ label: 'Per-chunk decode scan', completed: i + 1, total: playableChunksForDoctor.length })
            await yieldToUI()
          }
        }
      } finally {
        await audioContext.close().catch(() => {
          /* noop */
        })
      }

      setDoctorProgress({
        label: 'Per-chunk decode scan',
        completed: playableChunksForDoctor.length,
        total: playableChunksForDoctor.length,
      })
      reports.chunkDecode = {
        stepMs: 1,
        totalDurationMs,
        segments,
        summary: summarizeReport(segments),
        metrics: {
          expectedDurationMs: expectedMs,
          observedDurationMs: decodedMs,
          expectedItemCount: playableChunksForDoctor.length,
          observedItemCount: decodedCount,
        },
      }
    }

    const runSanityChecks = async () => {
      const findings: DoctorSanityFinding[] = []

      const sessionDurationMs = Number.isFinite(selectedRecording.durationMs) ? Math.max(0, selectedRecording.durationMs) : null
      const chunkMaxEndMs = playableChunksForDoctor.length > 0 ? Math.max(...playableChunksForDoctor.map((chunk) => chunk.endMs)) : null
      const chunkMaxOffsetMs = playableChunkOffsets.length > 0 ? Math.max(...playableChunkOffsets.map((chunk) => chunk.endMs)) : null
      const chunkSumDurationMs = playableChunkOffsets.reduce((sum, chunk) => sum + Math.max(0, chunk.endMs - chunk.startMs), 0)

      // Chunk ordering / overlaps / gaps.
      const ordered = [...playableChunkOffsets].sort((a, b) => a.seq - b.seq)
      let overlaps = 0
      let gaps = 0
      for (let i = 1; i < ordered.length; i += 1) {
        const prev = ordered[i - 1]
        const current = ordered[i]
        if (current.startMs < prev.endMs - 5) overlaps += 1
        if (current.startMs > prev.endMs + 50) gaps += 1
      }
      if (overlaps > 0) {
        findings.push({ level: 'warn', message: `Chunk timings overlap in ${overlaps} places.`, meta: { overlaps } })
      }
      if (gaps > 0) {
        findings.push({ level: 'warn', message: `Chunk timings have gaps in ${gaps} places.`, meta: { gaps } })
      }

      if (sessionDurationMs !== null && chunkMaxOffsetMs !== null) {
        const drift = chunkMaxOffsetMs - sessionDurationMs
        if (Math.abs(drift) > 1000) {
          findings.push({
            level: drift > 0 ? 'warn' : 'warn',
            message: 'Session duration and chunk max end differ by >1s.',
            meta: { sessionDurationMs, chunkMaxOffsetMs, driftMs: drift, chunkTimebase },
          })
        } else {
          findings.push({
            level: 'info',
            message: 'Session duration and chunk max end are close.',
            meta: { sessionDurationMs, chunkMaxOffsetMs, driftMs: drift, chunkTimebase },
          })
        }
      }

      // Snip sanity: make sure snips do not extend way past session/chunks.
      let snipCount: number | null = null
      let snipMaxEndMs: number | null = null
      let snipSumDurationMs: number | null = null
      try {
        const snips = await recordingSlicesApi.listSnips(selectedRecording, selectedRecording.mimeType ?? null)
        snipCount = snips.length
        snipMaxEndMs = snips.length > 0 ? Math.max(...snips.map((snip) => snip.endMs)) : 0
        snipSumDurationMs = snips.reduce((sum, snip) => sum + Math.max(0, snip.durationMs), 0)

        const baselineDurationMs = chunkMaxOffsetMs ?? sessionDurationMs ?? totalDurationMs
        if (baselineDurationMs > 0 && snipMaxEndMs > baselineDurationMs + 2000) {
          findings.push({
            level: 'error',
            message: 'Snips extend beyond the expected session duration by >2s.',
            meta: { baselineDurationMs, snipMaxEndMs, driftMs: snipMaxEndMs - baselineDurationMs },
          })
        } else if (baselineDurationMs > 0 && snips.length > 0 && snipMaxEndMs < baselineDurationMs - 2000) {
          findings.push({
            level: 'error',
            message: 'Snips do not cover the full expected session duration (end too early).',
            meta: { baselineDurationMs, snipMaxEndMs, driftMs: snipMaxEndMs - baselineDurationMs },
          })
        } else {
          findings.push({
            level: 'info',
            message: 'Snip end times are within expected duration.',
            meta: { baselineDurationMs, snipMaxEndMs },
          })
        }
      } catch (error) {
        findings.push({
          level: 'error',
          message: 'Failed to compute snips for sanity checks.',
          meta: { error: error instanceof Error ? error.message : String(error) },
        })
      }

      // Volume profile sanity (durations, presence, and non-zero content).
      try {
        const profiles = await manifestService.listChunkVolumeProfiles(selectedRecording.id)
        const orderedProfiles = profiles.filter((profile) => profile.seq > 0).sort((a, b) => a.seq - b.seq)
        const profileSeqSet = new Set(orderedProfiles.map((profile) => profile.seq))
        const chunkSeqSet = new Set(playableChunkOffsets.map((chunk) => chunk.seq))
        const missingProfiles = [...chunkSeqSet].filter((seq) => !profileSeqSet.has(seq))

        const zeroDuration = orderedProfiles.filter(
          (profile) => !(typeof profile.durationMs === 'number' && profile.durationMs > 0),
        )
        const zeroFrames = orderedProfiles.filter((profile) => !Array.isArray(profile.frames) || profile.frames.length === 0)
        const allZeroFrames = orderedProfiles.filter((profile) => {
          const frames = Array.isArray(profile.frames) ? profile.frames : []
          if (frames.length === 0) return false
          return frames.every((v) => !Number.isFinite(v) || v <= 0)
        })
        const invalidRates = orderedProfiles.filter(
          (profile) => !(typeof profile.sampleRate === 'number' && profile.sampleRate > 0),
        )
        const invalidFrameDur = orderedProfiles.filter(
          (profile) => !(typeof profile.frameDurationMs === 'number' && profile.frameDurationMs > 0),
        )

        const mismatch: Array<{ seq: number; expectedMs: number; profileMs: number; driftMs: number }> = []
        orderedProfiles.forEach((profile) => {
          const chunk = playableChunkOffsets.find((c) => c.seq === profile.seq) ?? null
          if (!chunk) return
          const expectedMs = Math.max(0, chunk.endMs - chunk.startMs)
          const profileMs = Math.max(0, profile.durationMs ?? 0)
          const driftMs = profileMs - expectedMs
          if (Math.abs(driftMs) > 250) {
            mismatch.push({ seq: profile.seq, expectedMs, profileMs, driftMs })
          }
        })

        if (missingProfiles.length > 0) {
          findings.push({
            level: 'warn',
            message: `Missing chunk volume profiles for ${missingProfiles.length} chunk(s).`,
            meta: { examples: missingProfiles.slice(0, 10) },
          })
        } else {
          findings.push({ level: 'info', message: 'Chunk volume profiles exist for all chunks.' })
        }

        if (zeroDuration.length > 0 || zeroFrames.length > 0 || invalidRates.length > 0 || invalidFrameDur.length > 0) {
          findings.push({
            level: 'warn',
            message: 'Some chunk volume profiles have invalid metadata (duration/frames/sampleRate/frameDuration).',
            meta: {
              zeroDuration: zeroDuration.length,
              zeroFrames: zeroFrames.length,
              invalidSampleRate: invalidRates.length,
              invalidFrameDuration: invalidFrameDur.length,
            },
          })
        } else {
          findings.push({ level: 'info', message: 'Chunk volume profile metadata looks well-formed.' })
        }

        if (allZeroFrames.length > 0) {
          findings.push({
            level: 'warn',
            message: `Some chunk volume profiles are all zeros (silent/failed decode) (${allZeroFrames.length}).`,
            meta: { examples: allZeroFrames.slice(0, 6).map((p) => p.seq) },
          })
        }

        if (mismatch.length > 0) {
          findings.push({
            level: 'warn',
            message: `Chunk volume profile durations differ from chunk timings for ${mismatch.length} chunk(s).`,
            meta: { examples: mismatch.slice(0, 6) },
          })
        } else {
          findings.push({ level: 'info', message: 'Chunk volume profile durations match chunk timings (within 250ms).' })
        }
      } catch (error) {
        findings.push({
          level: 'warn',
          message: 'Unable to validate chunk volume profiles.',
          meta: { error: error instanceof Error ? error.message : String(error) },
        })
      }

      reports.sanity = {
        findings,
        metrics: {
          sessionDurationMs,
          chunkMaxEndMs,
          chunkSumDurationMs,
          snipCount,
          snipMaxEndMs,
          snipSumDurationMs,
          chunkTimebase,
          chunkMaxOffsetMs,
        },
      }
    }

    const runSnipScan = async () => {
      setDoctorProgress({ label: 'Snip scan (each snip)', completed: 0, total: 1 })
      const snips = await recordingSlicesApi.listSnips(selectedRecording, selectedRecording.mimeType ?? null)
      const segments: DoctorSegmentResult[] = []
      const expectedDurationMs = snips.reduce((sum, snip) => sum + Math.max(0, snip.durationMs), 0)
      let observedDurationMs = 0
      let okCount = 0

      setDoctorProgress({ label: 'Snip scan (each snip)', completed: 0, total: snips.length })
      for (let i = 0; i < snips.length; i += 1) {
        if (isCancelled()) return
        const snip = snips[i]
        const snipNumber = i + 1
        try {
          const inspection = await recordingSlicesApi.inspectRange(
            selectedRecording,
            snip.startMs,
            snip.endMs,
            selectedRecording.mimeType ?? null,
          )
          observedDurationMs += inspection.durationMs
          okCount += 1
          const driftMs = Math.abs(inspection.durationMs - Math.max(0, snip.durationMs))
          const silent = inspection.sampleCount > 0 && inspection.rms <= 0.00001 && inspection.peak <= 0.00005
          const status: DoctorSegmentStatus = driftMs > 500 ? 'warn' : silent ? 'warn' : 'ok'
          const reason = driftMs > 500 ? 'Decoded snip duration differs from expected' : silent ? 'Snip appears silent' : undefined
          segments.push({
            index: i,
            startMs: snip.startMs,
            endMs: snip.endMs,
            status,
            reason,
            meta: {
              snipNumber,
              expectedMs: snip.durationMs,
              decodedMs: inspection.durationMs,
              driftMs,
              rms: inspection.rms,
              peak: inspection.peak,
              sampleCount: inspection.sampleCount,
            },
          })
        } catch (error) {
          segments.push({
            index: i,
            startMs: snip.startMs,
            endMs: snip.endMs,
            status: 'error',
            reason: error instanceof Error ? error.message : String(error),
            meta: { snipNumber },
          })
        }

        if (i % 5 === 0) {
          setDoctorProgress({ label: 'Snip scan (each snip)', completed: i + 1, total: snips.length })
          await yieldToUI()
        }
      }

      setDoctorProgress({ label: 'Snip scan (each snip)', completed: snips.length, total: snips.length })
      reports.snipScan = {
        stepMs: 0,
        totalDurationMs: snips.length > 0 ? snips[snips.length - 1].endMs : 0,
        segments,
        summary: summarizeReport(segments),
        metrics: {
          expectedDurationMs,
          observedDurationMs,
          expectedItemCount: snips.length,
          observedItemCount: okCount,
        },
      }
    }

    try {
      if (doctorSelections.sanityChecks) {
        await runSanityChecks()
      }
      if (doctorSelections.chunkCoverageScan) {
        await runChunkCoverageScan()
      }
      if (doctorSelections.rangeAccessScan) {
        await runRangeAccessScan()
      }
      if (doctorSelections.chunkDecodeScan) {
        await runChunkDecodeScan()
      }
      if (doctorSelections.snipScan) {
        await runSnipScan()
      }

      if (isCancelled()) {
        return
      }

      setDoctorReports(reports)
    } catch (error) {
      if (isCancelled()) {
        return
      }
      setDoctorError(error instanceof Error ? error.message : String(error))
    } finally {
      if (!isCancelled()) {
        setDoctorRunning(false)
        setDoctorProgress(null)
      }
    }
  }, [
    doctorSelections.chunkCoverageScan,
    doctorSelections.chunkDecodeScan,
    doctorSelections.rangeAccessScan,
    doctorSelections.sanityChecks,
    doctorSelections.snipScan,
    selectedRecording,
    selectedRecordingDurationMs,
  ])

  const handleCloseDeveloperOverlay = () => {
    setDeveloperOverlayOpen(false)
    setDeveloperTables([])
    setSelectedDeveloperTable(null)
    setDeveloperOverlayMode('tables')
    setLogSessions([])
    setSelectedLogSession(null)
    setLogEntries([])
  }

  const handleStorageLimitChange = async (value: string) => {
    const numeric = Number(value)
    if (!Number.isFinite(numeric) || numeric <= 0) return
    await settingsStore.set({ storageLimitBytes: Math.round(numeric * MB) })
  }

  const handleDeveloperToggle = async (enabled: boolean) => {
    await settingsStore.set({ developerMode: enabled })
  }

  const handleGroqKeyChange = async (value: string) => {
    await settingsStore.set({ groqApiKey: value })
  }

  const handleChunkPlayToggle = useCallback(
    async (chunk: StoredChunk) => {
      const { id } = chunk
      const audioEntries = chunkAudioRef.current
      const activeEntry = audioEntries.get(id)

      const stopEntry = (entryId: string, entry: ChunkPlaybackEntry) => {
        entry.cleanup()
        entry.audio.pause()
        entry.audio.currentTime = entry.startTime
        audioEntries.delete(entryId)
      }

      if (chunkPlayingId === id) {
        if (activeEntry) {
          stopEntry(id, activeEntry)
        }
        setChunkPlayingId(null)
        return
      }

      for (const [entryId, entry] of audioEntries.entries()) {
        stopEntry(entryId, entry)
      }
      setChunkPlayingId(null)

      if (isHeaderSegment(chunk)) {
        return
      }

      const audio = new Audio()
      const url = ensureChunkPlaybackUrl(chunk)
      if (!url) {
        console.error('[UI] Missing chunk URL for playback', id)
        return
      }
      audio.src = url
      audio.volume = playbackVolume

      const startTime = 0
      const endTime = 0

      audioRef.current?.pause()

      function cleanupListeners() {
        audio.removeEventListener('ended', handlePlaybackComplete)
        audio.removeEventListener('error', handlePlaybackComplete)
      }

      function finishPlayback() {
        cleanupListeners()
        audio.pause()
        audio.currentTime = startTime
        audioEntries.delete(id)
        setChunkPlayingId((prev) => (prev === id ? null : prev))
      }

      function handlePlaybackComplete() {
        finishPlayback()
      }

      audio.addEventListener('ended', handlePlaybackComplete)
      audio.addEventListener('error', handlePlaybackComplete)

      const cleanup = () => cleanupListeners()

      audioEntries.set(id, {
        audio,
        cleanup,
        startTime,
        endTime,
      })

      try {
        audio.currentTime = startTime
        await audio.play()
        setChunkPlayingId(id)
      } catch (error) {
        console.error('[UI] Failed to play chunk', error)
        finishPlayback()
      }
    },
    [chunkPlayingId, ensureChunkPlaybackUrl, isHeaderSegment, playbackVolume],
  )

  const handleSnipPlayToggle = useCallback(
    async (segment: SegmentSummary) => {
      if (!selectedRecording) {
        return
      }
      const snipKey = `snip-${segment.index}`
      const audioEntries = snipAudioRef.current
      const activeEntry = audioEntries.get(snipKey)

      const stopEntry = (entryId: string, entry: ChunkPlaybackEntry) => {
        entry.cleanup()
        entry.audio.pause()
        entry.audio.currentTime = entry.startTime
        audioEntries.delete(entryId)
      }

      if (snipPlayingId === snipKey) {
        if (activeEntry) {
          stopEntry(snipKey, activeEntry)
        }
        setSnipPlayingId(null)
        return
      }

      // Ensure any existing chunk playback is stopped before we start a snip.
      chunkAudioRef.current.forEach((entry, entryId) => {
        entry.cleanup()
        entry.audio.pause()
        entry.audio.currentTime = entry.startTime
        chunkAudioRef.current.delete(entryId)
      })
      setChunkPlayingId(null)

      for (const [entryId, entry] of audioEntries.entries()) {
        stopEntry(entryId, entry)
      }
      setSnipPlayingId(null)

      const resolved = await ensureSnipPlaybackUrl(segment)
      if (!resolved) {
        return
      }

      const audio = new Audio()
      audio.src = resolved.url
      audio.volume = playbackVolume

      const durationSeconds = Math.max(0, (segment.endMs - segment.startMs) / 1000)
      const startTime = 0
      const endTime = durationSeconds

      audioRef.current?.pause()

      function cleanupListeners() {
        audio.removeEventListener('timeupdate', handleTimeUpdate)
        audio.removeEventListener('ended', handlePlaybackComplete)
        audio.removeEventListener('error', handlePlaybackComplete)
      }

      function finishPlayback() {
        cleanupListeners()
        audio.pause()
        audio.currentTime = startTime
        audioEntries.delete(snipKey)
        setSnipPlayingId((prev) => (prev === snipKey ? null : prev))
      }

      function handlePlaybackComplete() {
        finishPlayback()
      }

      function handleTimeUpdate() {
        if (durationSeconds > 0 && audio.currentTime >= endTime - 0.05) {
          finishPlayback()
        }
      }

      audio.addEventListener('timeupdate', handleTimeUpdate)
      audio.addEventListener('ended', handlePlaybackComplete)
      audio.addEventListener('error', handlePlaybackComplete)

      const cleanup = () => cleanupListeners()

      audioEntries.set(snipKey, {
        audio,
        cleanup,
        startTime,
        endTime,
      })

      try {
        await audio.play()
        setSnipPlayingId(snipKey)
      } catch (error) {
        console.error('[UI] Failed to play snip', error)
        finishPlayback()
      }
    },
    [ensureSnipPlaybackUrl, playbackVolume, selectedRecording, snipPlayingId],
  )

    const loadDeveloperTables = useCallback(async () => {
      try {
        const [sessions, chunks, chunkVolumes] = await Promise.all([
          manifestService.listSessions(),
          manifestService.getChunksForInspection(),
          manifestService.listChunkVolumeProfiles(),
        ])
        setDeveloperTables([
          { name: 'sessions', rows: sessions.map((row) => ({ ...row })) },
          { name: 'chunks', rows: chunks.map((row) => ({ ...row })) },
          {
            name: 'chunkVolumes',
            rows: chunkVolumes.map((row) => ({
              ...row,
              framesPreview: row.frames.slice(0, 24),
              framesTotal: row.frames.length,
            })),
          },
        ])
        setSelectedDeveloperTable((prev) => prev ?? 'sessions')
      } catch (error) {
        console.error('[UI] Failed to load developer tables', error)
        setDeveloperTables([])
        setSelectedDeveloperTable('sessions')
        await logError('Developer table load failed', {
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }, [])

  const handleSelectLogSession = useCallback(
    async (session: LogSessionRecord | null) => {
      setSelectedLogSession(session)
      if (session) {
        const entries = await manifestService.getLogEntries(session.id)
        setLogEntries(entries)
      } else {
        setLogEntries([])
      }
    },
    [],
  )

  const loadLogSessions = useCallback(async () => {
    try {
      const sessions = await manifestService.listLogSessions()
      setLogSessions(sessions)
      const current = getActiveLogSession()
      const preferred = current ?? sessions[0] ?? null
      await handleSelectLogSession(preferred)
    } catch (error) {
      console.error('[UI] Failed to load log sessions', error)
      setLogSessions([])
      await handleSelectLogSession(null)
      await logError('Log session load failed', {
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }, [handleSelectLogSession])

  const handleLogSessionNav = useCallback(
    async (direction: -1 | 1) => {
      if (!selectedLogSession) return
      const index = logSessions.findIndex((session) => session.id === selectedLogSession.id)
      if (index === -1) return
      const next = logSessions[index + direction]
      if (next) {
        await handleSelectLogSession(next)
      }
    },
    [handleSelectLogSession, logSessions, selectedLogSession],
  )

  const handleOpenDeveloperOverlay = useCallback(async () => {
    setDeveloperOverlayMode('tables')
    setDeveloperOverlayOpen(true)
    setDeveloperOverlayLoading(true)
    try {
      await loadDeveloperTables()
      await loadLogSessions()
    } catch (error) {
      console.error('[UI] Failed to load developer data', error)
      setDeveloperTables([])
      setSelectedDeveloperTable(null)
      await logError('Developer overlay failed to load', {
        error: error instanceof Error ? error.message : String(error),
      })
    } finally {
      setDeveloperOverlayLoading(false)
    }
  }, [loadDeveloperTables, loadLogSessions])

  const bufferLabel = `${formatDataSize(bufferTotals.totalBytes)} / ${formatDataSize(bufferTotals.limitBytes)}`
  const displayDurationMs = selectedRecording && selectedRecording.id === captureState.sessionId && captureState.state === 'recording'
    ? recordingElapsedMs
    : selectedRecordingDurationMs ?? selectedRecording?.durationMs ?? 0
  const resolvedPlaybackDurationSeconds = selectedRecordingDurationMs !== null
    ? Math.max(selectedRecordingDurationMs / 1000, audioState.duration)
    : Math.max(displayDurationMs / 1000, audioState.duration)
  const playbackProgress = resolvedPlaybackDurationSeconds > 0
    ? (audioState.position / resolvedPlaybackDurationSeconds) * 100
    : 0
    const effectiveChunkCount = Math.max(
      0,
      captureState.chunksRecorded - (captureState.chunksRecorded > 0 ? 1 : 0),
    )
    const hasInitSegment = captureState.chunksRecorded > 0

  return (
      <div className="app-shell">
        <header className="app-header">
          <div className="brand">
            <h1>Web Whisper</h1>
          </div>
          <div className="header-controls">
          <div className="buffer-card" role="status" aria-live="polite">
            <p className="buffer-label">Buffered locally</p>
            <p className="buffer-value">{bufferLabel}</p>
          </div>
          {developerMode ? (
            <button
              className="dev-trigger"
              type="button"
              onClick={handleOpenDeveloperOverlay}
              aria-label="Open developer console"
            >
              🐞
            </button>
          ) : null}
          <button
            className="settings-button"
            type="button"
            onClick={() => setIsSettingsOpen(true)}
          >
            Settings
          </button>
          </div>
        </header>

        {developerMode && captureState.state === 'recording' ? (
          <div className="dev-strip" role="status" aria-live="polite">
            <span>
              Segments: {effectiveChunkCount}
              {hasInitSegment ? ' + init' : ''}
            </span>
            <span>Buffered: {formatDataSize(captureState.bytesBuffered)}</span>
            {captureState.lastChunkAt ? (
              <span>Last chunk: {formatClock(captureState.lastChunkAt)}</span>
            ) : null}
          </div>
        ) : null}

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
                const isActiveRecording = session.id === captureState.sessionId && captureState.state === 'recording'
                const durationLabel = isActiveRecording
                  ? formatTimecode(Math.floor(Math.max(recordingElapsedMs, 0) / 1000))
                  : formatSessionDuration(session.durationMs)
                const notes = session.notes ?? 'Transcription pending…'
                const metadataLabel = `${formatSessionDateTime(session.startedAt)} · ${formatCompactDataSize(session.totalBytes)}`
                const isHighlighted = session.id === highlightedSessionId
                const cardClasses = ['session-card']
                if (isHighlighted) {
                  cardClasses.push('is-new')
                }
                if (session.status === 'error') {
                  cardClasses.push('has-error')
                }
                const previewText = isActiveRecording ? 'Recording in progress…' : notes
                return (
                  <li key={session.id}>
                    <article
                      className={cardClasses.join(' ')}
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
                          <div className="session-topline-left">
                            <span className={`session-pill ${statusMeta.pillClass}`}>{statusMeta.label}</span>
                            <span className="session-duration-label">{durationLabel}</span>
                          </div>
                          <div className="session-topline-right">
                            <span className="session-meta">{metadataLabel}</span>
                          </div>
                        </header>
                        <p className="session-preview">{previewText}</p>
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
              className={`record-toggle ${captureState.state === 'recording' ? 'record-toggle-stop' : 'record-toggle-start'}`}
              type="button"
              onClick={handleRecordToggle}
              aria-pressed={captureState.state === 'recording'}
            >
              {captureState.state === 'recording' ? 'Stop recording' : 'Start recording'}
            </button>
            <p className="controls-copy">
              {captureState.state === 'recording'
                ? `Recording — ${formatTimecode(Math.floor(Math.max(recordingElapsedMs, 0) / 1000))} elapsed`
                : 'Recorder idle — tap start to begin a durable session.'}
            </p>
          </div>
        </aside>
      </main>

        {isTranscriptionMounted ? (
          <section
            className={`transcription-panel${isTranscriptionVisible ? ' is-visible' : ''}`}
            aria-live="polite"
            aria-label="Live transcription preview"
          >
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
        ) : null}

      <audio ref={audioRef} hidden preload="none" />

        {selectedRecording ? (
          <div
            className="detail-overlay"
            role="dialog"
            aria-modal="true"
            aria-labelledby="recording-detail-title"
            onClick={(event) => {
              if (event.target === event.currentTarget) {
                void handleCloseDetail()
              }
            }}
          >
            <div className="detail-panel" onClick={(event) => event.stopPropagation()}>
            <header className="detail-header">
                <div>
                  <p className="detail-label">
                    {selectedRecording.id === captureState.sessionId && captureState.state === 'recording'
                      ? 'Recording in progress'
                      : 'Recorded session'}
                  </p>
                  <h2 id="recording-detail-title">{formatDuration(displayDurationMs)}</h2>
                </div>
              <div className="detail-actions">
                  {developerMode ? (
                    <button
                      className={`detail-graph-toggle ${isAnalysisGraphOpen ? 'is-active' : ''}`}
                      type="button"
                      onClick={() => setAnalysisGraphOpen((prev) => !prev)}
                      aria-pressed={isAnalysisGraphOpen}
                      aria-label={isAnalysisGraphOpen ? 'Hide audio chunking analysis' : 'Show audio chunking analysis'}
                    >
                      📈
                    </button>
                  ) : null}
                  {developerMode ? (
                    <button
                      className={`detail-doctor-toggle ${doctorOpen ? 'is-active' : ''}`}
                      type="button"
                      onClick={() => setDoctorOpen((prev) => !prev)}
                      aria-pressed={doctorOpen}
                      aria-label={doctorOpen ? 'Hide recording doctor diagnostics' : 'Show recording doctor diagnostics'}
                    >
                      🩺
                    </button>
                  ) : null}
                  {developerMode ? (
                  <button
                    className={`detail-debug-toggle ${debugDetailsOpen ? 'is-active' : ''}`}
                    type="button"
                    onClick={() => setDebugDetailsOpen((prev) => !prev)}
                    aria-pressed={debugDetailsOpen}
                    aria-label={debugDetailsOpen ? 'Hide developer details' : 'Show developer details'}
                  >
                    🐞
                  </button>
                ) : null}
                <button className="detail-close" type="button" onClick={handleCloseDetail}>
                  Close
                </button>
              </div>
            </header>
            <div className="detail-body">
              <div className="detail-summary">
                  <p>
                    <strong>Captured:</strong> {formatDate(selectedRecording.startedAt)} {formatClock(selectedRecording.startedAt)} →{' '}
                    {formatSessionEnd(selectedRecording.startedAt, selectedRecording.durationMs)}
                </p>
                <p>
                  <strong>Size:</strong> {formatDataSize(selectedRecording.totalBytes)}
                </p>
                {developerMode && debugDetailsOpen ? (
                  <p>
                    <strong>Format:</strong> {selectedRecording.mimeType ?? 'pending'} ·{' '}
                    <strong>Chunks:</strong> {playableChunkCount}
                    {headerChunk ? ' + init' : ''}
                  </p>
                ) : null}
              </div>
                <div className="playback-controls">
                <button
                  className="playback-button"
                  type="button"
                  onClick={handlePlaybackToggle}
                  disabled={isLoadingPlayback || selectedRecording.chunkCount === 0}
                  aria-pressed={audioState.playing}
                >
                  {isLoadingPlayback ? '…' : audioState.playing ? '⏸' : '▶'}
                </button>
                <div className="playback-progress" aria-hidden="true">
                  <div className="playback-progress-bar" style={{ width: `${playbackProgress}%` }} />
                </div>
                  <span className="playback-timestamps">
                    {formatTimecode(audioState.position)} / {formatTimecode(resolvedPlaybackDurationSeconds)}
                  </span>
                <div className={`volume-control ${isVolumeSliderOpen ? 'is-open' : ''}`}>
                  <button
                    type="button"
                    className="volume-button"
                    aria-pressed={isVolumeSliderOpen}
                    aria-label={isVolumeSliderOpen ? 'Hide volume slider' : 'Show volume slider'}
                    onClick={() => setVolumeSliderOpen((prev) => !prev)}
                  >
                    {playbackVolume === 0 ? '🔇' : playbackVolume < 0.5 ? '🔈' : '🔊'}
                  </button>
                  {isVolumeSliderOpen ? (
                    <input
                      className="volume-slider"
                      type="range"
                      min={0}
                      max={100}
                      value={Math.round(playbackVolume * 100)}
                      onChange={(event) => setPlaybackVolume(Number(event.target.value) / 100)}
                      aria-label="Playback volume"
                    />
                  ) : null}
                </div>
              </div>
                {playbackError ? <p className="detail-notes" role="alert">{playbackError}</p> : null}
                  {developerMode && isAnalysisGraphOpen ? (
                    <div className="detail-analysis">
                      {analysisState === 'loading' ? (
                        <p className="detail-analysis-status">Analyzing audio for pauses…</p>
                      ) : analysisState === 'error' ? (
                        <p className="detail-analysis-status" role="alert">{analysisError ?? 'Unable to analyze audio.'}</p>
                      ) : sessionAnalysis ? (
                          <RecordingAnalysisGraph
                            analysis={sessionAnalysis}
                            targetRange={{ minMs: 5000, idealMs: 10000, maxMs: 60000 }}
                            playback={{
                              positionMs: Math.max(0, audioState.position * 1000),
                              isPlaying: audioState.playing,
                            }}
                          />
                      ) : (
                        <p className="detail-analysis-status">Preparing analysis…</p>
                      )}
                    </div>
                  ) : null}
                <div className="detail-transcription">
                  <h3>Transcription</h3>
                  <p className="detail-transcription-placeholder">Not yet implemented — will stream from Groq once wired.</p>
                </div>
                {developerMode && doctorOpen ? (
                  <div className="detail-doctor">
                    <div className="detail-doctor-header">
                      <h3>Doctor diagnostics</h3>
                      <div className="detail-doctor-actions">
                        <button
                          type="button"
                          onClick={async () => {
                            if (!selectedRecording) return
                            setDoctorCopyStatus(null)
                            setDoctorExportText(null)
                            try {
                              await manifestService.init()
                              const activeLogSession = getActiveLogSession()
                              const logSessionId = activeLogSession?.id ?? null
                              const logEntriesRaw = logSessionId ? await manifestService.getLogEntries(logSessionId, 400) : []
                              const compactText = buildCompactDoctorReport({
                                session: selectedRecording,
                                doctorReports,
                                logs: logEntriesRaw.map((entry) => ({
                                  level: entry.level,
                                  message: entry.message,
                                  timestamp: entry.timestamp,
                                })),
                              })
                              // Keep a small export text visible so users can manual-copy on iOS.
                              setDoctorExportText(compactText)
                              try {
                                await copyToClipboard(compactText)
                                setDoctorCopyStatus('Copied compact report to clipboard.')
                                window.setTimeout(() => setDoctorCopyStatus(null), 2500)
                              } catch (error) {
                                setDoctorCopyStatus('Clipboard copy blocked; compact report shown below (tap Select all).')
                              }
                            } catch (error) {
                              setDoctorCopyStatus(`Copy failed: ${error instanceof Error ? error.message : String(error)}`)
                            }
                          }}
                          disabled={doctorRunning}
                        >
                          Copy compact report
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            doctorRunIdRef.current += 1
                            setDoctorRunning(false)
                            setDoctorProgress(null)
                          }}
                          disabled={!doctorRunning}
                        >
                          Cancel
                        </button>
                        <button type="button" onClick={() => void runDoctorDiagnostics()} disabled={doctorRunning}>
                          {doctorRunning ? 'Running…' : 'Run selected tests'}
                        </button>
                      </div>
                    </div>
                    {doctorCopyStatus ? <p className="detail-transcription-placeholder">{doctorCopyStatus}</p> : null}
                    {doctorExportText ? (
                      <div className="doctor-export">
                        <div className="doctor-export-actions">
                          <button
                            type="button"
                            onClick={() => {
                              const textarea = document.getElementById('doctor-export-textarea') as HTMLTextAreaElement | null
                              if (textarea) {
                                textarea.focus()
                                textarea.select()
                              }
                            }}
                          >
                            Select all
                          </button>
                          <button type="button" onClick={() => setDoctorExportText(null)}>
                            Hide
                          </button>
                        </div>
                        <textarea
                          id="doctor-export-textarea"
                          className="doctor-export-textarea"
                          readOnly
                          value={doctorExportText}
                          rows={10}
                        />
                      </div>
                    ) : null}

                    <p className="detail-transcription-placeholder">
                      Runs quick integrity checks to help identify whether corruption is in stored chunks or in range access/decoding.
                    </p>

                    <div className="doctor-test-list">
                      <label className="doctor-test">
                        <input
                          type="checkbox"
                          checked={doctorSelections.sanityChecks}
                          disabled={doctorRunning}
                          onChange={(event) =>
                            setDoctorSelections((prev) => ({ ...prev, sanityChecks: event.target.checked }))
                          }
                        />
                        <span>Sanity checks (durations, snip bounds, chunk timing)</span>
                      </label>
                      <label className="doctor-test">
                        <input
                          type="checkbox"
                          checked={doctorSelections.chunkCoverageScan}
                          disabled={doctorRunning}
                          onChange={(event) =>
                            setDoctorSelections((prev) => ({ ...prev, chunkCoverageScan: event.target.checked }))
                          }
                        />
                        <span>Chunk coverage scan (IndexedDB timings/coverage, 0.1s)</span>
                      </label>
                      <label className="doctor-test">
                        <input
                          type="checkbox"
                          checked={doctorSelections.rangeAccessScan}
                          disabled={doctorRunning}
                          onChange={(event) =>
                            setDoctorSelections((prev) => ({ ...prev, rangeAccessScan: event.target.checked }))
                          }
                        />
                        <span>Range access scan via slice API (decode+inspect, 0.1s)</span>
                      </label>
                      <label className="doctor-test">
                        <input
                          type="checkbox"
                          checked={doctorSelections.chunkDecodeScan}
                          disabled={doctorRunning}
                          onChange={(event) =>
                            setDoctorSelections((prev) => ({ ...prev, chunkDecodeScan: event.target.checked }))
                          }
                        />
                        <span>Per-chunk decode scan (decode each chunk blob)</span>
                      </label>
                      <label className="doctor-test">
                        <input
                          type="checkbox"
                          checked={doctorSelections.snipScan}
                          disabled={doctorRunning}
                          onChange={(event) =>
                            setDoctorSelections((prev) => ({ ...prev, snipScan: event.target.checked }))
                          }
                        />
                        <span>Snip scan (inspect each snip range)</span>
                      </label>
                    </div>

                    {doctorProgress ? (
                      <p className="detail-transcription-placeholder">
                        {doctorProgress.label}: {doctorProgress.completed}/{doctorProgress.total}
                      </p>
                    ) : null}
                    {doctorError ? (
                      <p className="detail-transcription-placeholder" role="alert">
                        {doctorError}
                      </p>
                    ) : null}

                    {doctorReports?.sanity ? (
                      <div className="doctor-report">
                        <h4>Sanity checks</h4>
                        <p className="doctor-summary">
                          Session duration: {((doctorReports.sanity.metrics.sessionDurationMs ?? 0) / 1000).toFixed(1)}s · Chunk
                          timebase: {doctorReports.sanity.metrics.chunkTimebase} · Chunk max end:{' '}
                          {((doctorReports.sanity.metrics.chunkMaxOffsetMs ?? 0) / 1000).toFixed(1)}s · Chunk sum:{' '}
                          {((doctorReports.sanity.metrics.chunkSumDurationMs ?? 0) / 1000).toFixed(1)}s · Snips:{' '}
                          {doctorReports.sanity.metrics.snipCount ?? 0} · Snip max end:{' '}
                          {((doctorReports.sanity.metrics.snipMaxEndMs ?? 0) / 1000).toFixed(1)}s · Snip sum:{' '}
                          {((doctorReports.sanity.metrics.snipSumDurationMs ?? 0) / 1000).toFixed(1)}s
                        </p>
                        <div className="doctor-report-actions">
                          <button
                            type="button"
                            onClick={() =>
                              downloadDoctorJson(`sanity-${selectedRecording.id}`, {
                                sessionId: selectedRecording.id,
                                mimeType: selectedRecording.mimeType,
                                report: doctorReports.sanity,
                              })
                            }
                          >
                            Download JSON
                          </button>
                        </div>
                        <div className="doctor-details">
                          {doctorReports.sanity.findings.length === 0 ? (
                            <p className="detail-transcription-placeholder">No findings.</p>
                          ) : (
                            doctorReports.sanity.findings.map((finding, idx) => (
                              <div key={idx} className={`doctor-detail-row is-${finding.level === 'info' ? 'ok' : finding.level}`}>
                                <div className="doctor-detail-main">
                                  <span className="doctor-detail-badge">{finding.level.toUpperCase()}</span>
                                  <span className="doctor-detail-reason">{finding.message}</span>
                                </div>
                              </div>
                            ))
                          )}
                        </div>
                      </div>
                    ) : null}

                    {(() => {
                      const report = doctorReports?.chunkCoverage
                      if (!report) return null
                      return (
                        <div className="doctor-report">
                          <h4>Chunk coverage scan</h4>
                          <div className="doctor-bar" role="img" aria-label="Chunk coverage results timeline">
                            {report.segments.map((segment) => (
                              <span
                                key={segment.index}
                                className={`doctor-segment is-${segment.status}`}
                                title={`${formatTimecodeTenths(segment.startMs)}–${formatTimecodeTenths(segment.endMs)}${
                                  segment.reason ? ` · ${segment.reason}` : ''
                                }`}
                              />
                            ))}
                          </div>
                          <p className="doctor-summary">
                            OK {report.summary.ok} ({formatPercent(report.summary.ok, report.summary.total)}) · Warn{' '}
                            {report.summary.warn} ({formatPercent(report.summary.warn, report.summary.total)}) · Error{' '}
                            {report.summary.error} ({formatPercent(report.summary.error, report.summary.total)})
                          </p>
                          <p className="doctor-summary">
                            Expected audio: {((report.metrics.expectedDurationMs ?? 0) / 1000).toFixed(1)}s · Observed audio:{' '}
                            {((report.metrics.observedDurationMs ?? 0) / 1000).toFixed(1)}s · Expected segments:{' '}
                            {report.metrics.expectedItemCount ?? 0} · Observed segments: {report.metrics.observedItemCount ?? 0}
                          </p>
                          <div className="doctor-report-actions">
                            <button
                              type="button"
                              onClick={() =>
                                downloadDoctorJson(`chunk-coverage-${selectedRecording.id}`, {
                                  sessionId: selectedRecording.id,
                                  mimeType: selectedRecording.mimeType,
                                  report,
                                })
                              }
                            >
                              Download JSON
                            </button>
                          </div>
                          <div className="doctor-details">
                            {groupSegmentsByReason(report.segments)
                              .filter((group) => group.status !== 'ok')
                              .map((group) => (
                                <div
                                  key={`${group.status}:${group.reason}`}
                                  className={`doctor-detail-row is-${group.status}`}
                                >
                                  <div className="doctor-detail-main">
                                    <span className="doctor-detail-badge">{group.status.toUpperCase()}</span>
                                    <span className="doctor-detail-reason">{group.reason}</span>
                                    <span className="doctor-detail-count">
                                      {group.count} ({formatPercent(group.count, report.summary.total)})
                                    </span>
                                  </div>
                                  <div className="doctor-detail-examples">
                                    {group.examples.map((segment) => (
                                      <span key={segment.index} className="doctor-detail-example">
                                        {formatTimecodeTenths(segment.startMs)}–{formatTimecodeTenths(segment.endMs)}
                                      </span>
                                    ))}
                                  </div>
                                </div>
                              ))}
                          </div>
                        </div>
                      )
                    })()}

                    {(() => {
                      const report = doctorReports?.rangeAccess
                      if (!report) return null
                      return (
                        <div className="doctor-report">
                          <h4>Range access scan (0.1s)</h4>
                          <div className="doctor-bar" role="img" aria-label="Range access results timeline">
                            {report.segments.map((segment) => (
                              <span
                                key={segment.index}
                                className={`doctor-segment is-${segment.status}`}
                                title={`${formatTimecodeTenths(segment.startMs)}–${formatTimecodeTenths(segment.endMs)}${
                                  segment.reason ? ` · ${segment.reason}` : ''
                                }`}
                              />
                            ))}
                          </div>
                          <p className="doctor-summary">
                            OK {report.summary.ok} ({formatPercent(report.summary.ok, report.summary.total)}) · Warn{' '}
                            {report.summary.warn} ({formatPercent(report.summary.warn, report.summary.total)}) · Error{' '}
                            {report.summary.error} ({formatPercent(report.summary.error, report.summary.total)})
                          </p>
                          <p className="doctor-summary">
                            Expected audio: {((report.metrics.expectedDurationMs ?? 0) / 1000).toFixed(1)}s · Observed audio:{' '}
                            {((report.metrics.observedDurationMs ?? 0) / 1000).toFixed(1)}s · Expected windows:{' '}
                            {report.metrics.expectedItemCount ?? 0} · Decoded windows: {report.metrics.observedItemCount ?? 0}
                          </p>
                          <div className="doctor-report-actions">
                            <button
                              type="button"
                              onClick={() =>
                                downloadDoctorJson(`range-access-${selectedRecording.id}`, {
                                  sessionId: selectedRecording.id,
                                  mimeType: selectedRecording.mimeType,
                                  report,
                                })
                              }
                            >
                              Download JSON
                            </button>
                          </div>
                          <div className="doctor-details">
                            {groupSegmentsByReason(report.segments)
                              .filter((group) => group.status !== 'ok')
                              .map((group) => (
                                <div
                                  key={`${group.status}:${group.reason}`}
                                  className={`doctor-detail-row is-${group.status}`}
                                >
                                  <div className="doctor-detail-main">
                                    <span className="doctor-detail-badge">{group.status.toUpperCase()}</span>
                                    <span className="doctor-detail-reason">{group.reason}</span>
                                    <span className="doctor-detail-count">
                                      {group.count} ({formatPercent(group.count, report.summary.total)})
                                    </span>
                                  </div>
                                  <div className="doctor-detail-examples">
                                    {group.examples.map((segment) => (
                                      <span key={segment.index} className="doctor-detail-example">
                                        {formatTimecodeTenths(segment.startMs)}–{formatTimecodeTenths(segment.endMs)}
                                      </span>
                                    ))}
                                  </div>
                                </div>
                              ))}
                          </div>
                        </div>
                      )
                    })()}

                    {(() => {
                      const report = doctorReports?.chunkDecode
                      if (!report) return null
                      return (
                        <div className="doctor-report">
                          <h4>Per-chunk decode scan</h4>
                          <div className="doctor-bar" role="img" aria-label="Per-chunk decode results timeline">
                            {report.segments.map((segment) => (
                              <span
                                key={segment.index}
                                className={`doctor-segment is-${segment.status}`}
                                title={`Chunk #${segment.index + 1}${segment.reason ? ` · ${segment.reason}` : ''}`}
                              />
                            ))}
                          </div>
                          <p className="doctor-summary">
                            OK {report.summary.ok} ({formatPercent(report.summary.ok, report.summary.total)}) · Warn{' '}
                            {report.summary.warn} ({formatPercent(report.summary.warn, report.summary.total)}) · Error{' '}
                            {report.summary.error} ({formatPercent(report.summary.error, report.summary.total)})
                          </p>
                          <p className="doctor-summary">
                            Expected audio: {((report.metrics.expectedDurationMs ?? 0) / 1000).toFixed(1)}s · Decoded audio:{' '}
                            {((report.metrics.observedDurationMs ?? 0) / 1000).toFixed(1)}s · Expected chunks:{' '}
                            {report.metrics.expectedItemCount ?? 0} · Decoded chunks: {report.metrics.observedItemCount ?? 0}
                          </p>
                          <div className="doctor-report-actions">
                            <button
                              type="button"
                              onClick={() =>
                                downloadDoctorJson(`chunk-decode-${selectedRecording.id}`, {
                                  sessionId: selectedRecording.id,
                                  mimeType: selectedRecording.mimeType,
                                  report,
                                })
                              }
                            >
                              Download JSON
                            </button>
                          </div>
                          <div className="doctor-details">
                            {groupSegmentsByReason(report.segments)
                              .filter((group) => group.status !== 'ok')
                              .map((group) => (
                                <div
                                  key={`${group.status}:${group.reason}`}
                                  className={`doctor-detail-row is-${group.status}`}
                                >
                                  <div className="doctor-detail-main">
                                    <span className="doctor-detail-badge">{group.status.toUpperCase()}</span>
                                    <span className="doctor-detail-reason">{group.reason}</span>
                                    <span className="doctor-detail-count">
                                      {group.count} ({formatPercent(group.count, report.summary.total)})
                                    </span>
                                  </div>
                                  <div className="doctor-detail-examples">
                                    {group.examples.map((segment) => (
                                      <span key={segment.index} className="doctor-detail-example">
                                        #{segment.index + 1}
                                      </span>
                                    ))}
                                  </div>
                                </div>
                              ))}
                          </div>
                        </div>
                      )
                    })()}

                    {(() => {
                      const report = doctorReports?.snipScan
                      if (!report) return null
                      return (
                        <div className="doctor-report">
                          <h4>Snip scan (each snip)</h4>
                          <div className="doctor-bar" role="img" aria-label="Snip scan results timeline">
                            {report.segments.map((segment) => (
                              <span
                                key={segment.index}
                                className={`doctor-segment is-${segment.status}`}
                                title={`Snip #${segment.index + 1} · ${formatTimecodeTenths(segment.startMs)}–${formatTimecodeTenths(
                                  segment.endMs,
                                )}${segment.reason ? ` · ${segment.reason}` : ''}`}
                              />
                            ))}
                          </div>
                          <p className="doctor-summary">
                            OK {report.summary.ok} ({formatPercent(report.summary.ok, report.summary.total)}) · Warn{' '}
                            {report.summary.warn} ({formatPercent(report.summary.warn, report.summary.total)}) · Error{' '}
                            {report.summary.error} ({formatPercent(report.summary.error, report.summary.total)})
                          </p>
                          <p className="doctor-summary">
                            Expected audio: {((report.metrics.expectedDurationMs ?? 0) / 1000).toFixed(1)}s · Observed audio:{' '}
                            {((report.metrics.observedDurationMs ?? 0) / 1000).toFixed(1)}s · Expected snips:{' '}
                            {report.metrics.expectedItemCount ?? 0} · Decoded snips: {report.metrics.observedItemCount ?? 0}
                          </p>
                          <div className="doctor-report-actions">
                            <button
                              type="button"
                              onClick={() =>
                                downloadDoctorJson(`snip-scan-${selectedRecording.id}`, {
                                  sessionId: selectedRecording.id,
                                  mimeType: selectedRecording.mimeType,
                                  report,
                                })
                              }
                            >
                              Download JSON
                            </button>
                          </div>
                          <div className="doctor-details">
                            {groupSegmentsByReason(report.segments)
                              .filter((group) => group.status !== 'ok')
                              .map((group) => (
                                <div key={`${group.status}:${group.reason}`} className={`doctor-detail-row is-${group.status}`}>
                                  <div className="doctor-detail-main">
                                    <span className="doctor-detail-badge">{group.status.toUpperCase()}</span>
                                    <span className="doctor-detail-reason">{group.reason}</span>
                                    <span className="doctor-detail-count">
                                      {group.count} ({formatPercent(group.count, report.summary.total)})
                                    </span>
                                  </div>
                                  <div className="doctor-detail-examples">
                                    {group.examples.map((segment) => (
                                      <span key={segment.index} className="doctor-detail-example">
                                        #{segment.index + 1}
                                      </span>
                                    ))}
                                  </div>
                                </div>
                              ))}
                          </div>
                        </div>
                      )
                    })()}
                  </div>
                ) : null}
                {developerMode && debugDetailsOpen ? (
                  <div className="detail-chunks">
                    <div className="detail-slices-header">
                      <h3>
                        {detailSliceMode === 'chunks'
                          ? `Chunks (${playableChunkCount}${headerChunk ? ' + init' : ''})`
                          : `Snips (${sessionAnalysis?.segments?.length ?? 0})`}{' '}
                        · {selectedRecording.mimeType ?? 'pending'}
                      </h3>
                      <div className="detail-slice-toggle" role="tablist" aria-label="Slice mode">
                        <button
                          type="button"
                          role="tab"
                          aria-selected={detailSliceMode === 'chunks'}
                          className={detailSliceMode === 'chunks' ? 'is-selected' : ''}
                          onClick={() => setDetailSliceMode('chunks')}
                        >
                          Chunks
                        </button>
                        <button
                          type="button"
                          role="tab"
                          aria-selected={detailSliceMode === 'snips'}
                          className={detailSliceMode === 'snips' ? 'is-selected' : ''}
                          onClick={() => setDetailSliceMode('snips')}
                        >
                          Snips
                        </button>
                      </div>
                    </div>

                    {detailSliceMode === 'chunks' ? (
                      chunkData.length === 0 ? (
                        <p className="detail-transcription-placeholder">No chunks persisted yet.</p>
                      ) : (
                        <ul className="chunk-list">
                          {chunkData.map((chunk) => {
                            const durationSeconds = Math.max(0, (chunk.endMs - chunk.startMs) / 1000)
                            const decimalPlaces = durationSeconds < 10 ? 2 : 1
                            const durationLabel = `${durationSeconds.toFixed(decimalPlaces)} s`
                            const header = isHeaderSegment(chunk)
                            const isChunkPlaying = chunkPlayingId === chunk.id
                            const sequenceLabel = chunk.seq + 1
                            const playLabel = header
                              ? `Chunk ${sequenceLabel} is an init segment without audio`
                              : isChunkPlaying
                                ? `Pause chunk ${sequenceLabel}`
                                : `Play chunk ${sequenceLabel}`
                            return (
                              <li key={chunk.id} className={`chunk-item ${header ? 'header-chunk' : ''}`}>
                                <button
                                  type="button"
                                  className={`chunk-play ${isChunkPlaying ? 'is-playing' : ''}`}
                                  onClick={() => void handleChunkPlayToggle(chunk)}
                                  aria-pressed={isChunkPlaying}
                                  aria-label={playLabel}
                                  disabled={header}
                                  title={header ? 'Init segment (no audio payload)' : undefined}
                                >
                                  {header ? 'NA' : isChunkPlaying ? '⏸' : '▶'}
                                </button>
                                <span>#{sequenceLabel}</span>
                                <span>{durationLabel}</span>
                                <span>{formatDataSize(chunk.byteLength)}</span>
                                <button
                                  type="button"
                                  className="chunk-download"
                                  onClick={() => handleChunkDownload(chunk)}
                                  aria-label={`Download chunk ${sequenceLabel}`}
                                  disabled={header}
                                  title={header ? 'Init segment (typically no downloadable audio)' : undefined}
                                >
                                  ⬇
                                </button>
                                {header ? <span className="chunk-flag">init segment</span> : null}
                              </li>
                            )
                          })}
                        </ul>
                      )
                    ) : analysisState === 'loading' ? (
                      <p className="detail-transcription-placeholder">Analyzing audio for snips…</p>
                    ) : analysisState === 'error' ? (
                      <p className="detail-transcription-placeholder" role="alert">
                        {analysisError ?? 'Unable to analyze audio.'}
                      </p>
                    ) : sessionAnalysis?.segments?.length ? (
                      <ul className="chunk-list">
                        {sessionAnalysis.segments.map((segment) => {
                          const snipNumber = segment.index + 1
                          const durationSeconds = Math.max(0, segment.durationMs / 1000)
                          const decimalPlaces = durationSeconds < 10 ? 2 : 1
                          const durationLabel = `${durationSeconds.toFixed(decimalPlaces)} s`
                          const snipKey = `snip-${segment.index}`
                          const isSnipPlaying = snipPlayingId === snipKey
                          const playLabel = isSnipPlaying ? `Pause snip ${snipNumber}` : `Play snip ${snipNumber}`
                          return (
                            <li key={snipKey} className="chunk-item">
                              <button
                                type="button"
                                className={`chunk-play ${isSnipPlaying ? 'is-playing' : ''}`}
                                onClick={() => void handleSnipPlayToggle(segment)}
                                aria-pressed={isSnipPlaying}
                                aria-label={playLabel}
                              >
                                {isSnipPlaying ? '⏸' : '▶'}
                              </button>
                              <span>#{snipNumber}</span>
                              <span>{durationLabel}</span>
                              <span>
                                {formatTimecode(Math.round(segment.startMs / 1000))} → {formatTimecode(Math.round(segment.endMs / 1000))}
                              </span>
                              <button
                                type="button"
                                className="chunk-download"
                                onClick={() => void handleSnipDownload(segment, snipNumber)}
                                aria-label={`Download snip ${snipNumber}`}
                              >
                                ⬇
                              </button>
                            </li>
                          )
                        })}
                      </ul>
                    ) : (
                      <p className="detail-transcription-placeholder">No snips available yet.</p>
                    )}
                  </div>
                ) : null}
              {selectedRecording.notes ? <p className="detail-notes">{selectedRecording.notes}</p> : null}
            </div>
          </div>
        </div>
      ) : null}

        {isSettingsOpen ? (
          <div
            className="settings-overlay"
            role="dialog"
            aria-modal="true"
            aria-labelledby="settings-title"
            onClick={(event) => {
              if (event.target === event.currentTarget) {
                setIsSettingsOpen(false)
              }
            }}
          >
            <div className="settings-dialog" onClick={(event) => event.stopPropagation()}>
            <header className="settings-header">
              <h2 id="settings-title">Settings</h2>
              <button type="button" className="settings-close" onClick={() => setIsSettingsOpen(false)}>
                Close
              </button>
            </header>
            <div className="settings-body">
              <label className="settings-field">
                <span>Groq API key</span>
                <input
                  type="text"
                  value={settings?.groqApiKey ?? ''}
                  onChange={(event) => void handleGroqKeyChange(event.target.value)}
                  placeholder="sk-…"
                  autoComplete="off"
                />
              </label>
              <label className="settings-field settings-checkbox">
                <input
                  type="checkbox"
                  checked={developerMode}
                  onChange={(event) => void handleDeveloperToggle(event.target.checked)}
                />
                <span>Enable developer mode</span>
              </label>
              <label className="settings-field">
                <span>Storage cap (MB)</span>
                <input
                  type="number"
                  min={1}
                  value={Math.round(storageLimitBytes / MB)}
                  onChange={(event) => void handleStorageLimitChange(event.target.value)}
                />
              </label>
            </div>
          </div>
        </div>
      ) : null}

          {developerMode && isDeveloperOverlayOpen ? (
            <div
              className="dev-overlay"
              role="dialog"
              aria-modal="true"
              aria-labelledby="dev-console-title"
              onClick={(event) => {
                if (event.target === event.currentTarget) {
                  handleCloseDeveloperOverlay()
                }
              }}
            >
              <div className="dev-panel" onClick={(event) => event.stopPropagation()}>
              <header className="dev-panel-header">
                <h2 id="dev-console-title">Developer Console</h2>
                <button type="button" className="dev-close" onClick={handleCloseDeveloperOverlay}>
                  Close
                </button>
              </header>
              <div className="dev-panel-toolbar">
                <button
                  type="button"
                  className={developerOverlayMode === 'tables' ? 'is-selected' : ''}
                  onClick={() => {
                    setDeveloperOverlayMode('tables')
                    setDeveloperOverlayLoading(true)
                    void loadDeveloperTables().finally(() => setDeveloperOverlayLoading(false))
                  }}
                >
                  IndexedDB
                </button>
                <button
                  type="button"
                  className={developerOverlayMode === 'logs' ? 'is-selected' : ''}
                  onClick={() => {
                    setDeveloperOverlayMode('logs')
                    setDeveloperOverlayLoading(true)
                    void loadLogSessions().finally(() => setDeveloperOverlayLoading(false))
                  }}
                >
                  Logs
                </button>
              </div>
                {developerOverlayMode === 'tables' ? (
                  <div className="dev-panel-body">
                    <div className="dev-table-buttons">
                      {developerTables.map((table) => (
                        <button
                          key={table.name}
                          type="button"
                          className={selectedDeveloperTable === table.name ? 'is-selected' : ''}
                          onClick={() => setSelectedDeveloperTable(table.name)}
                        >
                          {table.name}
                          <span className="dev-table-count">{table.rows.length}</span>
                        </button>
                      ))}
                    </div>
                    <div className="dev-table-rows">
                      {developerOverlayLoading ? (
                        <p>Loading…</p>
                      ) : !selectedDeveloperTable ? (
                        <p>Select a table to inspect rows.</p>
                      ) : (
                        (() => {
                          const activeTable = developerTables.find((table) => table.name === selectedDeveloperTable)
                          if (!activeTable) return <p>No rows.</p>
                          if (activeTable.rows.length === 0) return <p>No rows.</p>

                          if (selectedDeveloperTable === 'chunks') {
                            const chunkRows = activeTable.rows as ChunkInspectionRow[]
                            return chunkRows.map((row, index) => {
                              const key = typeof row.id === 'string' ? row.id : `${row.sessionId ?? 'chunk'}-${row.seq ?? index}`
                              const blobSize = typeof row.blobSize === 'number' ? row.blobSize : null
                              const verified = typeof row.verifiedByteLength === 'number' ? row.verifiedByteLength : null
                              const blobLabel = blobSize !== null ? `${blobSize} B (${formatDataSize(blobSize)})` : 'unknown'
                              const verifiedLabel = verified !== null ? `${verified} B (${formatDataSize(verified)})` : 'unverified'
                              const mismatch = Boolean(row.sizeMismatch ?? (verified !== null && blobSize !== null && verified !== blobSize))
                              return (
                                <div key={key} className={`dev-table-chunk ${mismatch ? 'has-mismatch' : ''}`}>
                                  <pre>{JSON.stringify(row, null, 2)}</pre>
                                  <p className="dev-chunk-extra">
                                    <span>blob.size: {blobLabel}</span>
                                    <span>verified: {verifiedLabel}</span>
                                    <span className={mismatch ? 'dev-chunk-warning' : 'dev-chunk-ok'}>
                                      {mismatch ? '⚠ size mismatch' : '✓ sizes match'}
                                    </span>
                                  </p>
                                </div>
                              )
                            })
                          }

                          if (selectedDeveloperTable === 'chunkVolumes') {
                            const volumeRows = activeTable.rows as unknown as Array<
                              ChunkVolumeProfileRecord & { framesPreview?: unknown; framesTotal?: number }
                            >
                            return volumeRows.map((row, index) => {
                              const key = `${row.sessionId}-${row.chunkId}-${index}`
                              const framesTotal = row.framesTotal ?? row.frames.length
                              const averageVolume = typeof row.averageNormalized === 'number' ? row.averageNormalized : 0
                              const peakVolume = typeof row.maxNormalized === 'number' ? row.maxNormalized : 0
                              const verifiedDurationSec =
                                typeof row.durationMs === 'number' ? (row.durationMs / 1000).toFixed(2) : '0.00'
                              return (
                                <div key={key} className="dev-table-chunk">
                                  <pre>{JSON.stringify(row, null, 2)}</pre>
                                  <p className="dev-chunk-extra">
                                    <span>frames: {framesTotal}</span>
                                    <span>duration: {verifiedDurationSec}s</span>
                                    <span>avg volume: {averageVolume.toFixed(4)}</span>
                                    <span>peak volume: {peakVolume.toFixed(4)}</span>
                                  </p>
                                </div>
                              )
                            })
                          }

                          return activeTable.rows.map((row, index) => (
                            <pre key={index}>{JSON.stringify(row, null, 2)}</pre>
                          ))
                        })()
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="dev-log-body">
                    <div className="dev-log-header">
                      <button
                        type="button"
                        onClick={() => void handleLogSessionNav(-1)}
                        disabled={!selectedLogSession || logSessions.findIndex((s) => s.id === selectedLogSession.id) === logSessions.length - 1}
                      >
                        ←
                      </button>
                      <select
                        value={selectedLogSession?.id ?? ''}
                        onChange={(event) => {
                          const next = logSessions.find((session) => session.id === event.target.value) ?? null
                          void handleSelectLogSession(next)
                        }}
                      >
                        {logSessions.length === 0 ? <option value="">No sessions</option> : null}
                        {logSessions.map((session) => (
                          <option key={session.id} value={session.id}>
                            {new Date(session.startedAt).toLocaleString()}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        onClick={() => void handleLogSessionNav(1)}
                        disabled={!selectedLogSession || logSessions.findIndex((s) => s.id === selectedLogSession.id) <= 0}
                      >
                        →
                      </button>
                    </div>
                    <div className="dev-log-entries">
                      {developerOverlayLoading ? (
                        <p>Loading…</p>
                      ) : !selectedLogSession ? (
                        <p>No log sessions found.</p>
                      ) : logEntries.length === 0 ? (
                        <p>No entries for this session.</p>
                      ) : (
                        logEntries.map((entry) => (
                          <article
                            key={entry.id ?? `${entry.timestamp}`}
                            className={`dev-log-entry level-${entry.level}`}
                          >
                            <header>
                              <span className="dev-log-message">{entry.message}</span>
                              <span className="dev-log-meta">
                                <span className="dev-log-level">{entry.level.toUpperCase()}</span>
                                <time dateTime={new Date(entry.timestamp).toISOString()}>{formatLogTime(entry.timestamp)}</time>
                              </span>
                            </header>
                            {entry.details ? (
                              <code className="dev-log-details">
                                {typeof entry.details === 'string'
                                  ? entry.details
                                  : JSON.stringify(entry.details)}
                              </code>
                            ) : null}
                          </article>
                        ))
                      )}
                    </div>
                  </div>
                )}
            </div>
          </div>
        ) : null}
    </div>
  )
}

export default App
