import { manifestService, type LogEntryRecord, type LogSessionRecord } from '../storage/manifest'

type LogLevel = LogEntryRecord['level']

export interface GlobalErrorEntry {
  timestamp: number
  type: 'error' | 'unhandledrejection' | 'resource'
  message: string
  stack?: string
  filename?: string
  lineno?: number
  colno?: number
  reason?: string
  target?: string
}

const GLOBAL_ERROR_BUFFER_LIMIT = 120
const globalErrorBuffer: GlobalErrorEntry[] = []
let globalErrorCaptureActive = false
let globalErrorCleanup: (() => void) | null = null

let activeSession: LogSessionRecord | null = null

export async function initializeLogger(): Promise<LogSessionRecord> {
  if (!activeSession) {
    activeSession = await manifestService.createLogSession()
    await logInfo('Logger initialised')
  }
  startGlobalErrorCapture()
  return activeSession
}

export async function shutdownLogger(): Promise<void> {
  if (activeSession) {
    await logInfo('Logger shutting down')
    await manifestService.finishLogSession(activeSession.id)
    activeSession = null
  }
  stopGlobalErrorCapture()
}

export async function log(level: LogLevel, message: string, details?: Record<string, unknown>): Promise<void> {
  if (!activeSession) return
  try {
    await manifestService.appendLogEntry({
      sessionId: activeSession.id,
      timestamp: Date.now(),
      level,
      message,
      details,
    })
  } catch (error) {
    console.warn('[Logger] Failed to persist log entry', error)
  }
}

export function logDebug(message: string, details?: Record<string, unknown>): Promise<void> {
  return log('debug', message, details)
}

export function logInfo(message: string, details?: Record<string, unknown>): Promise<void> {
  return log('info', message, details)
}

export function logWarn(message: string, details?: Record<string, unknown>): Promise<void> {
  return log('warn', message, details)
}

export function logError(message: string, details?: Record<string, unknown>): Promise<void> {
  return log('error', message, details)
}

export function getActiveLogSession(): LogSessionRecord | null {
  return activeSession
}

const describeTarget = (target: EventTarget | null): string => {
  if (!target) return 'unknown'
  if (target instanceof HTMLElement) {
    let label = target.tagName.toLowerCase()
    if (target.id) {
      label += `#${target.id}`
    } else if (target.classList.length > 0) {
      label += `.${target.classList[0]}`
    }
    const withSrc = target as HTMLElement & { src?: string; href?: string }
    if (withSrc.src) {
      label += ` src=${withSrc.src}`
    } else if (withSrc.href) {
      label += ` href=${withSrc.href}`
    }
    return label
  }
  return target.constructor?.name ?? 'unknown'
}

const pushGlobalError = (entry: GlobalErrorEntry) => {
  globalErrorBuffer.push(entry)
  if (globalErrorBuffer.length > GLOBAL_ERROR_BUFFER_LIMIT) {
    globalErrorBuffer.splice(0, globalErrorBuffer.length - GLOBAL_ERROR_BUFFER_LIMIT)
  }
}

export function startGlobalErrorCapture(): void {
  if (globalErrorCaptureActive) return
  if (typeof window === 'undefined') return
  globalErrorCaptureActive = true

  const onError = (event: Event) => {
    const timestamp = Date.now()
    if (event instanceof ErrorEvent) {
      pushGlobalError({
        timestamp,
        type: 'error',
        message: event.message || 'Uncaught error',
        stack: event.error instanceof Error ? event.error.stack : undefined,
        filename: event.filename || undefined,
        lineno: event.lineno || undefined,
        colno: event.colno || undefined,
      })
      return
    }
    pushGlobalError({
      timestamp,
      type: 'resource',
      message: 'Resource error',
      target: describeTarget(event.target),
    })
  }

  const onUnhandledRejection = (event: PromiseRejectionEvent) => {
    const timestamp = Date.now()
    const reason = event.reason
    const message = reason instanceof Error ? reason.message : String(reason)
    pushGlobalError({
      timestamp,
      type: 'unhandledrejection',
      message: message || 'Unhandled promise rejection',
      stack: reason instanceof Error ? reason.stack : undefined,
      reason: reason instanceof Error ? undefined : String(reason),
    })
  }

  window.addEventListener('error', onError, true)
  window.addEventListener('unhandledrejection', onUnhandledRejection)

  globalErrorCleanup = () => {
    window.removeEventListener('error', onError, true)
    window.removeEventListener('unhandledrejection', onUnhandledRejection)
  }
}

export function stopGlobalErrorCapture(): void {
  if (!globalErrorCaptureActive) return
  globalErrorCleanup?.()
  globalErrorCleanup = null
  globalErrorCaptureActive = false
}

export function getGlobalErrorsSince(since: number): GlobalErrorEntry[] {
  if (!Number.isFinite(since)) return []
  return globalErrorBuffer.filter((entry) => entry.timestamp >= since)
}

export async function logGlobalErrorsSince(
  since: number | null,
  context: Record<string, unknown> = {},
): Promise<void> {
  if (!since || !Number.isFinite(since)) {
    await logInfo('Global error snapshot skipped (missing timestamp)', context)
    return
  }
  const entries = getGlobalErrorsSince(since)
  const payload = {
    ...context,
    since,
    capturedCount: entries.length,
    bufferSize: globalErrorBuffer.length,
    entries: entries.slice(-20),
  }
  if (entries.length === 0) {
    await logInfo('No global errors captured during recording start window', payload)
    return
  }
  await logWarn('Global errors captured during recording start window', payload)
}
