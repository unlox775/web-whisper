import { describe, it, expect, beforeEach, vi } from 'vitest'
import { PackageLogger, createPackageLogger, setAllLoggersSession } from '../src/modules/logging/package-logger'
import { manifestService } from '../src/modules/storage/manifest'
import { settingsStore } from '../src/modules/settings/store'

vi.mock('../src/modules/storage/manifest', () => ({
  manifestService: {
    appendLogEntry: vi.fn(),
    getLogEntriesInTimeRange: vi.fn(),
    getLogStorageByPackage: vi.fn(),
    purgeOldLogs: vi.fn(),
  },
}))

vi.mock('../src/modules/settings/store', () => ({
  settingsStore: {
    get: vi.fn(),
    subscribe: vi.fn(() => () => {}),
  },
}))

describe('PackageLogger', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(settingsStore.get).mockResolvedValue({
      pauseSensitivity: 0.5,
      minPauseMs: 400,
      maxPauseMs: 2600,
      windowMs: 30000,
      overlapMs: 800,
      targetBitrate: 64000,
      transcriptionOnboardingDismissed: false,
      developerMode: false,
      storageLimitBytes: 200 * 1024 * 1024,
      logLevels: {
        capture: 'info',
        storage: 'warn',
        transcription: 'off',
      },
    })
  })

  describe('lazy evaluation', () => {
    it('should NOT invoke lazy function when level is below threshold', async () => {
      const logger = createPackageLogger('storage')
      setAllLoggersSession('test-session')
      
      await new Promise(resolve => setTimeout(resolve, 10))
      
      const lazyFn = vi.fn(() => ({ message: 'expensive', details: { data: 'large' } }))
      await logger.info(lazyFn)
      
      expect(lazyFn).not.toHaveBeenCalled()
      expect(manifestService.appendLogEntry).not.toHaveBeenCalled()
    })

    it('should invoke lazy function when level permits', async () => {
      const logger = createPackageLogger('capture')
      setAllLoggersSession('test-session')
      
      await new Promise(resolve => setTimeout(resolve, 10))
      
      const lazyFn = vi.fn(() => ({ message: 'normal log', details: { foo: 'bar' } }))
      await logger.info(lazyFn)
      
      expect(lazyFn).toHaveBeenCalledTimes(1)
      expect(manifestService.appendLogEntry).toHaveBeenCalledWith(
        expect.objectContaining({
          packageId: 'capture',
          level: 'info',
          message: 'normal log',
          details: { foo: 'bar' },
        })
      )
    })

    it('should NOT invoke lazy function when logSessionId is null', async () => {
      const logger = createPackageLogger('capture')
      setAllLoggersSession(null)
      
      await new Promise(resolve => setTimeout(resolve, 10))
      
      const lazyFn = vi.fn(() => ({ message: 'should not run', details: {} }))
      await logger.info(lazyFn)
      
      expect(lazyFn).not.toHaveBeenCalled()
      expect(manifestService.appendLogEntry).not.toHaveBeenCalled()
    })

    it('should handle string messages without lazy evaluation', async () => {
      const logger = createPackageLogger('capture')
      setAllLoggersSession('test-session')
      
      await new Promise(resolve => setTimeout(resolve, 10))
      
      await logger.info('simple message')
      
      expect(manifestService.appendLogEntry).toHaveBeenCalledWith(
        expect.objectContaining({
          packageId: 'capture',
          level: 'info',
          message: 'simple message',
        })
      )
    })
  })

  describe('log levels', () => {
    it('should respect off level for transcription package', async () => {
      const logger = createPackageLogger('transcription')
      setAllLoggersSession('test-session')
      
      await new Promise(resolve => setTimeout(resolve, 10))
      
      await logger.error('should not log')
      
      expect(manifestService.appendLogEntry).not.toHaveBeenCalled()
    })

    it('should allow error through warn level', async () => {
      const logger = createPackageLogger('storage')
      setAllLoggersSession('test-session')
      
      await new Promise(resolve => setTimeout(resolve, 10))
      
      await logger.error('error message')
      
      expect(manifestService.appendLogEntry).toHaveBeenCalledWith(
        expect.objectContaining({
          level: 'error',
          message: 'error message',
        })
      )
    })

    it('should block info through warn level', async () => {
      const logger = createPackageLogger('storage')
      setAllLoggersSession('test-session')
      
      await new Promise(resolve => setTimeout(resolve, 10))
      
      await logger.info('info message')
      
      expect(manifestService.appendLogEntry).not.toHaveBeenCalled()
    })
  })
})
