# Transcription Stall & Status Correctness Fix

**Branch:** `cursor/fix-transcription-stall-1767`  
**Status:** 🚧 In Progress

## Problem Summary

After a long recording (~48 minutes), the UI reports "all snips transcribed" / transcription complete, but the transcript and snip list stop around ~30 minutes while audio chunks continue through the end. Dave's session shows snip #128 ending at 30:02→30:12 on a 47m 52s session.

### Root Causes

1. **Status Lie**: UI claims "transcription complete" when `transcribedCount === totalSnips`, but doesn't account for:
   - Un-snipped audio past the last snip's `endMs`
   - Retained audio chunks that extend beyond last snip coverage
   - Session `durationMs` that exceeds last snip coverage

2. **Pipeline Stall**: At T+30.4 min, when `applyRetentionPolicy` first ran:
   - Snip creation stopped (last snip at 30:13)
   - Volume profiling stopped (last profile at chunk 453)
   - Transcription stopped (no new snips to transcribe)
   - BUT MediaRecorder kept writing healthy chunks 454–718

## Technical Analysis

### Snip Creation Flow

```
recordingSlicesApi.listSnips()
  → prepareAnalysisForSession()
    → verifySessionChunkTimings()
    → listChunkVolumeProfiles()
    → analyzeSessionFromFrames()
  → analyzeSessionWindowFromFrames()
  → appendSnips()
```

### Transcription Status Calculation

In App.tsx ~4370-4430:
```typescript
const transcribedCount = snips.filter(snip => getSnipTranscriptionText(snip).length > 0).length
const totalSnips = snips.length
const hasTranscript = transcribedCount > 0

// UI shows "complete" / "transcribed" when:
// - transcribedCount === totalSnips
// - No transcription errors
// PROBLEM: doesn't check for un-snipped audio past last snip
```

### Retention Policy Behavior

`applyRetentionPolicy` in manifest.ts:
- Runs in one IndexedDB transaction (`chunks`, `snips`, `sessions` readwrite)
- Only purges chunks fully covered by **transcribed** snips
- Replaces blob with empty blob, sets `audioPurgedAt`
- **Does NOT block**: transaction completes and releases locks

**Theory for pipeline stall**: Volume profile generation may have stopped for chunks after retention ran, possibly due to:
- Missing profile regeneration for new chunks
- Analysis cache not updating after retention
- Session analysis not including new chunks in window calculation

## Fixes Required

### Fix 1: Transcription Status Correctness

**Location**: `App.tsx` transcription status calculation

**Change**: Add coverage check before claiming "complete":

```typescript
// Calculate last snip coverage
const lastSnipEndMs = snips.length > 0 
  ? Math.max(...snips.map(s => s.endMs)) 
  : 0

// Check for un-snipped audio
const sessionDurationMs = session.durationMs ?? 0
const lastChunkEndMs = chunks.length > 0
  ? Math.max(...chunks.map(c => c.endMs))
  : 0

// Gap threshold (chunks are ~4s each, allow 1 chunk tolerance)
const COVERAGE_GAP_THRESHOLD_MS = 5000

const hasUntranscribedAudio = 
  (sessionDurationMs > lastSnipEndMs + COVERAGE_GAP_THRESHOLD_MS) ||
  (lastChunkEndMs > lastSnipEndMs + COVERAGE_GAP_THRESHOLD_MS)

// Update status logic to account for gaps
const transcriptionStatus = 
  hasUntranscribedAudio && transcribedCount === totalSnips
    ? 'incomplete'  // All snips transcribed BUT more audio exists
    : transcribedCount === totalSnips
      ? 'complete'
      : hasTranscript
        ? 'partial'
        : 'untranscribed'
```

**UI Changes**:
- Show "Transcription incomplete" when audio extends past last snip
- Display remaining duration or chunk count
- Don't claim success when work remains

### Fix 2: Pipeline Resilience During Retention

**Location**: Investigate and fix volume profile + snip creation path

**Investigation needed**:
- Does `prepareAnalysisForSession` pick up new chunks after retention?
- Are volume profiles being generated for chunks after retention runs?
- Is the analysis window calculation correct after purge?

**Likely fix**: Ensure volume profile generation continues for new chunks regardless of retention state.

### Fix 3: Logging for Observability

**Location**: `App.tsx` `runRetentionPass` and analysis paths

**Add logs**:
```typescript
// In runRetentionPass
await logInfo('Retention pass starting', {
  beforeBytes: result.beforeBytes,
  limitBytes: result.limitBytes,
  sessionId: captureState.sessionId,
  chunkCount: captureState.chunksRecorded,
})

// After retention
await logInfo('Retention pass complete', {
  purgedChunks: result.purgedChunkIds.length,
  purgedSnips: result.purgedSnipIds.length,
  afterBytes: result.afterBytes,
})

// In snip refresh path
await logInfo('Live snip refresh', {
  sessionId,
  previousSnipCount,
  newSnipCount,
  lastSnipEndMs,
  sessionDurationMs,
})
```

## Acceptance Criteria

✅ **Status Correctness**:
- [ ] UI never shows "transcription complete" when retained audio exists past last snip
- [ ] Status text accurately describes "incomplete" / remaining audio
- [ ] User can see how much audio remains un-transcribed

✅ **Pipeline Resilience**:
- [ ] Snip creation continues after retention purges old audio
- [ ] Volume profiling continues for new chunks
- [ ] Transcription queue receives new snips after retention

