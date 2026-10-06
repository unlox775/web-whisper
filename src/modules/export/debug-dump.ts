import { manifestService } from '../storage/manifest'
import { settingsStore } from '../settings/store'

export interface DebugDumpData {
  manifest: {
    session: unknown
    chunks: unknown[]
  }
  snips: unknown[]
  transcripts: Array<{ snipId: string; transcription: unknown }>
  volumeProfile: unknown[]
  logs: unknown[]
  settings: {
    storageLimitBytes: number
    logLevels: Record<string, string>
  }
  storageSummary: {
    totalSessionCount: number
    totalChunkBytes: number
    logStorageByPackage: Record<string, { bytes: number; count: number }>
  }
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.style.display = 'none'
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

export async function createDebugDump(sessionId: string): Promise<void> {
  const session = await manifestService.getSession(sessionId)
  if (!session) {
    throw new Error(`Session ${sessionId} not found`)
  }

  const settings = await settingsStore.get()
  const chunks = await manifestService.getChunkMetadata(sessionId)
  const snips = await manifestService.listSnips(sessionId)
  const volumeProfiles = await manifestService.listChunkVolumeProfiles(sessionId)
  const sessions = await manifestService.listSessions()
  const storageTotals = await manifestService.storageTotals()
  const logStorage = await manifestService.getLogStorageByPackage()
  
  const sessionStartTime = session.startedAt
  const sessionEndTime = session.updatedAt
  const logs = await manifestService.getLogEntriesInTimeRange(sessionStartTime, sessionEndTime)

  const logStorageObj: Record<string, { bytes: number; count: number }> = {}
  logStorage.forEach((value, key) => {
    logStorageObj[key] = value
  })

  const dumpData: DebugDumpData = {
    manifest: {
      session: {
        id: session.id,
        title: session.title,
        startedAt: session.startedAt,
        updatedAt: session.updatedAt,
        status: session.status,
        totalBytes: session.totalBytes,
        chunkCount: session.chunkCount,
        durationMs: session.durationMs,
        mimeType: session.mimeType,
        timingStatus: session.timingStatus,
      },
      chunks: chunks.map((c) => ({
        id: c.id,
        seq: c.seq,
        startMs: c.startMs,
        endMs: c.endMs,
        byteLength: c.byteLength,
        createdAt: c.createdAt,
        verifiedAudioMsec: c.verifiedAudioMsec,
        timingStatus: c.timingStatus,
        audioPurgedAt: c.audioPurgedAt || null,
      })),
    },
    snips: snips.map((s) => ({
      id: s.id,
      index: s.index,
      startMs: s.startMs,
      endMs: s.endMs,
      durationMs: s.durationMs,
      breakReason: s.breakReason,
      boundaryIndex: s.boundaryIndex,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
      audioPurgedAt: s.audioPurgedAt || null,
      hasTranscription: !!s.transcription,
      transcriptionError: s.transcriptionError || null,
    })),
    transcripts: snips
      .filter((s) => s.transcription)
      .map((s) => ({
        snipId: s.id,
        transcription: s.transcription,
      })),
    volumeProfile: volumeProfiles,
    logs: logs.map((l) => ({
      packageId: l.packageId,
      timestamp: l.timestamp,
      level: l.level,
      message: l.message,
      details: l.details,
    })),
    settings: {
      storageLimitBytes: settings.storageLimitBytes,
      logLevels: settings.logLevels,
    },
    storageSummary: {
      totalSessionCount: sessions.length,
      totalChunkBytes: storageTotals.totalBytes,
      logStorageByPackage: logStorageObj,
    },
  }

  const json = JSON.stringify(dumpData, null, 2)
  const blob = new Blob([json], { type: 'application/json' })
  const timestamp = new Date(session.startedAt).toISOString().replace(/[:.]/g, '-')
  downloadBlob(blob, `debug-dump-${timestamp}.json`)
}
