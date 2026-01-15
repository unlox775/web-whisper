import {
  analyzeSessionFromFrames,
  DEFAULT_SESSION_ANALYSIS_CONFIG,
  type SessionAnalysis,
  type VolumeFrame,
} from './session-analysis'
import {
  manifestService,
  type ManifestService,
  type SessionRecord,
  type SessionTimingVerificationResult,
  type ChunkVolumeProfileRecord,
} from '../storage/manifest'
import { computeChunkVolumeProfile } from '../storage/chunk-volume'

export interface SessionAnalysisResult {
  sessionId: string
  cacheKey: string
  analysis: SessionAnalysis | null
  verification: SessionTimingVerificationResult
  frames: VolumeFrame[]
}

export interface PrepareSessionAnalysisOptions {
  session: SessionRecord
  forceRefresh?: boolean
  mimeTypeHint?: string | null
}

const MP4_MIME_PATTERN = /mp4|m4a/i
const ANALYSIS_TIMELINE_VERSION = 2

export class SessionAnalysisProvider {
  #manifest: ManifestService
  #initialized = false
  #verificationInflight = new Map<string, Promise<SessionTimingVerificationResult>>()
  #analysisCache = new Map<string, { cacheKey: string; analysis: SessionAnalysis; frames: VolumeFrame[] }>()

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

