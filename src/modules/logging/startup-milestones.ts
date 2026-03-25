/**
 * Startup milestone logger. Emits to console immediately and buffers for the persisted
 * logger (which isn't ready until after DB init). Call flushStartupMilestonesToLogger()
 * once the logger has an active session.
 *
 * Log lines are **human-first**: seconds since **page navigation** (performance.now),
 * plain English, then the stable technical id (for grep / code search).
 * `elapsedMs` in the payload is ms since last **visibility epoch reset** — can jump when
 * the tab was backgrounded; use `navSec` / `atIso` for real order.
 */

const PREFIX = '[startup]'
const DEBUG_PREFIX = '[startup] [debug]'

let bootT0: number | null = null

type BufferedMilestone = { msg: string; payload: Record<string, unknown> }
const buffer: BufferedMilestone[] = []
let loggerReady = false

/** Stable technical key → short phrase a new user can read. Technical id repeated at end of line. */
const STARTUP_MILESTONE_HUMAN: Record<string, string> = {
  'main.tsx: first execution': 'The very first line of app code on this page has run',
  'main.tsx: registerSW called': 'Offline/update service worker hook is registered',
  'manifest: getDB openDB start': 'Opening your local Web Whisper database',
  'manifest: getDB openDB done': 'Local database is open and ready',
  'App: useEffect mount (first render done)': 'React has mounted — first UI paint pass ran',
  'App: initializeLogger start': 'Starting the log writer so events can be saved',
  'App: initializeLogger done': 'Log writer is ready; buffered startup lines will flush to disk',
  'App: initializeRecordingWakeLock': 'Screen wake-lock for recording is wired up',
  'App: reconcileDanglingSessions start': 'Checking for recordings left in a bad half-saved state',
  'App: reconcileDanglingSessions done': 'Half-saved recording check finished',
  'App: settings hydrated': 'Saved settings (storage limit, keys, etc.) are loaded',
  'loadSessions: start': 'Loading your recordings list from storage',
  'loadSessions: manifest init await started': 'About to call manifest init (opens DB if needed)',
  'loadSessions: manifest init done': 'Storage is ready before reading sessions',
  'loadSessions: about to await listSessions()':
    'About to call listSessions (nested logs show getAll + sort inside)',
  'manifest: init: entry': 'Inside manifest.init — first line',
  'manifest: init: after getDB await': 'manifest.init: getDB promise resolved',
  'manifest: init: before return': 'manifest.init finished after DB is ready',
  'manifest: listSessions: entry': 'Inside listSessions — first line',
  'manifest: listSessions: after getDB': 'listSessions got DB handle',
  'manifest: listSessions: before getAll(sessions)': 'About to IndexedDB getAll(sessions)',
  'manifest: listSessions: after getAll(sessions)': 'getAll(sessions) returned',
  'manifest: listSessions: map done': 'listSessions: spread + timingStatus map (sync)',
  'manifest: listSessions: sort done': 'listSessions: sort by startedAt (sync)',
  'manifest: listSessions: before return': 'listSessions: returning array to caller',
  'manifest: listSnipsForSessions: entry': 'listSnipsForSessions: first line',
  'manifest: listSnipsForSessions: empty ids, return': 'listSnipsForSessions: no session ids, skip',
  'manifest: listSnipsForSessions: after getDB': 'listSnipsForSessions: DB handle ready',
  'manifest: listSnipsForSessions: before readonly tx + getAll': 'listSnipsForSessions: about to snips readonly tx',
  'manifest: listSnipsForSessions: after IDB getAll+tx.done': 'listSnipsForSessions: IDB getAll per session done',
  'manifest: listSnipsForSessions: after normalize+sort': 'listSnipsForSessions: normalizeSnipRecord + sort (sync)',
  'manifest: listSnipsForSessions: before return': 'listSnipsForSessions: returning Map',
  'loadSessions: listSessions done': 'Back in loadSessions after listSessions returned',
  'loadSessions: before SessionAnalysisProvider ref': 'About to resolve SessionAnalysisProvider',
  'loadSessions: SessionAnalysisProvider ref ready': 'SessionAnalysisProvider instance ready',
  'loadSessions: sessionBytesSum done': 'Added up storage bytes from session metadata',
  'loadSessions: before highlight scan': 'Scanning sessions for updated highlight',
  'loadSessions: highlight scan done': 'Highlight scan finished',
  'loadSessions: sessionUpdatesRef map built': 'Built session id → updatedAt map',
  'loadSessions: first sessions init flag': 'First time sessions list initialized',
  'loadSessions: setHighlightedSessionId queued': 'Queued highlight for updated session',
  'loadSessions: no highlight update': 'No highlight change',
  'loadSessions: before setBufferTotals': 'About to queue buffer/Data meter state',
  'loadSessions: scheduling refreshTranscriptionPreviews (async)': 'Fired refreshTranscriptionPreviews (not awaited)',
  'loadSessions: returned after scheduling previews (sync part done)': 'loadSessions sync continuation after scheduling previews',
  'loadSessions: before timing verification filter': 'Filtering sessions needing timing verification',
  'loadSessions: timing verification filter done': 'Timing verification filter done',
  'loadSessions: ensureTimings scheduled for sessions': 'ensureTimings queued per session',
  'loadSessions: try path complete': 'loadSessions try block finished',
  'loadSessions: before setRecordings': 'About to hand the session array to the UI',
  'loadSessions: setRecordings done, recordings list visible': 'Sidebar list should show your recordings now',
  'loadSessions: bufferTotals queued': 'Updating the Data meter at the top with totals',
  'refreshTranscriptionPreviews: entered': 'refreshTranscriptionPreviews: function entered',
  'refreshTranscriptionPreviews: derived activeIds + readySessions + chunkTotal':
    'Computed ready sessions and preview chunk plan',
  'refreshTranscriptionPreviews: no ready chunks, clear sync line': 'No ready sessions; cleared sync banner',
  'refreshTranscriptionPreviews: set sync line for preview batches': 'Set sync banner for preview loading',
  'refreshTranscriptionPreviews: setTranscriptionPreviews prune queued': 'Queued prune of stale previews',
  'refreshTranscriptionPreviews: setTranscriptionErrorCounts prune queued': 'Queued prune of error counts',
  'refreshTranscriptionPreviews: setTranscriptionSnipCounts prune queued': 'Queued prune of snip counts',
  'refreshTranscriptionPreviews: chunk loop iteration start': 'Preview chunk loop: iteration start',
  'refreshTranscriptionPreviews: before await listSnipsForSessions': 'About to await listSnipsForSessions',
  'refreshTranscriptionPreviews: after await listSnipsForSessions': 'listSnipsForSessions await returned',
  'refreshTranscriptionPreviews: chunk React setState batch queued': 'Queued React updates for this chunk',
  'refreshTranscriptionPreviews: chunk after setTimeout(0) yield': 'After yield to browser',
  'refreshTranscriptionPreviews: all chunk loops finished': 'All preview chunks processed',
  'refreshTranscriptionPreviews: trim previews to activeIds queued': 'Trimmed preview map to active sessions',
  'refreshTranscriptionPreviews: trim error counts queued': 'Trimmed error count map',
  'refreshTranscriptionPreviews: trim snip counts queued': 'Trimmed snip count map',
  'refreshTranscriptionPreviews: start': 'Starting to load text snippets for the list',
  'refreshTranscriptionPreviews: chunk applied': 'Loaded another batch of transcription snippets',
  'refreshTranscriptionPreviews: all chunks read': 'All snippet batches read from the database',
  'refreshTranscriptionPreviews: done': 'List snippet loading is complete',
  'refreshTranscriptionPreviews: error': 'List snippet loading failed',
  'preparePlaybackSource: start': 'Loading full audio for the recording you opened',
  'preparePlaybackSource: getChunkData done': 'All audio pieces for this recording are in memory',
  'preparePlaybackSource: blob built': 'Playback file is stitched; the player can start',
}

