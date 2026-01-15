## `whyiamstupid.md` — What exactly happens when you press Play

This document is a “trace log in English”: what the app does, in order, when you press the different **Play** buttons.

The goal is to make the “mystery” concrete:

- **Full-session play** sounds correct end-to-end.
- **Chunk play / Snip play** (in the 🐞 debug panel) can sound like it repeats the beginning, loops, or blends audio from different places.

That can only happen if those buttons are **not using the same decoding/timebase assumptions**, even if they’re reading from the same IndexedDB rows.

---

## What’s the data model (in IndexedDB)

### Sessions table: `sessions`
- Stored via `manifestService.createSession()` / `updateSession()`.
- Key: `SessionRecord.id`
- Important fields for playback:
  - `startedAt` (epoch ms)
  - `durationMs` (verified-ish, can be updated later)
  - `mimeType`
  - `chunkCount`

### Chunks table: `chunks`
- Stored via `manifestService.appendChunk(chunkRecord, blob)`
- Indexed by `by-session` (sessionId).
- Each row is a `StoredChunk`:
  - `id` = `${sessionId}-chunk-${seq}`
  - `seq` (0 = header/init-ish chunk, >0 = actual audio chunks)
  - `startMs`, `endMs` (captured/verified timing; **can be absolute epoch ms** in this codebase)
  - `blob` (the MediaRecorder output blob for that `dataavailable` event)

### Volume profiles table: `chunkVolumes`
- Stored via `manifestService.storeChunkVolumeProfile(profile)`
- Each row includes:
  - `seq`, `chunkStartMs`, `chunkEndMs`
  - `durationMs` (decoded duration of the analysis blob)
  - `frameDurationMs` (default 50ms)
  - `frames[]` (normalized per-frame “energy”)

Important: volume profiles are created by decoding a blob with `AudioContext.decodeAudioData()` in `computeChunkVolumeProfile()`. For MP4 fragments, browsers may report durations in ways that don’t match your intuitive “4 second timeslice” expectation.

---

## A. “Normal Play” (the big ▶ button on the session detail)

### UI entrypoint (React)
File: `src/App.tsx`

When you press the big playback button (the one that plays the whole recording), the app calls:

- `handlePlaybackToggle()`

### Step-by-step call chain

1) **`handlePlaybackToggle()`**
   - Ensures there is an audio source prepared.
   - Grabs `audioRef.current` (a hidden `<audio>` element in the DOM).

2) **If needed: `preparePlaybackSource()`**
   - Chooses a mime type: `selectedRecording.mimeType ?? 'audio/mp4'`.
   - Calls:
     - `manifestService.buildSessionBlob(sessionId, mimeType)`

3) **`manifestService.buildSessionBlob(sessionId, mimeType)`**
   - Opens IndexedDB (`getDB()`).
   - Reads all chunks for the session:
     - `db.transaction('chunks').store.index('by-session').getAll(sessionId)`
   - Sorts by `seq`.
   - Returns a single `Blob` built as:
     - `new Blob(ordered.map(c => c.blob), { type: mimeType })`

4) **Back in `preparePlaybackSource()`**
   - Creates an object URL:
     - `URL.createObjectURL(blob)`
   - Assigns it to the DOM `<audio>` element:
     - `audio.src = url`
     - `audio.currentTime = 0`

5) **Back in `handlePlaybackToggle()`**
   - If paused: `audio.play()`
   - Else: `audio.pause()`

### What happens while it “moves through chunks”

This is the key point:

- The “normal play” path does **not** “play chunk 1 then load chunk 2 then…”.
- It hands the browser a **single Blob URL** and then the browser’s MP4 demuxer/decoder plays it as one stream.
- The app does not manually stitch or schedule chunk boundaries.

### How does it know playback is progressing / ended
React attaches listeners to `audioRef.current`:

- `timeupdate` → updates `audioState.position`
- `durationchange` → updates `audioState.duration`
- `play/pause/ended` → updates `audioState.playing`

So “finished” is just the browser firing `ended`.

### Why this can sound correct even if chunk-by-chunk sounds wrong

Because the browser is decoding a single stream. Any oddities in individual chunk blobs (cumulative timestamps, edit lists, etc.) can be resolved differently when:

- the MP4 is concatenated, and
- the demuxer can see a continuous timeline.

This path is “closest to what the browser expects”.

---

## B. 🐞 Debug panel → “Chunks” → per-row Play

File: `src/App.tsx`

The chunk list rows call:

- `handleChunkPlayToggle(chunk)`

### The old (problematic) mental model
“Each chunk row plays only that chunk’s audio from 0..4 seconds.”

### What actually happens in browsers that emit cumulative MP4 chunks
Some MediaRecorder implementations can output “chunks” where each `dataavailable` blob is effectively:

- chunk 1 blob: audio 0..t1
- chunk 2 blob: audio 0..t2
- chunk 3 blob: audio 0..t3

Even though we *intend* timeslices, the blob content can be cumulative in time.

