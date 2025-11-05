export interface ChunkRecord {
  id: string
  sessionId: string
  seq: number
  startMs: number
  endMs: number
  byteLength: number
  status: 'pending' | 'uploading' | 'uploaded' | 'failed'
  retries: number
  lastError?: string
}

export interface SnipRecord {
  id: string
  sessionId: string
  startMs: number
  endMs: number
  reason: 'pause' | 'timer' | 'forced'
  textPreview?: string
  transcriptionJobId?: string
}

export interface TranscriptionJobRecord {
  id: string
  sessionId: string
  snipIds: string[]
  windowStartMs: number
  windowEndMs: number
  status: 'queued' | 'running' | 'done' | 'error'
  attempt: number
  lastError?: string
}

export interface StorageStats {
  sessionId: string
  bytesBuffered: number
  bytesUploaded: number
  lastUploadAt?: number
  warning?: 'none' | 'low-storage' | 'offline'
}

export interface ManifestService {
  init(): Promise<void>
  appendChunk(record: ChunkRecord, blob: Blob): Promise<void>
  updateChunkStatus(id: string, status: ChunkRecord['status'], info?: Partial<ChunkRecord>): Promise<void>
  putSnip(record: SnipRecord): Promise<void>
  putTranscriptionJob(record: TranscriptionJobRecord): Promise<void>
  updateStats(patch: Partial<StorageStats>): Promise<void>
  listSessions(): Promise<string[]>
  clearSession(sessionId: string): Promise<void>
}

class UnimplementedManifestService implements ManifestService {
  async init(): Promise<void> {
    throw new Error('Manifest service not implemented')
  }

  async appendChunk(): Promise<void> {
    throw new Error('Manifest service not implemented')
  }

  async updateChunkStatus(): Promise<void> {
    throw new Error('Manifest service not implemented')
  }

  async putSnip(): Promise<void> {
    throw new Error('Manifest service not implemented')
  }

  async putTranscriptionJob(): Promise<void> {
    throw new Error('Manifest service not implemented')
  }

  async updateStats(): Promise<void> {
    throw new Error('Manifest service not implemented')
  }

  async listSessions(): Promise<string[]> {
    throw new Error('Manifest service not implemented')
  }

  async clearSession(): Promise<void> {
    throw new Error('Manifest service not implemented')
  }
}

export const manifestService: ManifestService = new UnimplementedManifestService()
