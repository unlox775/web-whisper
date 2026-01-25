import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import type { ChunkVolumeProfile } from './chunk-volume'
import { DEFAULT_CHUNK_TIMING_STATUS, computeSequentialTimings } from './chunk-timing'

export type SessionStatus = 'recording' | 'ready' | 'error'
export type ChunkTimingStatus = 'unverified' | 'verified'

export interface SessionRecord {
  id: string
  title: string
  startedAt: number
  updatedAt: number
  status: SessionStatus
  totalBytes: number
  chunkCount: number
  durationMs: number
  mimeType: string | null
  notes?: string
  timingStatus?: ChunkTimingStatus
}

export interface ChunkRecord {
  id: string
  sessionId: string
  seq: number
  startMs: number
  endMs: number
  byteLength: number
  createdAt: number
  verifiedAudioMsec: number | null
  timingStatus?: ChunkTimingStatus
  audioPurgedAt?: number | null
}

export interface StoredChunk extends ChunkRecord {
  blob: Blob
}

export interface ChunkVolumeProfileRecord extends ChunkVolumeProfile {
  id: string
  createdAt: number
  updatedAt: number
}

export type SnipBreakReason = 'pause' | 'end'

export type SnipTranscriptSegment = [number, string]

export type SnipTranscription = {
  text: string
  segments: SnipTranscriptSegment[]
  model: string
  language?: string | null
  createdAt: number
}

export type SnipRecord = {
  id: string
  sessionId: string
  index: number
  startMs: number
  endMs: number
  durationMs: number
  breakReason: SnipBreakReason | null
  boundaryIndex: number | null
  createdAt: number
  updatedAt: number
  transcription?: SnipTranscription | null
  transcriptionError?: string | null
  audioPurgedAt?: number | null
}

export type SnipSeed = Pick<SnipRecord, 'index' | 'startMs' | 'endMs' | 'durationMs' | 'breakReason' | 'boundaryIndex'>

export interface SessionTimingVerificationResult {
  sessionId: string
  status: ChunkTimingStatus
  updatedChunkIds: string[]
  missingChunkIds: string[]
  totalVerifiedDurationMs: number
  baseStartMs: number | null
  verifiedChunkCount: number
  session?: SessionRecord | null
}

export interface StorageRetentionResult {
  limitBytes: number
  beforeBytes: number
  afterBytes: number
  purgedChunkIds: string[]
  purgedSnipIds: string[]
  updatedSessionIds: string[]
  ranAt: number
}

type StoredChunkVolumeFrame = number | { normalized?: number; rms?: number }

const sanitizeVolumeRecord = (record: any): ChunkVolumeProfileRecord => {
  const rawFrames: StoredChunkVolumeFrame[] = Array.isArray(record.frames) ? record.frames : []
  const normalizedFrames: number[] =
    rawFrames.length > 0 && typeof rawFrames[0] === 'number'
      ? (rawFrames as number[])
      : rawFrames.map((frame) => {
          if (frame && typeof frame === 'object') {
            if (typeof frame.normalized === 'number') {
              return Math.max(0, frame.normalized)
            }
            if (typeof frame.rms === 'number') {
              return Math.max(0, frame.rms)
            }
          }
          return 0
        })

  const frameDurationMs =
    typeof record.frameDurationMs === 'number' && record.frameDurationMs > 0
      ? record.frameDurationMs
      : 50
  const durationMs =
    typeof record.durationMs === 'number' && record.durationMs > 0
      ? record.durationMs
      : normalizedFrames.length * frameDurationMs

  const maxNormalized =
    typeof record.maxNormalized === 'number'
      ? record.maxNormalized
      : normalizedFrames.length > 0
        ? Math.max(...normalizedFrames)
        : 0
  const averageNormalized =
    typeof record.averageNormalized === 'number'
      ? record.averageNormalized
      : normalizedFrames.length > 0
        ? normalizedFrames.reduce((sum, value) => sum + value, 0) / normalizedFrames.length
        : 0

  return {
    chunkId: record.chunkId,
    sessionId: record.sessionId,
    seq: record.seq ?? 0,
    chunkStartMs: record.chunkStartMs ?? 0,
    chunkEndMs:
      typeof record.chunkEndMs === 'number'
        ? record.chunkEndMs
        : (record.chunkStartMs ?? 0) + durationMs,
    durationMs,
    sampleRate: record.sampleRate ?? 0,
    frameDurationMs,
    frames: normalizedFrames,
    maxNormalized,
    averageNormalized,
    scalingFactor: record.scalingFactor ?? 1,
    id: record.id ?? record.chunkId,
    createdAt: record.createdAt ?? Date.now(),
    updatedAt: record.updatedAt ?? Date.now(),
  }
}