  async prepareAnalysisForSession(options: PrepareSessionAnalysisOptions): Promise<SessionAnalysisResult> {
    const { session, forceRefresh = false } = options

    await this.#ensureInit()

    let verification = await this.ensureTimings(session.id)
    if (verification.status !== 'verified' && verification.missingChunkIds.length > 0) {
      await this.#regenerateMissingVolumes(session, verification.missingChunkIds, options.mimeTypeHint)
      verification = await this.ensureTimings(session.id)
    }

    const volumeProfilesRaw = await this.#manifest.listChunkVolumeProfiles(session.id)
    const orderedProfiles = volumeProfilesRaw
      .filter((profile) => profile.sessionId === session.id && profile.seq > 0)
      .sort((a, b) => a.seq - b.seq)

    const latestProfileUpdate = orderedProfiles.reduce(
      (max, record) => Math.max(max, record.updatedAt ?? record.createdAt ?? 0),
      0,
    )

    const cacheKey = [
      `timeline-v${ANALYSIS_TIMELINE_VERSION}`,
      session.id,
      session.chunkCount,
      session.updatedAt ?? 0,
      verification.totalVerifiedDurationMs,
      verification.status,
      latestProfileUpdate,
    ].join(':')

    if (!forceRefresh) {
      const cached = this.#analysisCache.get(session.id)
      if (cached && cached.cacheKey === cacheKey) {
        return {
          sessionId: session.id,
          cacheKey,
          analysis: cached.analysis,
          verification,
          frames: cached.frames,
        }
      }
    }

    const chunkRows = await this.#manifest.getChunkMetadata(session.id)
    const orderedChunks = [...chunkRows].filter((chunk) => chunk.seq > 0).sort((a, b) => a.seq - b.seq)

    const durationsBySeq = new Map<number, number>()
    orderedChunks.forEach((chunk) => {
      const verified =
        typeof chunk.verifiedAudioMsec === 'number' && chunk.verifiedAudioMsec > 0 ? Math.round(chunk.verifiedAudioMsec) : 0
      const fallback = Math.max(0, Math.round(chunk.endMs - chunk.startMs))
      const duration = verified > 0 ? verified : fallback
      durationsBySeq.set(chunk.seq, duration)
    })

    // If we have volume profiles missing, we still want the analysis timeline to span the whole
    // verified session. We'll pad missing chunks with zero frames.
    const durationLimitMs =
      typeof verification.totalVerifiedDurationMs === 'number' && verification.totalVerifiedDurationMs > 0
        ? Math.round(verification.totalVerifiedDurationMs)
        : orderedChunks.reduce((sum, chunk) => sum + Math.max(0, Math.round(chunk.endMs - chunk.startMs)), 0)

    const profilesBySeq = new Map<number, ChunkVolumeProfileRecord>()
    orderedProfiles.forEach((profile) => {
      profilesBySeq.set(profile.seq, profile)
    })

    const { frames, sampleRate, frameDurationMs, totalDurationMs } = this.#concatVolumeProfiles({
      orderedChunkSeq: orderedChunks.map((chunk) => chunk.seq),
      profilesBySeq,
      durationsBySeq,
      durationLimitMs,
    })

    const analysis = frames.length > 0
      ? analyzeSessionFromFrames(frames, {
          totalDurationMs,
          sampleRate,
          frameDurationMs,
        })
      : null

    if (analysis) {
      this.#analysisCache.set(session.id, { cacheKey, analysis, frames })
    } else {
      this.#analysisCache.delete(session.id)
    }

    return {
      sessionId: session.id,
      cacheKey,
      analysis,
      verification,
      frames,
    }
  }

  #concatVolumeProfiles({
    orderedChunkSeq,
    profilesBySeq,
    durationsBySeq,
    durationLimitMs,
  }: {
    orderedChunkSeq: number[]
    profilesBySeq: Map<number, ChunkVolumeProfileRecord>
    durationsBySeq: Map<number, number>
    durationLimitMs: number
  }) {
    let cumulativeOffsetMs = 0
    const frames: VolumeFrame[] = []
    let frameIndex = 0
    let sampleRate = 0
    let frameDurationMs = DEFAULT_SESSION_ANALYSIS_CONFIG.frameDurationMs

    orderedChunkSeq.forEach((seq) => {
      const profile = profilesBySeq.get(seq) ?? null
      const framesArray = profile && Array.isArray(profile.frames) ? profile.frames : []
      const segmentFrameDuration =
        profile && profile.frameDurationMs > 0 ? profile.frameDurationMs : DEFAULT_SESSION_ANALYSIS_CONFIG.frameDurationMs

      // Prefer the chunk timing range (captured/verified) over decoded durationMs. We've observed
      // decodeAudioData sometimes returning inflated durations for individual fragments due to
      // timestamp/edit-list quirks, which can cause the analysis timeline (and thus snips) to run
      // beyond the real session audio length.
      const timingDurationMs = durationsBySeq.get(seq) ?? 0
      const fallbackDurationMs = Math.max(0, Math.round((profile?.durationMs ?? 0) || framesArray.length * segmentFrameDuration))
      const durationMs = timingDurationMs > 0 ? timingDurationMs : fallbackDurationMs
      if (durationLimitMs > 0 && cumulativeOffsetMs >= durationLimitMs) {
        return
      }
      const startMs = cumulativeOffsetMs
      const clampedDurationMs =
        durationLimitMs > 0 ? Math.max(0, Math.min(durationMs, durationLimitMs - cumulativeOffsetMs)) : durationMs

      const expectedFrameCount = clampedDurationMs > 0 ? Math.ceil(clampedDurationMs / segmentFrameDuration) : framesArray.length
      const usableFrameCount = Math.max(0, Math.min(framesArray.length, expectedFrameCount))

      for (let idx = 0; idx < usableFrameCount; idx += 1) {
        const value = framesArray[idx]
        const clampedValue = Number.isFinite(value) ? Math.max(0, value) : 0
        const frameStart = startMs + idx * segmentFrameDuration
        const frameEnd = Math.min(startMs + clampedDurationMs, frameStart + segmentFrameDuration)
        frames.push({
          index: frameIndex,
          startMs: frameStart,
          endMs: frameEnd,
          rms: clampedValue,
          normalized: clampedValue,
        })
        frameIndex += 1
      }

      // If the stored profile has fewer frames than expected, pad with zeros so subsequent
      // segments don't shift earlier than their chunk timing implies.
      for (let idx = usableFrameCount; idx < expectedFrameCount; idx += 1) {
        const frameStart = startMs + idx * segmentFrameDuration
        const frameEnd = Math.min(startMs + clampedDurationMs, frameStart + segmentFrameDuration)
        if (frameEnd <= frameStart) {
          break
        }
        frames.push({
          index: frameIndex,
          startMs: frameStart,
          endMs: frameEnd,
          rms: 0,
          normalized: 0,
        })
        frameIndex += 1
      }
      cumulativeOffsetMs += clampedDurationMs
      frameDurationMs = segmentFrameDuration
      if (sampleRate === 0 && profile && profile.sampleRate > 0) {
        sampleRate = profile.sampleRate
      }
    })

    return {
      frames,
      sampleRate,
      frameDurationMs,
      totalDurationMs: durationLimitMs > 0 ? Math.min(cumulativeOffsetMs, durationLimitMs) : cumulativeOffsetMs,
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
      (chunk) => chunk.seq > 0 && chunk.blob.size > 0 && missingChunkIds.includes(chunk.id),
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
        console.warn('[SessionAnalysisProvider] Failed to regenerate chunk volume profile', {
          sessionId: session.id,
          chunkId: chunk.id,
          error,
        })
      }
    }
  }
}