const DEBUG_MILESTONE_HUMAN: Record<string, string> = {
  'handleOpenDeveloperOverlay: open': 'Developer panel opened',
  'loadDeveloperTableCounts: start': 'Counting rows in each database table',
  'loadDeveloperTableCounts: done': 'Table row counts finished',
  'loadDeveloperTablePage: start': 'Loading one table page for the dev panel',
  'loadDeveloperTablePage: done': 'Table page load finished',
  'loadDeveloperTablePage: append': 'Loading more rows for the dev table',
  'loadLogSessions: start': 'Loading your saved log sessions list',
  'loadLogSessions: listLogSessions done': 'Log session list read from storage',
  'loadLogSessions: done': 'Log tab data is ready',
}

function humanLineForStartup(label: string, details?: Record<string, unknown>): string {
  let base = STARTUP_MILESTONE_HUMAN[label] ?? label
  if (label === 'refreshTranscriptionPreviews: chunk applied' && details) {
    const i = details.chunkIndex
    const n = details.chunkTotal
    if (typeof i === 'number' && typeof n === 'number') {
      base = `${base} (batch ${i} of ${n})`
    }
  }
  return base
}

function humanLineForDebug(label: string): string {
  return DEBUG_MILESTONE_HUMAN[label] ?? label
}