If you then do:

- createObjectURL(chunk2.blob)
- `audio.currentTime = 0`
- play for 4 seconds

you will hear **the beginning of the recording again**.

That’s exactly your symptom: “chunk 2 starts with the beginning of chunk 1”.

### What the code does today (current branch state)

To make this path robust (and simpler), we changed debug chunk playback to **not play the MP4 chunk blob directly**.

Instead it:

1) Computes the chunk’s time window in “session offset ms”:
   - base start = `seq0.startMs` (header) or `session.startedAt`
   - `startOffsetMs = chunk.startMs - baseStartMs`
   - `endOffsetMs = chunk.endMs - baseStartMs`

2) Uses the same range-extraction API as snips/doctor:
   - `recordingSlicesApi.getRangeAudio(session, startOffsetMs, endOffsetMs)`

3) That returns a **WAV** blob for exactly that time span.

4) Creates `URL.createObjectURL(wavBlob)` and plays it with `new Audio(url)` from t=0.

### Why chunk 2 used to differ from chunk 1 / chunk 3

If the browser makes cumulative blobs, then:

- chunk 1 (0..t1) played at t=0 sounds “right”
- chunk 2 (0..t2) played at t=0 repeats the beginning
- chunk 3 repeats even more

So the *difference* is not “our code treats chunk2 differently” — it’s that the blob content is different: it’s cumulative.

---

## C. 🐞 Debug panel → “Snips” → per-row Play

File: `src/App.tsx`

Snips are derived from `SessionAnalysisProvider` (volume profiles → analysis frames → boundaries → segments).

When you press snip Play:

- `handleSnipPlayToggle(segment)`

### Step-by-step

1) `handleSnipPlayToggle(segment)` resolves a URL via `ensureSnipPlaybackUrl(segment)`
2) `ensureSnipPlaybackUrl` calls `ensureSnipSlice(segment)`
3) `ensureSnipSlice` calls:
   - `recordingSlicesApi.getRangeAudio(session, segment.startMs, segment.endMs)`
4) That returns a **WAV** blob.
5) The UI plays that WAV blob from t=0 using `new Audio(url)`.

### Why snips could “loop the first second” (the classic symptom)

There are two distinct failure modes we’ve seen in this repo:

#### 1) **Range extraction is wrong**
If range extraction maps “session time” to “chunk time” incorrectly (especially with cumulative blobs), you can repeatedly extract from near t=0.

That produces audio that is “there once was a…” over and over, because the extracted buffer is effectively the same first second.

This is why `recordingSlicesApi` had to learn about cumulative chunks and, when detected, slice by absolute session offsets inside a single cumulative buffer (instead of subtracting chunk start offsets and stitching).

#### 2) **Caching key collisions**
If the app uses a cache key that collides across snips, multiple snip rows can reuse the same URL/blob.

Example: `Math.round(startMs)` based keys can collide when boundaries are close or fractional.

That’s why snip caching keys were moved to stable identifiers (e.g. `snip-${segment.index}`).

---

## D. Why “full play works” but “chunk/snip play fails” (the short diagnosis)

Full play:
- Uses `manifestService.buildSessionBlob()` → one MP4 blob → browser decodes as a continuous stream.

Chunk/snip play:
- Works in **session offset space**, and must map offsets to the right decoded audio samples.
- If the underlying MediaRecorder blobs are cumulative, naive “play blob from t=0” or naive offset mapping will replay the beginning.

So the app needs to either:

- treat chunk blobs as *containers that may contain other times* (cumulative), or
- avoid MP4 fragment playback for debug buttons and always play extracted WAV ranges.

This repo is moving toward the second approach for debug buttons because it’s deterministic and debuggable.

---

## E. The exact “mystery” you described

> Full play is perfect. Chunk 1 plays fine. Chunk 2 starts with a snippet from the beginning of chunk 1, then continues with its own stuff.

That is exactly what you get when:

- chunk2’s underlying blob includes audio starting at 0 (cumulative timeline),
- and the UI plays chunk2 starting at t=0,
- or slices chunk2 using an offset mapping that assumes the blob starts at the chunk’s start time.

The correct fixes are:

- detect “cumulative chunk” behavior and slice by absolute session offsets; and/or
- switch debug playback to generated WAV slices so playback is always “play exactly these samples”.

---

## F. Where to look in code (quick pointers)

- **Full play:**
  - `src/App.tsx` → `handlePlaybackToggle()` → `preparePlaybackSource()`
  - `src/modules/storage/manifest.ts` → `buildSessionBlob()`

- **Chunk debug play:**
  - `src/App.tsx` → `handleChunkPlayToggle()`
  - `src/modules/playback/recording-slices.ts` → `getRangeAudio()` / range decoding helpers

- **Snip debug play:**
  - `src/App.tsx` → `handleSnipPlayToggle()` → `recordingSlicesApi.getRangeAudio()`
  - `src/modules/analysis/session-analysis-provider.ts` → volume profile concatenation