const normalizeSnipRecord = (record: SnipRecord): SnipRecord => {
  const startMs = Number.isFinite(record.startMs) ? record.startMs : 0
  const endMs = Number.isFinite(record.endMs) ? record.endMs : startMs
  const durationMs = Number.isFinite(record.durationMs) ? record.durationMs : Math.max(0, endMs - startMs)
  const audioPurgedAt = typeof record.audioPurgedAt === 'number' ? record.audioPurgedAt : null
  const transcription = record.transcription
    ? {
        ...record.transcription,
        segments: Array.isArray(record.transcription.segments) ? record.transcription.segments : [],
        text: record.transcription.text ?? '',
      }
    : record.transcription

  return {
    ...record,
    index: Number.isFinite(record.index) ? record.index : 0,
    startMs,
    endMs,
    durationMs,
    breakReason: record.breakReason ?? null,
    boundaryIndex: typeof record.boundaryIndex === 'number' ? record.boundaryIndex : null,
    transcription: transcription ?? null,
    transcriptionError: record.transcriptionError ?? null,
    audioPurgedAt,
  }
}

interface DurableRecorderDB extends DBSchema {
  sessions: {
    key: string
    value: SessionRecord
    indexes: { 'by-updated': number }
  }
  chunks: {
    key: string
    value: StoredChunk
    indexes: { 'by-session': string }
  }
  chunkVolumes: {
    key: string
    value: ChunkVolumeProfileRecord
    indexes: { 'by-session': string; 'by-chunk': string }
  }
  snips: {
    key: string
    value: SnipRecord
    indexes: { 'by-session': string }
  }
  logSessions: {
    key: string
    value: LogSessionRecord
    indexes: { 'by-started': number }
  }
  logEntries: {
    key: number
    value: LogEntryRecord
    indexes: { 'by-session': string; 'by-timestamp': number }
  }
}

export interface LogSessionRecord {
  id: string
  startedAt: number
  endedAt?: number
}

export interface LogEntryRecord {
  id?: number
  sessionId: string
  timestamp: number
  level: 'debug' | 'info' | 'warn' | 'error'
  message: string
  details?: Record<string, unknown>
}

const DB_NAME = 'durable-audio-recorder'
const DB_VERSION = 4
const MAX_LOG_SESSIONS = 50

let dbPromise: Promise<IDBPDatabase<DurableRecorderDB>> | null = null

async function getDB(): Promise<IDBPDatabase<DurableRecorderDB>> {
  if (!dbPromise) {
    dbPromise = openDB<DurableRecorderDB>(DB_NAME, DB_VERSION, {
      upgrade(db, oldVersion) {
        if (oldVersion < 1) {
          const sessions = db.createObjectStore('sessions', { keyPath: 'id' })
          sessions.createIndex('by-updated', 'updatedAt')
          const chunks = db.createObjectStore('chunks', { keyPath: 'id' })
          chunks.createIndex('by-session', 'sessionId')
        }

        if (oldVersion < 2) {
          const logSessions = db.createObjectStore('logSessions', { keyPath: 'id' })
          logSessions.createIndex('by-started', 'startedAt')
          const logEntries = db.createObjectStore('logEntries', { keyPath: 'id', autoIncrement: true })
          logEntries.createIndex('by-session', 'sessionId')
          logEntries.createIndex('by-timestamp', 'timestamp')
        }

        if (oldVersion < 3) {
          const chunkVolumes = db.createObjectStore('chunkVolumes', { keyPath: 'id' })
          chunkVolumes.createIndex('by-session', 'sessionId')
          chunkVolumes.createIndex('by-chunk', 'chunkId')
        }

        if (oldVersion < 4) {
          const snips = db.createObjectStore('snips', { keyPath: 'id' })
          snips.createIndex('by-session', 'sessionId')
        }
      },
    })
  }
  return dbPromise
}

export interface ManifestService {
  init(): Promise<void>
  createSession(record: SessionRecord): Promise<void>
  updateSession(id: string, patch: Partial<SessionRecord>): Promise<SessionRecord | null>
  appendChunk(entry: Omit<StoredChunk, 'blob' | 'byteLength' | 'createdAt'>, blob: Blob): Promise<void>
  listSessions(): Promise<SessionRecord[]>
  getSession(sessionId: string): Promise<SessionRecord | null>
  getChunkMetadata(sessionId: string): Promise<ChunkRecord[]>
  getChunkData(sessionId: string): Promise<StoredChunk[]>
    buildSessionBlob(sessionId: string, mimeType: string): Promise<Blob | null>
    storeChunkVolumeProfile(profile: ChunkVolumeProfile): Promise<void>
    getChunkVolumeProfile(chunkId: string): Promise<ChunkVolumeProfileRecord | null>
    listChunkVolumeProfiles(sessionId?: string): Promise<ChunkVolumeProfileRecord[]>
  listSnips(sessionId?: string): Promise<SnipRecord[]>
  appendSnips(sessionId: string, snips: SnipSeed[]): Promise<SnipRecord[]>
  updateSnipTranscription(
    snipId: string,
    patch: { transcription?: SnipTranscription | null; transcriptionError?: string | null },
  ): Promise<SnipRecord | null>
    deleteSession(sessionId: string): Promise<void>
    purgeLegacyMp4Sessions(): Promise<{ deletedSessions: number }>
    storageTotals(): Promise<{ totalBytes: number }>
    applyRetentionPolicy(options: { limitBytes: number; now?: number }): Promise<StorageRetentionResult>
    verifySessionChunkTimings(sessionId: string): Promise<SessionTimingVerificationResult>
    reconcileDanglingSessions(): Promise<void>
  getChunksForInspection(): Promise<Array<Record<string, unknown>>>
  createLogSession(): Promise<LogSessionRecord>
  finishLogSession(id: string): Promise<void>
  appendLogEntry(entry: Omit<LogEntryRecord, 'id'>): Promise<void>
  listLogSessions(): Promise<LogSessionRecord[]>
  getLogEntries(sessionId: string, limit?: number): Promise<LogEntryRecord[]>
}