function navSecondsSincePageLoad(): number {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return Math.round((performance.now() / 100)) / 10
  }
  return 0
}

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
 * Resets the `elapsedMs` clock so the next milestones measure time since this activation
 * (e.g. tab visible again after background). Does not clear the buffered logger queue.
 */
export function resetStartupMilestoneEpoch(reason?: string): void {
  const now = Date.now()
  bootT0 = now
  const navSec = navSecondsSincePageLoad()
  const msg = `${PREFIX} t=${navSec.toFixed(1)}s — Tab woke up or came back from cache; “+ms” counters reset for the next stretch — activation epoch reset`
  const payload: Record<string, unknown> = {
    atMs: now,
    atIso: new Date(now).toISOString(),
    navSec,
    reason: reason ?? 'unspecified',
    technical: 'resetStartupMilestoneEpoch',
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
  const navSec = navSecondsSincePageLoad()
  const perfNowMs = typeof performance !== 'undefined' ? performance.now() : undefined
  const human = humanLineForStartup(label, details)
  const msg = `${PREFIX} t=${navSec.toFixed(1)}s — ${human} — ${label}`
  const payload: Record<string, unknown> = {
    ...details,
    navSec,
    elapsedMs,
    atMs,
    atIso: new Date(atMs).toISOString(),
    ...(perfNowMs !== undefined ? { perfNowMs } : {}),
    technical: label,
  }
  console.info(msg, payload)
  emitToLogger(msg, payload)
}

export function markDebugPanelMilestone(label: string, details?: Record<string, unknown>): void {
  const atMs = Date.now()
  const activationMs = bootT0 !== null ? atMs - bootT0 : null
  const navSec = navSecondsSincePageLoad()
  const human = humanLineForDebug(label)
  const msg = `${DEBUG_PREFIX} t=${navSec.toFixed(1)}s — ${human} — ${label}`
  const payload: Record<string, unknown> = {
    ...details,
    navSec,
    atMs,
    atIso: new Date(atMs).toISOString(),
    activationMs,
    technical: label,
  }
  console.info(msg, payload)
  emitToLogger(msg, payload)
}

/** Call once the logger has an active session. Flushes buffered milestones in true time order. */
export async function flushStartupMilestonesToLogger(): Promise<void> {
  loggerReady = true
  if (buffer.length === 0) return
  const { logInfo } = await import('./logger')
  const toFlush = buffer.splice(0)
  toFlush.sort((a, b) => {
    const am = typeof a.payload.atMs === 'number' ? a.payload.atMs : 0
    const bm = typeof b.payload.atMs === 'number' ? b.payload.atMs : 0
    return am - bm
  })
  for (const { msg, payload } of toFlush) {
    await logInfo(msg, payload)
  }
}
