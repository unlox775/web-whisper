import { logInfo, logWarn } from '../logging/logger'

type WakeLockRequestor = {
  request: (type: 'screen') => Promise<WakeLockSentinel>
}

const wakeLockState = {
  desiredActive: false,
  sentinel: null as WakeLockSentinel | null,
  pending: false,
  supportLogged: false,
  listenersAttached: false,
}

const getVisibilityState = (): string =>
  typeof document === 'undefined' ? 'unknown' : document.visibilityState ?? 'unknown'

const getWakeLockRequestor = (): WakeLockRequestor | null => {
  if (typeof navigator === 'undefined') return null
  const wakeLock = navigator.wakeLock as WakeLockRequestor | undefined
  if (!wakeLock || typeof wakeLock.request !== 'function') return null
  return wakeLock
}

const requestWakeLock = async (reason: string): Promise<void> => {
  if (!wakeLockState.desiredActive || wakeLockState.pending || wakeLockState.sentinel) return
  const wakeLock = getWakeLockRequestor()
  if (!wakeLock) {
    if (!wakeLockState.supportLogged) {
      wakeLockState.supportLogged = true
      await logWarn('Wake Lock API unavailable; screen may sleep during recording', {
        reason,
        userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown',
      })
    }
    return
  }
  if (typeof document !== 'undefined' && document.visibilityState !== 'visible') {
    await logInfo('Wake lock request deferred until page is visible', {
      reason,
      visibility: getVisibilityState(),
    })
    return
  }
  wakeLockState.pending = true
  try {
    const sentinel = await wakeLock.request('screen')
    wakeLockState.sentinel = sentinel
    sentinel.addEventListener('release', () => {
      wakeLockState.sentinel = null
      if (wakeLockState.desiredActive) {
        void logWarn('Wake lock released unexpectedly; retrying', {
          visibility: getVisibilityState(),
        })
        void requestWakeLock('released')
      }
    })
    await logInfo('Wake lock acquired for recording', { reason })
  } catch (error) {
    await logWarn('Wake lock request failed', {
      reason,
      visibility: getVisibilityState(),
      error: error instanceof Error ? error.message : String(error),
    })
  } finally {
    wakeLockState.pending = false
  }
}

const releaseWakeLock = async (reason: string): Promise<void> => {
  const sentinel = wakeLockState.sentinel
  if (!sentinel) return
  wakeLockState.sentinel = null
  try {
    if (!sentinel.released) {
      await sentinel.release()
    }
    await logInfo('Wake lock released after recording', { reason })
  } catch (error) {
    await logWarn('Wake lock release failed', {
      reason,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

export const initializeRecordingWakeLock = (): void => {
  if (wakeLockState.listenersAttached || typeof document === 'undefined') return
  wakeLockState.listenersAttached = true
  document.addEventListener('visibilitychange', () => {
    if (!wakeLockState.desiredActive) return
    if (document.visibilityState === 'visible') {
      void requestWakeLock('visibilitychange')
    }
  })
}

export const setRecordingWakeLockActive = async (active: boolean, reason: string): Promise<void> => {
  wakeLockState.desiredActive = active
  if (active) {
    await requestWakeLock(reason)
    return
  }
  await releaseWakeLock(reason)
}