class IndexedDBManifestService implements ManifestService {
  async init(): Promise<void> {
    await getDB()
  }

  async createSession(record: SessionRecord): Promise<void> {
    const db = await getDB()
    await db.put('sessions', {
      ...record,
      timingStatus: record.timingStatus ?? DEFAULT_CHUNK_TIMING_STATUS,
    })
  }

  async updateSession(id: string, patch: Partial<SessionRecord>): Promise<SessionRecord | null> {
    const db = await getDB()
    const tx = db.transaction('sessions', 'readwrite')
    const store = tx.objectStore('sessions')
    const existing = await store.get(id)
    if (!existing) {
      await tx.done
      return null
    }
    const updated: SessionRecord = {
      ...existing,
      ...patch,
      timingStatus: patch.timingStatus ?? existing.timingStatus ?? DEFAULT_CHUNK_TIMING_STATUS,
    }
    await store.put(updated)
    await tx.done
    return updated
  }

  async appendChunk(entry: Omit<StoredChunk, 'blob' | 'byteLength' | 'createdAt'>, blob: Blob): Promise<void> {
    const db = await getDB()
    const tx = db.transaction(['chunks', 'sessions'], 'readwrite')
    const chunkStore = tx.objectStore('chunks')
    const sessionStore = tx.objectStore('sessions')

    const storedChunk: StoredChunk = {
      ...entry,
      blob,
      byteLength: blob.size,
      createdAt: Date.now(),
      // Only treat seq0 as init/header for mp4-like captures. For PCM->MP3 sessions, seq0 is real audio.
      verifiedAudioMsec: entry.seq === 0 && /mp4|m4a/i.test(blob.type) ? 0 : null,
      timingStatus: DEFAULT_CHUNK_TIMING_STATUS,
    }

    await chunkStore.put(storedChunk)

    const session = await sessionStore.get(entry.sessionId)
    if (session) {
      const durationMs = Math.max(session.durationMs, entry.endMs - session.startedAt)
      const updated: SessionRecord = {
        ...session,
        updatedAt: Date.now(),
        chunkCount: session.chunkCount + 1,
        totalBytes: session.totalBytes + blob.size,
        durationMs,
      }
      await sessionStore.put(updated)
    }

    await tx.done
  }

  async listSessions(): Promise<SessionRecord[]> {
    const db = await getDB()
    const sessions = await db.getAll('sessions')
    return sessions
      .map((session) => ({
        ...session,
        timingStatus: session.timingStatus ?? DEFAULT_CHUNK_TIMING_STATUS,
      }))
      .sort((a, b) => b.startedAt - a.startedAt)
  }

  async getSession(sessionId: string): Promise<SessionRecord | null> {
    const db = await getDB()
    const record = await db.get('sessions', sessionId)
    if (!record) {
      return null
    }
    return {
      ...record,
      timingStatus: record.timingStatus ?? DEFAULT_CHUNK_TIMING_STATUS,
    }
  }

  async getChunkMetadata(sessionId: string): Promise<ChunkRecord[]> {
    const db = await getDB()
    const index = db.transaction('chunks').store.index('by-session')
    const chunks = await index.getAll(sessionId)
    return chunks
      .map(({ blob: _blob, timingStatus, ...rest }) => ({
        ...rest,
        timingStatus: timingStatus ?? DEFAULT_CHUNK_TIMING_STATUS,
      }))
      .sort((a, b) => a.seq - b.seq)
  }

  async getChunkData(sessionId: string): Promise<StoredChunk[]> {
    const db = await getDB()
    const index = db.transaction('chunks').store.index('by-session')
    const chunks = await index.getAll(sessionId)
    return chunks
      .sort((a, b) => a.seq - b.seq)
      .map((chunk) => ({
        ...chunk,
        timingStatus: chunk.timingStatus ?? DEFAULT_CHUNK_TIMING_STATUS,
      }))
  }

  async buildSessionBlob(sessionId: string, mimeType: string): Promise<Blob | null> {
    const db = await getDB()
    const index = db.transaction('chunks').store.index('by-session')
    const chunks = await index.getAll(sessionId)
    if (chunks.length === 0) {
      return null
    }
    const ordered = chunks.sort((a, b) => a.seq - b.seq)
    const blobs = ordered.map((chunk) => chunk.blob)
    return new Blob(blobs, { type: mimeType })
  }

