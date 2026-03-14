/**
 * Startup milestone logger. Emits to both console (for export) and the main logger
 * when available. Use to trace where time is spent during page load and debug panel load.
 * Prefix: [startup] so logs are easy to grep and export.
 * Uses dynamic import for logInfo to avoid circular dependency (manifest → startup-milestones → logger → manifest).
 */

const PREFIX = '[startup]'

let bootT0: number | null = null

function emitToLogger(msg: string, payload: Record<string, unknown>): void {
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
