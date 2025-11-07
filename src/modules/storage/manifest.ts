import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import type { ChunkVolumeProfile } from '../analysis/chunking'

export type SessionStatus = 'recording' | 'ready' | 'error'

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
}

export interface StoredChunk extends ChunkRecord {
  blob: Blob
}

export interface ChunkVolumeProfileRecord extends ChunkVolumeProfile {
  id: string
  createdAt: number
  updatedAt: number
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
const DB_VERSION = 3
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
  deleteSession(sessionId: string): Promise<void>
  storageTotals(): Promise<{ totalBytes: number }>
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
    await db.put('sessions', record)
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
    const updated = { ...existing, ...patch }
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
      verifiedAudioMsec: entry.seq === 0 ? 0 : null,
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
    return sessions.sort((a, b) => b.startedAt - a.startedAt)
  }

  async getSession(sessionId: string): Promise<SessionRecord | null> {
    const db = await getDB()
    return (await db.get('sessions', sessionId)) ?? null
  }

  async getChunkMetadata(sessionId: string): Promise<ChunkRecord[]> {
    const db = await getDB()
    const index = db.transaction('chunks').store.index('by-session')
    const chunks = await index.getAll(sessionId)
    return chunks
      .map(({ blob: _blob, ...rest }) => rest)
      .sort((a, b) => a.seq - b.seq)
  }

  async getChunkData(sessionId: string): Promise<StoredChunk[]> {
    const db = await getDB()
    const index = db.transaction('chunks').store.index('by-session')
    const chunks = await index.getAll(sessionId)
    return chunks.sort((a, b) => a.seq - b.seq)
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

  async deleteSession(sessionId: string): Promise<void> {
    const db = await getDB()
    const tx = db.transaction(['sessions', 'chunks', 'chunkVolumes'], 'readwrite')
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
    await tx.done
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