  async storeChunkVolumeProfile(profile: ChunkVolumeProfile): Promise<void> {
    const db = await getDB()
    const tx = db.transaction(['chunkVolumes', 'chunks'], 'readwrite')
    const volumeStore = tx.objectStore('chunkVolumes')
    const chunkStore = tx.objectStore('chunks')
    const existing = await volumeStore.get(profile.chunkId)
    const now = Date.now()
    const rawRecord: ChunkVolumeProfileRecord = {
      ...profile,
      id: profile.chunkId,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    }
    const record = sanitizeVolumeRecord(rawRecord)
    await volumeStore.put(record)

    const chunk = await chunkStore.get(profile.chunkId)
    if (chunk) {
      chunk.verifiedAudioMsec = Math.round(profile.durationMs)
      await chunkStore.put(chunk)
    }

    await tx.done
  }

  async getChunkVolumeProfile(chunkId: string): Promise<ChunkVolumeProfileRecord | null> {
    const db = await getDB()
    return (await db.get('chunkVolumes', chunkId)) ?? null
  }

  async listChunkVolumeProfiles(sessionId?: string): Promise<ChunkVolumeProfileRecord[]> {
    const db = await getDB()
    const store = db.transaction('chunkVolumes').store
    let rowsRaw: ChunkVolumeProfileRecord[]
    if (sessionId) {
      rowsRaw = await store.index('by-session').getAll(sessionId)
    } else {
      rowsRaw = await store.getAll()
    }
    const rows = rowsRaw.map((record) => sanitizeVolumeRecord(record))
    return rows.sort((a, b) => {
      if (a.sessionId !== b.sessionId) {
        return a.sessionId.localeCompare(b.sessionId)
      }
      if (a.seq !== b.seq) {
        return a.seq - b.seq
      }
      return a.chunkStartMs - b.chunkStartMs
    })
  }

  async listSnips(sessionId?: string): Promise<SnipRecord[]> {
    const db = await getDB()
    const store = db.transaction('snips').store
    let rowsRaw: SnipRecord[]
    if (sessionId) {
      rowsRaw = await store.index('by-session').getAll(sessionId)
    } else {
      rowsRaw = await store.getAll()
    }
    const rows = rowsRaw.map((record) => normalizeSnipRecord(record))
    return rows.sort((a, b) => {
      if (a.sessionId !== b.sessionId) {
        return a.sessionId.localeCompare(b.sessionId)
      }
      return a.index - b.index
    })
  }

  async appendSnips(sessionId: string, snips: SnipSeed[]): Promise<SnipRecord[]> {
    const db = await getDB()
    const tx = db.transaction('snips', 'readwrite')
    const store = tx.objectStore('snips')
    const existing = await store.index('by-session').getAll(sessionId)
    const existingByIndex = new Map<number, SnipRecord>()
    existing.forEach((snip) => {
      existingByIndex.set(snip.index, snip)
    })

    const now = Date.now()
    const created: SnipRecord[] = []
    for (const snip of snips) {
      if (existingByIndex.has(snip.index)) {
        continue
      }
      const safeStartMs = Number.isFinite(snip.startMs) ? Math.max(0, snip.startMs) : 0
      const safeEndMs = Number.isFinite(snip.endMs) ? Math.max(safeStartMs, snip.endMs) : safeStartMs
      const durationMs = Number.isFinite(snip.durationMs) ? Math.max(0, snip.durationMs) : Math.max(0, safeEndMs - safeStartMs)
      const record: SnipRecord = {
        id: `${sessionId}-snip-${snip.index}`,
        sessionId,
        index: snip.index,
        startMs: safeStartMs,
        endMs: safeEndMs,
        durationMs,
        breakReason: snip.breakReason ?? null,
        boundaryIndex: typeof snip.boundaryIndex === 'number' ? snip.boundaryIndex : null,
        createdAt: now,
        updatedAt: now,
        transcription: null,
        transcriptionError: null,
        audioPurgedAt: null,
      }
      await store.put(record)
      existingByIndex.set(record.index, record)
      created.push(record)
    }

    await tx.done
    const combined = Array.from(existingByIndex.values()).map((record) => normalizeSnipRecord(record))
    return combined.sort((a, b) => a.index - b.index)
  }

  async updateSnipTranscription(
    snipId: string,
    patch: { transcription?: SnipTranscription | null; transcriptionError?: string | null },
  ): Promise<SnipRecord | null> {
    const db = await getDB()
    const tx = db.transaction('snips', 'readwrite')
    const store = tx.objectStore('snips')
    const existing = await store.get(snipId)
    if (!existing) {
      await tx.done
      return null
    }
    const updated: SnipRecord = normalizeSnipRecord({
      ...existing,
      transcription: patch.transcription !== undefined ? patch.transcription : existing.transcription,
      transcriptionError: patch.transcriptionError !== undefined ? patch.transcriptionError : existing.transcriptionError,
      updatedAt: Date.now(),
    })
    await store.put(updated)
    await tx.done
    return updated
  }

