/**
 * Startup milestone logger. Emits to console immediately and buffers for the persisted
 * logger (which isn't ready until after DB init). Call flushStartupMilestonesToLogger()
 * once the logger is ready so buffered milestones appear in the Logs tab.
 * Prefix: [startup] so logs are easy to grep and export.
 */

const PREFIX = '[startup]'

let bootT0: number | null = null

type BufferedMilestone = { msg: string; payload: Record<string, unknown> }
const buffer: BufferedMilestone[] = []
let loggerReady = false

function emitToLogger(msg: string, payload: Record<string, unknown>): void {
  if (!loggerReady) {
    buffer.push({ msg, payload })
    return
  }
  import('./logger').then(({ logInfo }) => {
    void logInfo(msg, payload)
  }).catch(() => {})
}

export function markStartupMilestone(label: string, details?: Record<string, unknown>): void {
  const now = Date.now()
  if (bootT0 === null) {
    bootT0 = now
  }
  const elapsedMs = now - bootT0
  const payload = { elapsedMs, ...details }
  const msg = `${PREFIX} +${elapsedMs}ms: ${label}`
  console.info(msg, details ?? '')
  emitToLogger(msg, payload)
}

export function markDebugPanelMilestone(label: string, details?: Record<string, unknown>): void {
  const now = Date.now()
  const payload = { ...details, at: now }
  const msg = `${PREFIX} [debug] ${label}`
  console.info(msg, details ?? '')
  emitToLogger(msg, payload)
}

/** Call once the logger has an active session. Flushes buffered milestones so they show in the Logs tab. */
export async function flushStartupMilestonesToLogger(): Promise<void> {
  loggerReady = true
  if (buffer.length === 0) return
  const { logInfo } = await import('./logger')
  const toFlush = buffer.splice(0)
  for (const { msg, payload } of toFlush) {
    await logInfo(msg, payload)
  }
}
