import { manifestService } from '../storage/manifest'
import { settingsStore, type LogLevel } from '../settings/store'

type LogPayload = { message: string; details?: Record<string, unknown> }
type LazyPayload = () => LogPayload

const logLevelOrder: Record<LogLevel, number> = {
  off: 0,
  error: 1,
  warn: 2,
  info: 3,
  debug: 4,
}

export class PackageLogger {
  private packageId: string
  private logSessionId: string | null = null
  private levelCache: Record<string, number> = {}

  constructor(packageId: string, logSessionId: string | null = null) {
    this.packageId = packageId
    this.logSessionId = logSessionId
    this.loadLevelCache()
    
    settingsStore.subscribe((settings) => {
      this.levelCache = {}
      Object.entries(settings.logLevels).forEach(([pkg, level]) => {
        this.levelCache[pkg] = logLevelOrder[level] || 0
      })
    })
  }

  private loadLevelCache(): void {
    settingsStore.get().then((settings) => {
      this.levelCache = {}
      Object.entries(settings.logLevels).forEach(([pkg, level]) => {
        this.levelCache[pkg] = logLevelOrder[level] || 0
      })
    })
  }

  setLogSession(sessionId: string | null): void {
    this.logSessionId = sessionId
  }

  private shouldLog(level: LogLevel): boolean {
    const configuredLevel = this.levelCache[this.packageId] ?? logLevelOrder.info
    const requestedLevel = logLevelOrder[level]
    return requestedLevel <= configuredLevel
  }

  private async log(level: Exclude<LogLevel, 'off'>, payload: string | LazyPayload): Promise<void> {
    if (!this.shouldLog(level)) {
      return
    }

    const resolved: LogPayload = typeof payload === 'string' 
      ? { message: payload } 
      : payload()

    if (!this.logSessionId) {
      return
    }

    try {
      await manifestService.appendLogEntry({
        sessionId: this.logSessionId,
        packageId: this.packageId,
        timestamp: Date.now(),
        level,
        message: resolved.message,
        details: resolved.details,
      })
    } catch (error) {
      console.warn(`[PackageLogger:${this.packageId}] Failed to persist log entry`, error)
    }
  }

  async debug(messageOrFn: string | LazyPayload): Promise<void> {
    return this.log('debug', messageOrFn)
  }

  async info(messageOrFn: string | LazyPayload): Promise<void> {
    return this.log('info', messageOrFn)
  }

  async warn(messageOrFn: string | LazyPayload): Promise<void> {
    return this.log('warn', messageOrFn)
  }

  async error(messageOrFn: string | LazyPayload): Promise<void> {
    return this.log('error', messageOrFn)
  }
}

const loggers = new Map<string, PackageLogger>()

export function createPackageLogger(packageId: string): PackageLogger {
  if (!loggers.has(packageId)) {
    loggers.set(packageId, new PackageLogger(packageId))
  }
  return loggers.get(packageId)!
}

export function setAllLoggersSession(sessionId: string | null): void {
  loggers.forEach((logger) => logger.setLogSession(sessionId))
}
