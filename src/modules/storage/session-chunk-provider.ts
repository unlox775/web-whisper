import {
  analyzeRecordingChunkingFromProfiles,
  computeChunkVolumeProfile,
  type ChunkVolumeProfile,
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
const FALLBACK_FRAME_DURATION_MS = 50

/**
 * Central orchestration layer for session chunk state. The provider owns the fetch/verify
 * lifecycle for chunk metadata, chunk volume profiles, and the derived recording analysis.
 * Every public method is aggressively commented to meet the documentation density guidelines.
 */
export class SessionChunkProvider {
  #manifest: ManifestService
  #initialized = false
  #verificationInflight = new Map<string, Promise<SessionTimingVerificationResult>>()
  #analysisCache = new Map<string, { cacheKey: string; analysis: RecordingChunkAnalysis }>()

  /** Creates a provider backed by the shared IndexedDB manifest implementation. */
  constructor(manifest: ManifestService = manifestService) {
    this.#manifest = manifest
  }

  /** Lazy-initialises the manifest service so consumers do not need to remember to call `init`. */
  async #ensureInit(): Promise<void> {
    // Exit quickly when the manifest has already been initialised for this provider instance.
    if (this.#initialized) {
      return
    }

    // Defer to the manifest to create or upgrade the underlying database schema.
    await this.#manifest.init()

    // Remember the initialisation state so subsequent calls become no-ops.
    this.#initialized = true
  }

  /**
   * Ensures the manifest-driven verification pass has an opportunity to run without stacking
   * concurrent transactions for the same session. The returned promise resolves with the latest
   * verification summary.
   */
  async ensureTimings(sessionId: string): Promise<SessionTimingVerificationResult> {
    // Always guarantee the manifest has been initialised before issuing read/write calls.
    await this.#ensureInit()

    // Reuse the existing verification promise if one is already in flight for this session.
    const existing = this.#verificationInflight.get(sessionId)
    if (existing) {
      return existing
    }

    // Kick off a new verification, tracking it so duplicate callers can piggy-back.
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

    // Manifest needs to be ready before we touch the underlying stores.
    await this.#ensureInit()

    // Run the verification pass first so downstream consumers see deterministic timing.
    let verification = await this.ensureTimings(session.id)

    // If verification reported missing chunks, regenerate the associated profiles and retry.
    if (verification.status !== 'verified' && verification.missingChunkIds.length > 0) {
      await this.#regenerateMissingVolumes(session, verification.missingChunkIds, options.mimeTypeHint)
      verification = await this.ensureTimings(session.id)
    }

    // Fetch the latest chunk metadata alongside the saved volume profiles.
    const [chunkMetadata, volumeProfilesRaw] = await Promise.all([
      this.#manifest.getChunkMetadata(session.id),
      this.#manifest.listChunkVolumeProfiles(session.id),
    ])

    // Stabilise ordering so charts and analyses consume the rows in temporal sequence.
    const volumeProfiles = volumeProfilesRaw.sort((a, b) => {
      if (a.seq !== b.seq) return a.seq - b.seq
      return a.chunkStartMs - b.chunkStartMs
    })

    // Build a quick lookup so we can overwrite profile positions with the verified chunk metadata.
    // Rewrite the stored profile timing using the verified chunk metadata so charts stay monotonic.
    const orderedChunkRecords = chunkMetadata
      .filter((chunk) => chunk.seq >= 0)
      .sort((a, b) => a.seq - b.seq)
    const chunkDurations = new Map<string, number>()
    orderedChunkRecords.forEach((chunk) => {
      if (chunk.seq === 0) {
        chunkDurations.set(chunk.id, 0)
        return
      }
      const durationMs = Math.max(0, chunk.endMs - chunk.startMs)
      chunkDurations.set(chunk.id, durationMs)
    })

    let cumulativeOffsetMs = 0
    const decoratedVolumeProfiles: ChunkVolumeProfileRecord[] = volumeProfiles.map((profile) => {
      if (profile.seq <= 0) {
        return {
          ...profile,
          chunkStartMs: 0,
          chunkEndMs: 0,
          durationMs: 0,
        }
      }
      const durationMs = chunkDurations.get(profile.chunkId) ?? Math.max(0, profile.durationMs ?? 0)
      const startMs = cumulativeOffsetMs
      const endMs = startMs + durationMs
      cumulativeOffsetMs = endMs
      return {
        ...profile,
        chunkStartMs: startMs,
        chunkEndMs: endMs,
        durationMs,
      }
    })

    const rebasedTotalDurationMs = decoratedVolumeProfiles.reduce(
      (max, profile) => Math.max(max, profile.chunkEndMs),
      0,
    )

    // Only retain profiles with real audio frames and coerce their timing to the verified offsets.
    const usableProfiles: ChunkVolumeProfile[] = decoratedVolumeProfiles
      .filter((profile) => profile.sessionId === session.id && profile.seq > 0 && profile.durationMs >= 0)
      .map((profile) => {
        const frameDurationMs = profile.frameDurationMs > 0 ? profile.frameDurationMs : FALLBACK_FRAME_DURATION_MS
        const frameCount = profile.frames.length > 0
          ? profile.frames.length
          : Math.max(1, Math.round(profile.durationMs / frameDurationMs) || 1)
        const frames = profile.frames.length > 0 ? profile.frames : new Array(frameCount).fill(0)
        return {
          chunkId: profile.chunkId,
          sessionId: profile.sessionId,
          seq: profile.seq,
          chunkStartMs: profile.chunkStartMs,
          chunkEndMs: profile.chunkEndMs,
          durationMs: Math.max(0, profile.durationMs ?? 0),
          sampleRate: profile.sampleRate,
          frameDurationMs,
          frames,
          maxNormalized: profile.frames.length > 0 ? profile.maxNormalized : 0,
          averageNormalized: profile.frames.length > 0 ? profile.averageNormalized : 0,
          scalingFactor: profile.scalingFactor,
        }
      })

    // Capture the freshest timestamp so we can include it in the cache key later.
    const latestProfileUpdate = volumeProfiles.reduce(
      (max, record) => Math.max(max, record.updatedAt ?? record.createdAt ?? 0),
      0,
    )

    // Compose a cache key covering the session version, verification totals, and volume changes.
    const cacheKey = [
      session.id,
      session.chunkCount,
      session.updatedAt ?? 0,
      verification.totalVerifiedDurationMs,
      verification.status,
      latestProfileUpdate,
    ].join(':')

    // Surface the cached analysis when nothing relevant has changed.
    const cachedEntry = this.#analysisCache.get(session.id)
    if (!forceRefresh && cachedEntry && cachedEntry.cacheKey === cacheKey) {
      return {
        sessionId: session.id,
        cacheKey,
        analysis: cachedEntry.analysis,
        verification,
        chunkMetadata,
        volumeProfiles: decoratedVolumeProfiles,
      }
    }

    // If we lack usable profiles, bail out early so the caller can surface a helpful message.
    if (usableProfiles.length === 0) {
      this.#analysisCache.delete(session.id)
      return {
        sessionId: session.id,
        cacheKey,
        analysis: null,
        verification,
        chunkMetadata,
        volumeProfiles: decoratedVolumeProfiles,
      }
    }

    // Prefer the verified session duration, otherwise fall back to the stored session length.
    const totalDurationMs =
      verification.session?.durationMs ??
      (rebasedTotalDurationMs > 0
        ? rebasedTotalDurationMs
        : typeof session.durationMs === 'number' && session.durationMs > 0
          ? session.durationMs
          : undefined)

    // Ask the chunking analysis helper to generate quiet-region metadata over the sequential frames.
    const analysis = analyzeRecordingChunkingFromProfiles(usableProfiles, {
      totalDurationMs,
    })

    // Memoize successful analyses for quick developer-mode toggling.
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
      volumeProfiles: decoratedVolumeProfiles,
    }
  }

  /** Rebuilds missing chunk volume profiles so verification has the durations it needs. */
  async #regenerateMissingVolumes(
    session: SessionRecord,
    missingChunkIds: string[],
    mimeTypeHint?: string | null,
  ): Promise<void> {
    // Short-circuit when verification already has everything it needs.
    if (missingChunkIds.length === 0) {
      return
    }

    // Pull the binary blobs for the session so we can run the analysis client-side.
    const chunkData = await this.#manifest.getChunkData(session.id)
    if (chunkData.length === 0) {
      return
    }

    // Capture the init/header segment so we can prepend it when decoding MP4 chunks.
    const headerChunk = chunkData.find((chunk) => chunk.seq === 0) ?? null
    const headerBlob = headerChunk?.blob ?? null
    const headerMime = headerBlob?.type ?? session.mimeType ?? mimeTypeHint ?? 'audio/mp4'

    // Filter to the exact chunk ids we were asked to regenerate and skip header segments.
    const targets = chunkData.filter(
      (chunk) =>
        chunk.seq > 0 &&
        chunk.blob.size > 0 &&
        (chunk.timingStatus ?? DEFAULT_CHUNK_TIMING_STATUS) !== 'verified' &&
        missingChunkIds.includes(chunk.id),
    )

    for (const chunk of targets) {
      try {
        // Default to the raw blob but prepend the header when decoding fragmented MP4.
        let analysisBlob: Blob = chunk.blob
        if (headerBlob && MP4_MIME_PATTERN.test(headerMime)) {
          analysisBlob = new Blob([headerBlob, chunk.blob], {
            type: headerBlob.type || chunk.blob.type || headerMime,
          })
        }

        // Decode the chunk, compute its volume profile, and persist the result back to storage.
        const profile = await computeChunkVolumeProfile(analysisBlob, {
          chunkId: chunk.id,
          sessionId: session.id,
          seq: chunk.seq,
          chunkStartMs: chunk.startMs,
          chunkEndMs: chunk.endMs,
        })
        await this.#manifest.storeChunkVolumeProfile(profile)
      } catch (error) {
        // Log and continue so one bad chunk does not prevent the others from being regenerated.
        console.warn('[SessionChunkProvider] Failed to regenerate chunk volume profile', {
          sessionId: session.id,
          chunkId: chunk.id,
          error,
        })
      }
    }
  }
}
