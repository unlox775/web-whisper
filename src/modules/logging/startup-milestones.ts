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

/**
 * Resets the `+NNNms` clock so the next milestones measure time since this activation
 * (e.g. tab visible again after background). Does not clear the buffered logger queue.
 */
export function resetStartupMilestoneEpoch(reason?: string): void {
  const now = Date.now()
  bootT0 = now
  const msg = `${PREFIX} activation epoch reset${reason ? ` (${reason})` : ''}`
  const payload: Record<string, unknown> = {
    atMs: now,
    atIso: new Date(now).toISOString(),
    reason: reason ?? 'unspecified',
  }
  console.info(msg, payload)
  emitToLogger(msg, payload)
}

export function markStartupMilestone(label: string, details?: Record<string, unknown>): void {
  const atMs = Date.now()
  if (bootT0 === null) {
    bootT0 = atMs
  }
  const elapsedMs = atMs - bootT0
  const perfNowMs = typeof performance !== 'undefined' ? performance.now() : undefined
  const payload: Record<string, unknown> = {
    ...details,
    elapsedMs,
    atMs,
    atIso: new Date(atMs).toISOString(),
    ...(perfNowMs !== undefined ? { perfNowMs } : {}),
  }
  const msg = `${PREFIX} +${elapsedMs}ms: ${label}`
  console.info(msg, payload)
  emitToLogger(msg, payload)
}

export function markDebugPanelMilestone(label: string, details?: Record<string, unknown>): void {
  const atMs = Date.now()
  const activationMs = bootT0 !== null ? atMs - bootT0 : null
  const payload: Record<string, unknown> = {
    ...details,
    atMs,
    atIso: new Date(atMs).toISOString(),
    activationMs,
  }
  const msg = `${PREFIX} [debug] ${label}`
  console.info(msg, payload)
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