  async deleteSession(sessionId: string): Promise<void> {
    const db = await getDB()
    const tx = db.transaction(['sessions', 'chunks', 'chunkVolumes', 'snips'], 'readwrite')
    await tx.objectStore('sessions').delete(sessionId)
    const chunkStore = tx.objectStore('chunks')
    const chunkIndex = chunkStore.index('by-session')
    for (let cursor = await chunkIndex.openCursor(sessionId); cursor; cursor = await cursor.continue()) {
      await cursor.delete()
    }
    const volumeStore = tx.objectStore('chunkVolumes')
    const volumeIndex = volumeStore.index('by-session')
    for (let cursor = await volumeIndex.openCursor(sessionId); cursor; cursor = await cursor.continue()) {
      await cursor.delete()
    }
    const snipStore = tx.objectStore('snips')
    const snipIndex = snipStore.index('by-session')
    for (let cursor = await snipIndex.openCursor(sessionId); cursor; cursor = await cursor.continue()) {
      await cursor.delete()
    }
    await tx.done
  }

  async purgeLegacyMp4Sessions(): Promise<{ deletedSessions: number }> {
    const sessions = await this.listSessions()
    const legacy = sessions.filter((session) => /mp4|m4a/i.test(session.mimeType ?? ''))
    for (const session of legacy) {
      await this.deleteSession(session.id)
    }
    return { deletedSessions: legacy.length }
  }

  async storageTotals(): Promise<{ totalBytes: number }> {
    const db = await getDB()
    const chunkStore = db.transaction('chunks').store
    let totalBytes = 0
    let cursor = await chunkStore.openCursor()
    while (cursor) {
      totalBytes += cursor.value.byteLength
      cursor = await cursor.continue()
    }
    return { totalBytes }
  }

  async applyRetentionPolicy(options: { limitBytes: number; now?: number }): Promise<StorageRetentionResult> {
    const now = typeof options.now === 'number' ? options.now : Date.now()
    const db = await getDB()
    const tx = db.transaction(['chunks', 'snips', 'sessions'], 'readwrite')
    const chunkStore = tx.objectStore('chunks')
    const snipStore = tx.objectStore('snips')
    const sessionStore = tx.objectStore('sessions')

    const [chunksRaw, snipsRaw, sessionsRaw] = await Promise.all([
      chunkStore.getAll(),
      snipStore.getAll(),
      sessionStore.getAll(),
    ])

    const chunks = chunksRaw.map((chunk) => ({
      ...chunk,
      timingStatus: chunk.timingStatus ?? DEFAULT_CHUNK_TIMING_STATUS,
    }))
    const snips = snipsRaw.map((record) => normalizeSnipRecord(record))
    const sessions = sessionsRaw.map((session) => ({
      ...session,
      timingStatus: session.timingStatus ?? DEFAULT_CHUNK_TIMING_STATUS,
    }))

    const beforeBytes = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0)
    let totalBytes = beforeBytes

    const limitBytes = Number.isFinite(options.limitBytes) ? Math.max(0, options.limitBytes) : beforeBytes
    if (totalBytes <= limitBytes) {
      await tx.done
      return {
        limitBytes,
        beforeBytes,
        afterBytes: totalBytes,
        purgedChunkIds: [],
        purgedSnipIds: [],
        updatedSessionIds: [],
        ranAt: now,
      }
    }

    const sessionById = new Map(sessions.map((session) => [session.id, session]))
    const sessionTotals = new Map<string, number>()
    chunks.forEach((chunk) => {
      sessionTotals.set(chunk.sessionId, (sessionTotals.get(chunk.sessionId) ?? 0) + chunk.byteLength)
    })

    const snipsBySession = new Map<string, SnipRecord[]>()
    snips.forEach((snip) => {
      const existing = snipsBySession.get(snip.sessionId)
      if (existing) {
        existing.push(snip)
      } else {
        snipsBySession.set(snip.sessionId, [snip])
      }
    })
    snipsBySession.forEach((items) => items.sort((a, b) => a.startMs - b.startMs))

    const COVERAGE_EPSILON_MS = 4
    const isHeaderChunk = (chunk: StoredChunk, session: SessionRecord | null): boolean => {
      const mimeType = chunk.blob.type || session?.mimeType || ''
      if (!/mp4|m4a/i.test(mimeType)) {
        return false
      }
      const durationMs = Math.max(0, chunk.endMs - chunk.startMs)
      return chunk.seq === 0 && (durationMs <= 10 || chunk.byteLength < 4096)
    }
    const getOverlappingSnips = (snipsForSession: SnipRecord[] | undefined, chunk: StoredChunk): SnipRecord[] => {
      if (!snipsForSession || snipsForSession.length === 0) return []
      const overlapStart = chunk.startMs + COVERAGE_EPSILON_MS
      const overlapEnd = chunk.endMs - COVERAGE_EPSILON_MS
      if (overlapEnd <= overlapStart) {
        return []
      }
      const overlaps: SnipRecord[] = []
      for (const snip of snipsForSession) {
        if (snip.endMs <= overlapStart) {
          continue
        }
        if (snip.startMs >= overlapEnd) {
          break
        }
        overlaps.push(snip)
      }
      return overlaps
    }

