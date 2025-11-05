import { openDB, type DBSchema, type IDBPDatabase } from 'idb'

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
}

interface StoredChunk extends ChunkRecord {
  blob: Blob
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
}

const DB_NAME = 'durable-audio-recorder'
const DB_VERSION = 1

let dbPromise: Promise<IDBPDatabase<DurableRecorderDB>> | null = null

async function getDB(): Promise<IDBPDatabase<DurableRecorderDB>> {
  if (!dbPromise) {
    dbPromise = openDB<DurableRecorderDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('sessions')) {
          const sessions = db.createObjectStore('sessions', { keyPath: 'id' })
          sessions.createIndex('by-updated', 'updatedAt')
        }
        if (!db.objectStoreNames.contains('chunks')) {
          const chunks = db.createObjectStore('chunks', { keyPath: 'id' })
          chunks.createIndex('by-session', 'sessionId')
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
  buildSessionBlob(sessionId: string, mimeType: string): Promise<Blob | null>
  deleteSession(sessionId: string): Promise<void>
  storageTotals(): Promise<{ totalBytes: number }>
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

  async deleteSession(sessionId: string): Promise<void> {
    const db = await getDB()
    const tx = db.transaction(['sessions', 'chunks'], 'readwrite')
    await tx.objectStore('sessions').delete(sessionId)
    const chunkStore = tx.objectStore('chunks')
    const index = chunkStore.index('by-session')
    for (let cursor = await index.openCursor(sessionId); cursor; cursor = await cursor.continue()) {
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
}

export const manifestService: ManifestService = new IndexedDBManifestService()
