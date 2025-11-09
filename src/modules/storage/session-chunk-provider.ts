import {
  analyzeRecordingChunkingFromProfiles,
  computeChunkVolumeProfile,
  type RecordingChunkAnalysis,
} from '../analysis/chunking'
import {
  manifestService,
  type ChunkRecord,
  type ChunkVolumeProfileRecord,
  type ManifestService,
  type SessionRecord,
  type SessionTimingVerificationResult,
} from './manifest'
import { DEFAULT_CHUNK_TIMING_STATUS } from './chunk-timing'

export interface SessionChunkAnalysisResult {
  sessionId: string
  cacheKey: string
  analysis: RecordingChunkAnalysis | null
  verification: SessionTimingVerificationResult
  chunkMetadata: ChunkRecord[]
  volumeProfiles: ChunkVolumeProfileRecord[]
}

export interface PrepareAnalysisOptions {
  session: SessionRecord
  forceRefresh?: boolean
  mimeTypeHint?: string | null
}

const MP4_MIME_PATTERN = /mp4|m4a/i

/**
 * Central orchestration layer for session chunk state. The provider owns the fetch/verify
 * lifecycle for chunk metadata, chunk volume profiles, and the derived recording analysis.
 */
export class SessionChunkProvider {
  #manifest: ManifestService
  #initialized = false
  #verificationInflight = new Map<string, Promise<SessionTimingVerificationResult>>()
  #analysisCache = new Map<string, { cacheKey: string; analysis: RecordingChunkAnalysis }>()

  constructor(manifest: ManifestService = manifestService) {
    this.#manifest = manifest
  }

