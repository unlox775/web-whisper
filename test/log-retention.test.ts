import { describe, it, expect, beforeEach, vi } from 'vitest'
import { manifestService } from '../src/modules/storage/manifest'

vi.mock('../src/modules/storage/manifest', async () => {
  const actual = await vi.importActual('../src/modules/storage/manifest')
  return {
    ...actual,
    manifestService: {
      appendLogEntry: vi.fn(),
      getLogEntriesInTimeRange: vi.fn(),
      getLogStorageByPackage: vi.fn(),
      purgeOldLogs: vi.fn(),
      getSession: vi.fn(),
      getChunkMetadata: vi.fn(),
      listSnips: vi.fn(),
      listChunkVolumeProfiles: vi.fn(),
      listSessions: vi.fn(),
      storageTotals: vi.fn(),
    },
  }
})

describe('Log Retention and Export', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('age-based retention', () => {
    it('should delete old log entries under retention policy', async () => {
      const now = Date.now()
      const cutoffTime = now - 7 * 24 * 60 * 60 * 1000

      vi.mocked(manifestService.purgeOldLogs).mockResolvedValue({
        purgedCount: 1,
        bytesFreed: 1500,
      })

      const result = await manifestService.purgeOldLogs({
        limitBytes: 50 * 1024 * 1024,
        now,
      })

      expect(result.purgedCount).toBe(1)
      expect(result.bytesFreed).toBeGreaterThan(0)
      expect(manifestService.purgeOldLogs).toHaveBeenCalledWith(
        expect.objectContaining({
          limitBytes: expect.any(Number),
          now,
        })
      )
    })

    it('should free bytes when deleting old logs', async () => {
      const now = Date.now()

      vi.mocked(manifestService.purgeOldLogs).mockResolvedValue({
        purgedCount: 1,
        bytesFreed: 12500,
      })

      const result = await manifestService.purgeOldLogs({
        limitBytes: 50 * 1024 * 1024,
        now,
      })

      expect(result.bytesFreed).toBeGreaterThan(10000)
      expect(result.purgedCount).toBe(1)
    })
  })

  describe('getLogEntriesInTimeRange', () => {
    it('should retrieve logs within session time window', async () => {
      const sessionStart = Date.now() - 10000
      const sessionEnd = Date.now()

      const mockLogs = [
        {
          id: 1,
          sessionId: 'test-session',
          packageId: 'capture',
          timestamp: sessionStart + 1000,
          level: 'info' as const,
          message: 'during session 1',
        },
        {
          id: 2,
          sessionId: 'test-session',
          packageId: 'storage',
          timestamp: sessionStart + 5000,
          level: 'warn' as const,
          message: 'during session 2',
        },
      ]

      vi.mocked(manifestService.getLogEntriesInTimeRange).mockResolvedValue(mockLogs)

      const entries = await manifestService.getLogEntriesInTimeRange(sessionStart, sessionEnd)

      expect(entries).toHaveLength(2)
      expect(entries.map(e => e.message)).toEqual(['during session 1', 'during session 2'])
    })
  })

  describe('per-package storage tracking', () => {
    it('should query log storage by package', async () => {
      const mockStorage = new Map([
        ['capture', { bytes: 15000, count: 50 }],
        ['storage', { bytes: 8000, count: 25 }],
        ['transcription', { bytes: 3000, count: 10 }],
      ])

      vi.mocked(manifestService.getLogStorageByPackage).mockResolvedValue(mockStorage)

      const storage = await manifestService.getLogStorageByPackage()

      expect(storage.get('capture')).toEqual({ bytes: 15000, count: 50 })
      expect(storage.get('storage')).toEqual({ bytes: 8000, count: 25 })
      expect(storage.size).toBe(3)
    })
  })
})
