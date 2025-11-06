import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import './App.css'
import { captureController } from './modules/capture/controller'
import {
  manifestService,
  type LogEntryRecord,
  type LogSessionRecord,
  type StoredChunk,
  type SessionRecord,
} from './modules/storage/manifest'
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

const formatSessionDateTime = (timestamp: number) =>
  new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(timestamp))

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
  const [isLoadingPlayback, setIsLoadingPlayback] = useState(false)
  const [playbackError, setPlaybackError] = useState<string | null>(null)
  const [audioState, setAudioState] = useState<AudioState>({ playing: false, duration: 0, position: 0 })
  const [selectedRecordingDurationMs, setSelectedRecordingDurationMs] = useState<number | null>(null)

  const streamCursor = useRef(1)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const audioUrlRef = useRef<string | null>(null)
  const chunkUrlMapRef = useRef<Map<string, string>>(new Map())
  const chunkAudioRef = useRef<Map<string, HTMLAudioElement>>(new Map())
  const sessionUpdatesRef = useRef<Map<string, number>>(new Map())
  const sessionsInitializedRef = useRef(false)
  const appShellRef = useRef<HTMLDivElement | null>(null)
  const sessionListRef = useRef<HTMLUListElement | null>(null)
  const touchYRef = useRef<number | null>(null)

  const developerMode = settings?.developerMode ?? false
  const storageLimitBytes = settings?.storageLimitBytes ?? DEFAULT_STORAGE_LIMIT_BYTES

  const loadSessions = useCallback(async () => {
    await manifestService.init()
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
    setBufferTotals({ totalBytes: totals.totalBytes, limitBytes: storageLimitBytes })
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
    const shell = appShellRef.current
    const list = sessionListRef.current
    if (!shell || !list) {
      return
    }

    const handleWheel = (event: WheelEvent) => {
      if (event.defaultPrevented) return
      if (!sessionListRef.current) return
      const target = event.target as HTMLElement
      if (!sessionListRef.current.contains(target)) {
        sessionListRef.current.scrollBy({ top: event.deltaY, behavior: 'auto' })
        event.preventDefault()
      }
    }

    const handleTouchStart = (event: TouchEvent) => {
      if (!sessionListRef.current) return
      const target = event.target as HTMLElement
      if (!sessionListRef.current.contains(target)) {
        touchYRef.current = event.touches[0]?.clientY ?? null
      } else {
        touchYRef.current = null
      }
    }

    const handleTouchMove = (event: TouchEvent) => {
      if (touchYRef.current == null || !sessionListRef.current) return
      const currentY = event.touches[0]?.clientY
      if (currentY == null) return
      const delta = touchYRef.current - currentY
      if (delta !== 0) {
        sessionListRef.current.scrollBy({ top: delta, behavior: 'auto' })
        touchYRef.current = currentY
        event.preventDefault()
      }
    }

    const handleTouchEnd = () => {
      touchYRef.current = null
    }

    shell.addEventListener('wheel', handleWheel, { passive: false })
    shell.addEventListener('touchstart', handleTouchStart, { passive: true })
    shell.addEventListener('touchmove', handleTouchMove, { passive: false })
    shell.addEventListener('touchend', handleTouchEnd)
    shell.addEventListener('touchcancel', handleTouchEnd)

    return () => {
      shell.removeEventListener('wheel', handleWheel as EventListener)
      shell.removeEventListener('touchstart', handleTouchStart as EventListener)
      shell.removeEventListener('touchmove', handleTouchMove as EventListener)
      shell.removeEventListener('touchend', handleTouchEnd as EventListener)
      shell.removeEventListener('touchcancel', handleTouchEnd as EventListener)
    }
  }, [])

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
    const audioMap = chunkAudioRef.current
    const currentIds = new Set(chunkData.map((chunk) => chunk.id))

    Array.from(urlMap.entries()).forEach(([id, url]) => {
      if (!currentIds.has(id)) {
        URL.revokeObjectURL(url)
        urlMap.delete(id)
      }
    })

    audioMap.forEach((audio, id) => {
      if (!currentIds.has(id)) {
        audio.pause()
        audioMap.delete(id)
      }
    })

    setChunkPlayingId((prev) => (prev && currentIds.has(prev) ? prev : null))
  }, [chunkData])

  useEffect(() => {
    return () => {
      chunkAudioRef.current.forEach((audio) => audio.pause())
      chunkAudioRef.current.clear()
      chunkUrlMapRef.current.forEach((url) => URL.revokeObjectURL(url))
      chunkUrlMapRef.current.clear()
    }
  }, [])

  useEffect(() => {
    if (!debugDetailsOpen) {
      chunkAudioRef.current.forEach((audio) => audio.pause())
      chunkAudioRef.current.clear()
      setChunkPlayingId(null)
    }
  }, [debugDetailsOpen])

  useEffect(() => {
    const mainAudio = audioRef.current
    if (mainAudio) {
      mainAudio.volume = playbackVolume
    }
    chunkAudioRef.current.forEach((audio) => {
      audio.volume = playbackVolume
    })
  }, [playbackVolume])

  useEffect(() => {
    if (!developerMode) {
      setDeveloperOverlayOpen(false)
      setDebugDetailsOpen(false)
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

    const isHeaderSegment = useCallback((chunk: StoredChunk) => {
      const durationMs = Math.max(0, chunk.endMs - chunk.startMs)
      return chunk.seq === 0 && (durationMs <= 10 || chunk.byteLength < 4096)
    }, [])

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
        const link = document.createElement('a')
        link.href = url
        link.download = `${iso}_chunk-${seqLabel}.mp4`
        link.rel = 'noopener'
        document.body.appendChild(link)
        link.click()
        document.body.removeChild(link)
      },
      [ensureChunkPlaybackUrl, selectedRecording?.startedAt],
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
    chunkAudioRef.current.forEach((audio) => audio.pause())
    chunkAudioRef.current.clear()
    chunkUrlMapRef.current.forEach((url) => URL.revokeObjectURL(url))
    chunkUrlMapRef.current.clear()
    setChunkPlayingId(null)
    setVolumeSliderOpen(false)
    setSelectedRecordingId(null)
    setChunkData([])
    setSelectedRecordingDurationMs(null)
    setDebugDetailsOpen(false)
    setPlaybackError(null)
    setAudioState({ playing: false, duration: 0, position: 0 })
    if (selectedRecordingId) {
      await logInfo('Detail view closed', { sessionId: selectedRecordingId })
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
        const audioMap = chunkAudioRef.current
        const existingAudio = audioMap.get(id)

        if (chunkPlayingId === id) {
          existingAudio?.pause()
          if (existingAudio) {
            existingAudio.currentTime = 0
            audioMap.delete(id)
          }
          setChunkPlayingId(null)
          return
        }

        audioMap.forEach((audio, audioId) => {
          audio.pause()
          audio.currentTime = 0
          if (audioId !== id) {
            audioMap.delete(audioId)
          }
        })

        const url = ensureChunkPlaybackUrl(chunk)
        if (!url) {
          console.error('[UI] Missing chunk URL for playback', id)
          return
        }

        const audio = existingAudio ?? new Audio()
        if (audio.src !== url) {
          audio.src = url
        }
        audio.volume = playbackVolume
        audioMap.set(id, audio)
        audio.currentTime = 0
        try {
          await audio.play()
          setChunkPlayingId(id)
          audio.onended = () => {
            setChunkPlayingId((prev) => (prev === id ? null : prev))
            audioMap.delete(id)
          }
        } catch (error) {
          console.error('[UI] Failed to play chunk', error)
          audioMap.delete(id)
        }
      },
      [chunkPlayingId, ensureChunkPlaybackUrl, playbackVolume],
    )

    const loadDeveloperTables = useCallback(async () => {
      try {
        const [sessions, chunks] = await Promise.all([
          manifestService.listSessions(),
          manifestService.getChunksForInspection(),
        ])
        setDeveloperTables([
          { name: 'sessions', rows: sessions.map((row) => ({ ...row })) },
          { name: 'chunks', rows: chunks.map((row) => ({ ...row })) },
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
      <div className="app-shell" ref={appShellRef}>
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
              <ul className="session-list" ref={sessionListRef}>
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
                  {formatClock(selectedRecording.updatedAt)}
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
                <div className="detail-transcription">
                  <h3>Transcription</h3>
                  <p className="detail-transcription-placeholder">Not yet implemented — will stream from Groq once wired.</p>
                </div>
                {developerMode && debugDetailsOpen ? (
                  <div className="detail-chunks">
                    <h3>
                      Chunks ({playableChunkCount}{headerChunk ? ' + init' : ''}) · {selectedRecording.mimeType ?? 'pending'}
                    </h3>
                    {chunkData.length === 0 ? (
                      <p className="detail-transcription-placeholder">No chunks persisted yet.</p>
                    ) : (
                      <ul className="chunk-list">
                        {chunkData.map((chunk) => {
                          const durationSeconds = Math.max(0, (chunk.endMs - chunk.startMs) / 1000)
                          const decimalPlaces = durationSeconds < 10 ? 2 : 1
                          const durationLabel = `${durationSeconds.toFixed(decimalPlaces)} s`
                          const header = isHeaderSegment(chunk)
                          return (
                            <li key={chunk.id} className={`chunk-item ${header ? 'header-chunk' : ''}`}>
                              <button
                                type="button"
                                className={`chunk-play ${chunkPlayingId === chunk.id ? 'is-playing' : ''}`}
                                onClick={() => void handleChunkPlayToggle(chunk)}
                                aria-pressed={chunkPlayingId === chunk.id}
                                aria-label={chunkPlayingId === chunk.id ? `Pause chunk ${chunk.seq + 1}` : `Play chunk ${chunk.seq + 1}`}
                              >
                                {chunkPlayingId === chunk.id ? '⏸' : '▶'}
                              </button>
                              <span>#{chunk.seq + 1}</span>
                              <span>{durationLabel}</span>
                              <span>{formatDataSize(chunk.byteLength)}</span>
                              <button
                                type="button"
                                className="chunk-download"
                                onClick={() => handleChunkDownload(chunk)}
                                aria-label={`Download chunk ${chunk.seq + 1}`}
                              >
                                ⬇
                              </button>
                              {header ? <span className="chunk-flag">init segment</span> : null}
                            </li>
                          )
                        })}
                      </ul>
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