    const eligible: Array<{ chunk: StoredChunk; snipIds: string[]; session: SessionRecord | null }> = []
    for (const chunk of chunks) {
      if (chunk.byteLength <= 0 || chunk.blob.size <= 0) continue
      const session = sessionById.get(chunk.sessionId) ?? null
      if (isHeaderChunk(chunk, session)) continue
      const snipsForSession = snipsBySession.get(chunk.sessionId)
      const overlaps = getOverlappingSnips(snipsForSession, chunk)
      if (overlaps.length === 0) continue
      if (!overlaps.every((snip) => snip.transcription && !snip.transcriptionError)) {
        continue
      }
      eligible.push({ chunk, snipIds: overlaps.map((snip) => snip.id), session })
    }

    eligible.sort((a, b) => {
      const aKey = a.chunk.createdAt ?? a.chunk.startMs
      const bKey = b.chunk.createdAt ?? b.chunk.startMs
      if (aKey !== bKey) return aKey - bKey
      return a.chunk.seq - b.chunk.seq
    })

    const purgedChunkIds: string[] = []
    const purgedSnipIds = new Set<string>()
    const updatedSessionIds = new Set<string>()

    for (const entry of eligible) {
      if (totalBytes <= limitBytes) break
      const chunk = entry.chunk
      const removedBytes = chunk.byteLength
      if (removedBytes <= 0) continue
      const mimeType = chunk.blob.type || entry.session?.mimeType || ''
      const updatedChunk: StoredChunk = {
        ...chunk,
        blob: new Blob([], { type: mimeType }),
        byteLength: 0,
        audioPurgedAt: now,
      }
      await chunkStore.put(updatedChunk)
      purgedChunkIds.push(chunk.id)
      totalBytes = Math.max(0, totalBytes - removedBytes)
      sessionTotals.set(chunk.sessionId, Math.max(0, (sessionTotals.get(chunk.sessionId) ?? 0) - removedBytes))
      updatedSessionIds.add(chunk.sessionId)
      entry.snipIds.forEach((snipId) => purgedSnipIds.add(snipId))
    }

    for (const sessionId of updatedSessionIds) {
      const session = sessionById.get(sessionId)
      if (!session) continue
      const nextTotal = Math.max(0, sessionTotals.get(sessionId) ?? 0)
      await sessionStore.put({
        ...session,
        totalBytes: nextTotal,
        updatedAt: now,
        timingStatus: session.timingStatus ?? DEFAULT_CHUNK_TIMING_STATUS,
      })
    }

    for (const snipId of purgedSnipIds) {
      const existing = await snipStore.get(snipId)
      if (!existing) continue
      const normalized = normalizeSnipRecord(existing)
      if (normalized.audioPurgedAt) continue
      await snipStore.put({
        ...normalized,
        audioPurgedAt: now,
        updatedAt: now,
      })
    }