  async #ensureInit(): Promise<void> {
    if (this.#initialized) {
      return
    }
    await this.#manifest.init()
    this.#initialized = true
  }

  /**
   * Ensures the manifest-driven verification pass has an opportunity to run without stacking
   * concurrent transactions for the same session. The returned promise resolves with the latest
   * verification summary.
   */
  async ensureTimings(sessionId: string): Promise<SessionTimingVerificationResult> {
    await this.#ensureInit()
    const existing = this.#verificationInflight.get(sessionId)
    if (existing) {
      return existing
    }
    const task = this.#manifest
      .verifySessionChunkTimings(sessionId)
      .then((result) => {
        this.#verificationInflight.delete(sessionId)
        return result
      })
      .catch((error) => {
        this.#verificationInflight.delete(sessionId)
        throw error
      })
    this.#verificationInflight.set(sessionId, task)
    return task
  }

  /**
   * Prepares a fully verified analysis context for the given session. Missing chunk durations
   * trigger a regeneration pass before re-running the manifest verification to guarantee fresh
   * start/end timestamps.
   */
  async prepareAnalysisForSession(options: PrepareAnalysisOptions): Promise<SessionChunkAnalysisResult> {
    const { session, forceRefresh = false } = options
    await this.#ensureInit()

    let verification = await this.ensureTimings(session.id)

    if (verification.status !== 'verified' && verification.missingChunkIds.length > 0) {
      await this.#regenerateMissingVolumes(session, verification.missingChunkIds, options.mimeTypeHint)
      verification = await this.ensureTimings(session.id)
    }

    const [chunkMetadata, volumeProfilesRaw] = await Promise.all([
      this.#manifest.getChunkMetadata(session.id),
      this.#manifest.listChunkVolumeProfiles(session.id),
    ])

    const volumeProfiles = volumeProfilesRaw.sort((a, b) => {
      if (a.seq !== b.seq) return a.seq - b.seq
      return a.chunkStartMs - b.chunkStartMs
    })

    const usableProfiles = volumeProfiles
      .filter((profile) => profile.sessionId === session.id && profile.durationMs > 0)
      .map((profile) => ({
        id: profile.id,
        createdAt: profile.createdAt,
        updatedAt: profile.updatedAt,
        chunkId: profile.chunkId,
        sessionId: profile.sessionId,
        seq: profile.seq,
        chunkStartMs: profile.chunkStartMs,
        chunkEndMs: profile.chunkEndMs,
        durationMs: profile.durationMs,
        sampleRate: profile.sampleRate,
        frameDurationMs: profile.frameDurationMs,
        frames: profile.frames,
        maxNormalized: profile.maxNormalized,
        averageNormalized: profile.averageNormalized,
        scalingFactor: profile.scalingFactor,
      }))

    const latestProfileUpdate = volumeProfiles.reduce(
      (max, record) => Math.max(max, record.updatedAt ?? record.createdAt ?? 0),
      0,
    )

    const cacheKey = [
      session.id,
      session.chunkCount,
      session.updatedAt ?? 0,
      verification.totalVerifiedDurationMs,
      verification.status,
      latestProfileUpdate,
    ].join(':')

    const cachedEntry = this.#analysisCache.get(session.id)
    if (!forceRefresh && cachedEntry && cachedEntry.cacheKey === cacheKey) {
      return {
        sessionId: session.id,
        cacheKey,
        analysis: cachedEntry.analysis,
        verification,
        chunkMetadata,
        volumeProfiles,
      }
    }

    if (usableProfiles.length === 0) {
      this.#analysisCache.delete(session.id)
      return {
        sessionId: session.id,
        cacheKey,
        analysis: null,
        verification,
        chunkMetadata,
        volumeProfiles,
      }
    }

    const totalDurationMs =
      verification.session?.durationMs ??
      (typeof session.durationMs === 'number' && session.durationMs > 0 ? session.durationMs : undefined)

    const analysis = analyzeRecordingChunkingFromProfiles(usableProfiles, {
      totalDurationMs,
    })

    if (analysis) {
      this.#analysisCache.set(session.id, { cacheKey, analysis })
    } else {
      this.#analysisCache.delete(session.id)
    }

    return {
      sessionId: session.id,
      cacheKey,
      analysis: analysis ?? null,
      verification,
      chunkMetadata,
      volumeProfiles,
    }
  }

  async #regenerateMissingVolumes(
    session: SessionRecord,
    missingChunkIds: string[],
    mimeTypeHint?: string | null,
  ): Promise<void> {
    if (missingChunkIds.length === 0) {
      return
    }

    const chunkData = await this.#manifest.getChunkData(session.id)
    if (chunkData.length === 0) {
      return
    }

    const headerChunk = chunkData.find((chunk) => chunk.seq === 0) ?? null
    const headerBlob = headerChunk?.blob ?? null
    const headerMime = headerBlob?.type ?? session.mimeType ?? mimeTypeHint ?? 'audio/mp4'

    const targets = chunkData.filter(
      (chunk) =>
        chunk.seq > 0 &&
        chunk.blob.size > 0 &&
        (chunk.timingStatus ?? DEFAULT_CHUNK_TIMING_STATUS) !== 'verified' &&
        missingChunkIds.includes(chunk.id),
    )

    for (const chunk of targets) {
      try {
        let analysisBlob: Blob = chunk.blob
        if (headerBlob && MP4_MIME_PATTERN.test(headerMime)) {
          analysisBlob = new Blob([headerBlob, chunk.blob], {
            type: headerBlob.type || chunk.blob.type || headerMime,
          })
        }
        const profile = await computeChunkVolumeProfile(analysisBlob, {
          chunkId: chunk.id,
          sessionId: session.id,
          seq: chunk.seq,
          chunkStartMs: chunk.startMs,
          chunkEndMs: chunk.endMs,
        })
        await this.#manifest.storeChunkVolumeProfile(profile)
      } catch (error) {
        console.warn('[SessionChunkProvider] Failed to regenerate chunk volume profile', {
          sessionId: session.id,
          chunkId: chunk.id,
          error,
        })
      }
    }
  }
}