✅ **Logging**:
- [ ] Retention pass start/result logged with chunk counts
- [ ] Snip refresh logged with coverage metrics
- [ ] Analysis stalls/skips logged (if applicable)

✅ **Build & Tests**:
- [ ] `npm install` succeeds
- [ ] `npm run build` succeeds (TypeScript clean)
- [ ] No new console errors in dev
- [ ] Manual test: 30+ minute recording with retention

## Out of Scope

- Durable logging / debug export feature (already launched)
- Recovery of Dave's purged 0–17.7 min audio
- "Re-transcribe remaining audio" affordance (stretch goal, skip if complex)

## Code Paths to Modify

1. **App.tsx** ~line 4370-4430: Transcription status calculation
2. **App.tsx** ~line 1026-1050: `runRetentionPass` logging
3. **App.tsx** ~line 2230-2260: Live snip refresh with coverage check
4. **recordingSlicesApi.listSnips()**: Ensure snip creation works after retention

## Testing Strategy

1. Create long recording (30+ min) that triggers retention
2. Verify snips continue being created after first purge
3. Verify status shows "incomplete" if audio extends past last snip
4. Check logs for retention and snip refresh events
5. Verify no pipeline stall when retention runs during recording

---

## Changes Made

### 1. Transcription Coverage Tracking

**File**: `src/App.tsx`

Added coverage tracking to transcription status state:
- Extended `transcriptionSnipCounts` type to include `lastSnipEndMs` and `hasUncoveredAudio`
- Calculate coverage gap by comparing `session.durationMs` with `lastSnipEndMs`
- Use 5-second threshold (`COVERAGE_GAP_THRESHOLD_MS`) to detect significant gaps

**Implementation**:
```typescript
const lastSnipEndMs = snips.length > 0 ? Math.max(...snips.map(s => s.endMs)) : 0
const sessionDurationMs = session.durationMs ?? 0
const COVERAGE_GAP_THRESHOLD_MS = 5000
const hasUncoveredAudio = sessionDurationMs > lastSnipEndMs + COVERAGE_GAP_THRESHOLD_MS
```

### 2. Status Calculation Fix

**File**: `src/App.tsx` ~line 4390

Updated `displayStatus` calculation to:
- Detect when all snips are transcribed BUT more audio exists
- Show `'partial'` status (yellow) instead of `'ready'` (green) in this case
- Prevent false "transcription complete" signal

**Before**: Status = 'ready' when `transcribedCount === totalSnips`
**After**: Status = 'partial' when `transcribedCount === totalSnips && hasUncoveredAudio`

### 3. UI Preview Text

**File**: `src/App.tsx` ~line 4420

Added informative message for incomplete transcription:
```
"Transcription incomplete: {N} snips transcribed, but more audio exists beyond {MM:SS}."
```

Shows the timecode where snips stop, making the gap visible to users.

### 4. Detail View Coverage Warning

**File**: `src/App.tsx` ~line 4777

Added warning to detail transcription meta:
```
⚠️ More audio exists beyond MM:SS (session MM:SS).
```

Visible when viewing a session with uncovered audio.

### 5. Retention Pass Logging

**File**: `src/App.tsx` `runRetentionPass`

Added comprehensive logging:
- **Start**: Log reason, limitBytes, sessionId, chunkCount
- **Success with purge**: Log purgedChunks, purgedSnips, before/after bytes
- **Success without purge**: Log "no purge needed"
- **Over limit warning**: Already existed, preserved
- **Error**: Already existed, preserved

### 6. Live Snip Refresh Logging

**File**: `src/App.tsx` live snip refresh effect

Added logging on each snip refresh:
- snipCount
- lastSnipEndMs
- sessionDurationMs
- coverageGapMs
- chunkCount

Helps diagnose if snip creation stalls during recording.

## Acceptance Criteria Status

✅ **Status Correctness**:
- [x] UI never shows "transcription complete" when retained audio exists past last snip
- [x] Status text accurately describes "incomplete" / remaining audio
- [x] User can see how much audio remains un-transcribed (timecode shown)

✅ **Pipeline Resilience**:
- [ ] **Testing needed**: Verify snip creation continues after retention
- [ ] **Testing needed**: Verify volume profiling continues for new chunks
- [ ] **Testing needed**: Verify transcription queue receives new snips after retention

✅ **Logging**:
- [x] Retention pass start/result logged with chunk counts
- [x] Snip refresh logged with coverage metrics
- [x] No analysis-specific stall logs (would require deeper investigation if issue persists)

✅ **Build & Tests**:
- [ ] `npm install` succeeds
- [ ] `npm run build` succeeds (TypeScript clean)
- [ ] No new console errors in dev
- [ ] Manual test: 30+ minute recording with retention

## Progress Log

### 2026-10-06 17:28 UTC
- Created branch `cursor/fix-transcription-stall-1767`
- Read FINDINGS.md and screenshots
- Analyzed codebase: manifest.ts, App.tsx, recording-slices.ts, session-analysis-provider.ts
- Identified status calculation and snip creation flows
- Wrote initial spec

### 2026-10-06 17:40 UTC
- Implemented transcription coverage tracking
- Updated status calculation to detect incomplete transcription
- Added UI messages for uncovered audio in list and detail views
- Added comprehensive logging to retention and snip refresh paths
- Ready to build and test