    await tx.done
    return {
      limitBytes,
      beforeBytes,
      afterBytes: totalBytes,
      purgedChunkIds,
      purgedSnipIds: Array.from(purgedSnipIds),
      updatedSessionIds: Array.from(updatedSessionIds),
      ranAt: now,
    }
  }

  /**
   * Performs a deterministic rebuild of a session's chunk timing metadata once all chunk
   * durations have been verified. If any chunk still lacks a positive duration, the pass
   * returns early without mutating the stored start/end values, signalling the caller to
   * regenerate the missing volume profile first.
   */
  async verifySessionChunkTimings(sessionId: string): Promise<SessionTimingVerificationResult> {
    const db = await getDB()
    const tx = db.transaction(['chunks', 'chunkVolumes', 'sessions'], 'readwrite')
    const chunkStore = tx.objectStore('chunks')
    const volumeStore = tx.objectStore('chunkVolumes')
    const sessionStore = tx.objectStore('sessions')

    const [sessionRecord, chunkRows] = await Promise.all([
      sessionStore.get(sessionId),
      chunkStore.index('by-session').getAll(sessionId),
    ])

    const normalizedSession: SessionRecord | null = sessionRecord
      ? {
          ...sessionRecord,
          timingStatus: sessionRecord.timingStatus ?? DEFAULT_CHUNK_TIMING_STATUS,
        }
      : null

    if (chunkRows.length === 0) {
      await tx.done
      return {
        sessionId,
        status: DEFAULT_CHUNK_TIMING_STATUS,
        updatedChunkIds: [],
        missingChunkIds: [],
        totalVerifiedDurationMs: 0,
        baseStartMs: normalizedSession?.startedAt ?? null,
        verifiedChunkCount: 0,
        session: normalizedSession,
      }
    }

    const ordered = [...chunkRows].sort((a, b) => a.seq - b.seq)
    // Preallocate arrays so we can track verified durations and any missing chunk ids.
    const durations: number[] = new Array(ordered.length)
    const missingChunkIds: string[] = []

    const sessionMime = normalizedSession?.mimeType ?? ''
    const isMp4LikeSession = /mp4|m4a/i.test(sessionMime)
    const likelyInitChunk =
      isMp4LikeSession ? ordered.find((chunk) => chunk.seq === 0 && (chunk.endMs - chunk.startMs <= 10 || chunk.byteLength < 4096)) ?? null : null

    for (let i = 0; i < ordered.length; i += 1) {
      const chunk = ordered[i]
      const isInit = likelyInitChunk?.id === chunk.id
      if (isInit) {
        durations[i] = 0
        continue
      }
      // Prefer the previously verified audio length when it exists.
      const verifiedDuration =
        typeof chunk.verifiedAudioMsec === 'number' && chunk.verifiedAudioMsec > 0
          ? Math.round(chunk.verifiedAudioMsec)
          : null

      if (verifiedDuration !== null) {
        durations[i] = verifiedDuration
        continue
      }

      const volumeRecord = await volumeStore.get(chunk.id)
      if (volumeRecord && typeof volumeRecord.durationMs === 'number' && volumeRecord.durationMs > 0) {
        durations[i] = Math.round(volumeRecord.durationMs)
        continue
      }

      // Record the missing chunk id so callers know which profile still needs regeneration.
      missingChunkIds.push(chunk.id)
    }

    const baseStartMsCandidate =
      likelyInitChunk?.startMs ??
      normalizedSession?.startedAt ??
      ordered[0]?.startMs ??
      Date.now()
    const baseStartMs = Number.isFinite(baseStartMsCandidate) ? Math.round(baseStartMsCandidate) : Date.now()

    if (missingChunkIds.length > 0) {
      if (sessionRecord && sessionRecord.timingStatus !== DEFAULT_CHUNK_TIMING_STATUS) {
        await sessionStore.put({
          ...sessionRecord,
          timingStatus: DEFAULT_CHUNK_TIMING_STATUS,
        })
      }
      await tx.done
      return {
        sessionId,
        status: DEFAULT_CHUNK_TIMING_STATUS,
        updatedChunkIds: [],
        missingChunkIds,
        totalVerifiedDurationMs: 0,
        baseStartMs,
        verifiedChunkCount: ordered.filter((_chunk, idx) => durations[idx] > 0).length,
        session: normalizedSession,
      }
    }

    const sequentialPlan = computeSequentialTimings(
      baseStartMs,
      ordered.map((chunk, idx) => ({
        id: chunk.id,
        seq: chunk.seq,
        durationMs: durations[idx],
      })),
    )

    const updatedChunkIds: string[] = []
    let totalVerifiedDurationMs = 0
    let verifiedChunkCount = 0

    for (let idx = 0; idx < sequentialPlan.length; idx += 1) {
      const current = ordered[idx]
      const plan = sequentialPlan[idx]
      // Merge the verified timeline back into the chunk record so storage reflects deterministic values.
      const nextChunk = {
        ...current,
        startMs: plan.startMs,
        endMs: plan.endMs,
        verifiedAudioMsec: plan.durationMs,
        timingStatus: 'verified' as ChunkTimingStatus,
      }

      // Only persist the chunk when something actually changed to minimise writes.
      const requiresUpdate =
        current.startMs !== nextChunk.startMs ||
        current.endMs !== nextChunk.endMs ||
        (current.verifiedAudioMsec ?? 0) !== nextChunk.verifiedAudioMsec ||
        current.timingStatus !== 'verified'

      if (requiresUpdate) {
        await chunkStore.put(nextChunk)
        updatedChunkIds.push(nextChunk.id)
      }

      ordered[idx] = nextChunk

      // Accumulate verification totals so the caller can surface progress feedback.
      if (plan.durationMs > 0) {
        verifiedChunkCount += 1
        totalVerifiedDurationMs += Math.max(0, plan.durationMs)
      }
    }

    let updatedSession: SessionRecord | null = normalizedSession
    if (sessionRecord) {
      const verifiedDurationRounded = Math.max(0, Math.round(totalVerifiedDurationMs))
      const nextSession: SessionRecord = {
        ...sessionRecord,
        timingStatus: 'verified',
        durationMs: Math.max(sessionRecord.durationMs, verifiedDurationRounded),
        updatedAt: Date.now(),
      }
      await sessionStore.put(nextSession)
      updatedSession = {
        ...nextSession,
      }
    }

    await tx.done
    return {
      sessionId,
      status: 'verified',
      updatedChunkIds,
      missingChunkIds: [],
      totalVerifiedDurationMs: Math.max(0, Math.round(totalVerifiedDurationMs)),
      baseStartMs,
      verifiedChunkCount,
      session: updatedSession,
    }
  }

  async reconcileDanglingSessions(): Promise<void> {
    const db = await getDB()
    const tx = db.transaction(['sessions', 'chunks'], 'readwrite')
    const sessionStore = tx.objectStore('sessions')
    const chunkStore = tx.objectStore('chunks')
    const sessions = await sessionStore.getAll()
    const now = Date.now()

    for (const session of sessions) {
      if (session.status !== 'recording') continue

      const chunks = await chunkStore.index('by-session').getAll(session.id)
      if (chunks.length === 0) {
        await sessionStore.put({
            ...session,
            status: 'error',
            notes: 'No audio captured (session interrupted).',
            updatedAt: now,
            totalBytes: 0,
            chunkCount: 0,
            durationMs: 0,
            timingStatus: session.timingStatus ?? DEFAULT_CHUNK_TIMING_STATUS,
        })
      } else {
        const totalBytes = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0)
        const durationMs = Math.max(
            session.durationMs,
            Math.max(...chunks.map((chunk) => chunk.endMs)) - session.startedAt,
          )
        await sessionStore.put({
            ...session,
            status: 'ready',
            notes: session.notes,
            updatedAt: now,
            totalBytes,
            chunkCount: chunks.length,
            durationMs,
            timingStatus: session.timingStatus ?? DEFAULT_CHUNK_TIMING_STATUS,
          })
        }
    }

    await tx.done
  }

  async getChunksForInspection(): Promise<Array<Record<string, unknown>>> {
    const db = await getDB()
    const chunks = await db.transaction('chunks').store.getAll()
    const ordered = chunks.sort((a, b) => {
      if (a.startMs !== b.startMs) return b.startMs - a.startMs
      if (a.seq !== b.seq) return b.seq - a.seq
      return (b.createdAt ?? 0) - (a.createdAt ?? 0)
    })

    return Promise.all(
      ordered.map(async ({ blob, ...rest }) => {
        let verifiedByteLength: number | null = null
        try {
          const buffer = await blob.arrayBuffer()
          verifiedByteLength = buffer.byteLength
        } catch (error) {
          console.warn('[Manifest] Failed to read chunk blob for inspection', error)
        }

        return {
          ...rest,
          timingStatus: rest.timingStatus ?? DEFAULT_CHUNK_TIMING_STATUS,
          blobSize: blob.size,
          blobType: blob.type,
          verifiedByteLength,
          sizeMismatch: verifiedByteLength !== null && verifiedByteLength !== blob.size,
          startIso: new Date(rest.startMs).toISOString(),
          endIso: new Date(rest.endMs).toISOString(),
          blob: '[binary omitted]',
        }
      }),
    )
  }

  async createLogSession(): Promise<LogSessionRecord> {
    const db = await getDB()
    const tx = db.transaction(['logSessions', 'logEntries'], 'readwrite')
    const logSessions = tx.objectStore('logSessions')
    const id = crypto.randomUUID()
    const session: LogSessionRecord = {
      id,
      startedAt: Date.now(),
    }
    await logSessions.put(session)

    const existing = await logSessions.getAll()
    if (existing.length > MAX_LOG_SESSIONS) {
      const sorted = existing.sort((a, b) => a.startedAt - b.startedAt)
      const overflow = sorted.slice(0, existing.length - MAX_LOG_SESSIONS)
      const logEntries = tx.objectStore('logEntries')
      for (const s of overflow) {
        await logSessions.delete(s.id)
        for (let cursor = await logEntries.index('by-session').openCursor(s.id); cursor; cursor = await cursor.continue()) {
          await cursor.delete()
        }
      }
    }

    await tx.done
    return session
  }

  async finishLogSession(id: string): Promise<void> {
    const db = await getDB()
    const store = db.transaction('logSessions', 'readwrite').objectStore('logSessions')
    const record = await store.get(id)
    if (record) {
      record.endedAt = Date.now()
      await store.put(record)
    }
  }

  async appendLogEntry(entry: Omit<LogEntryRecord, 'id'>): Promise<void> {
    const db = await getDB()
    const store = db.transaction('logEntries', 'readwrite').objectStore('logEntries')
    await store.add({ ...entry })
  }

  async listLogSessions(): Promise<LogSessionRecord[]> {
    const db = await getDB()
    const sessions = await db.transaction('logSessions').store.getAll()
    return sessions.sort((a, b) => b.startedAt - a.startedAt)
  }

  async getLogEntries(sessionId: string, limit = 250): Promise<LogEntryRecord[]> {
    const db = await getDB()
    const index = db.transaction('logEntries').store.index('by-session')
    const entries: LogEntryRecord[] = []
    for (let cursor = await index.openCursor(sessionId, 'prev'); cursor && entries.length < limit; cursor = await cursor.continue()) {
      entries.push(cursor.value)
    }
    return entries.sort((a, b) => a.timestamp - b.timestamp)
  }
}

export const manifestService: ManifestService = new IndexedDBManifestService()
