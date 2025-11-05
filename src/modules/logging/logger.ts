import { manifestService, type LogEntryRecord, type LogSessionRecord } from '../storage/manifest'

type LogLevel = LogEntryRecord['level']

let activeSession: LogSessionRecord | null = null

export async function initializeLogger(): Promise<LogSessionRecord> {
  if (!activeSession) {
    activeSession = await manifestService.createLogSession()
    await logInfo('Logger initialised')
  }
  return activeSession
}

export async function shutdownLogger(): Promise<void> {
  if (activeSession) {
    await logInfo('Logger shutting down')
    await manifestService.finishLogSession(activeSession.id)
    activeSession = null
  }
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
