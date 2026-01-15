## `whyiamstupid.md` — What exactly happens when you press Play

This document is a strict, **function-by-function execution trace** of what the UI does when you press:

- **A)** the “normal” session Play button (plays the entire recording)
- **B)** the 🐞 debug panel “Chunks” per-row Play button (plays exactly the stored chunk blob for that row)

Nothing else is described here (no snips).

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

### What is read from IndexedDB, and when

There are **two separate times** IndexedDB is touched:

1) **When the detail view opens** (not when you press the per-row Play button):
   - `useEffect([selectedRecordingId])` runs in `src/App.tsx`
   - It calls `manifestService.getChunkData(selectedRecordingId)`
   - That performs the IndexedDB query:
     - `db.transaction('chunks').store.index('by-session').getAll(sessionId)`
   - React state `chunkData` is set to the result (sorted by `seq` inside `getChunkData()`).

2) **When you press the per-row Play button**:
   - The UI does **not** query IndexedDB again.
   - It uses the `StoredChunk` object already in memory (from `chunkData`), including `chunk.blob`.

### Step-by-step call chain (exact functions in order)

When you click the Play button on a chunk row, these functions run (in order):

1) **React click handler**
   - `onClick={() => void handleChunkPlayToggle(chunk)}`

2) **`handleChunkPlayToggle(chunk)`** (in `src/App.tsx`)
   - Reads:
     - `chunk.id`
     - `chunk.seq`
     - `chunk.blob`
   - Uses:
     - `chunkAudioRef.current` (a `Map<string, ChunkPlaybackEntry>`) to track currently playing chunk-audios.

3) **Stop/pause any prior per-chunk playback**
   - Iterates `chunkAudioRef.current.entries()`
   - For each prior entry:
     - calls `entry.cleanup()`
     - calls `entry.audio.pause()`
     - resets `entry.audio.currentTime = entry.startTime`
     - removes it from the map

4) **Header chunk guard**
   - Calls `isHeaderSegment(chunk)`
   - If true, returns early (header/init segment is not played)

5) **Resolve a blob URL for *that exact chunk blob***
   - Calls `ensureChunkPlaybackUrl(chunk)`
   - `ensureChunkPlaybackUrl`:
     - checks `chunkUrlMapRef.current.get(chunk.id)`
     - if missing, calls `createChunkCompositeBlob(chunk)`

6) **`createChunkCompositeBlob(chunk)`**
   - If the recording is MP4-like and there is a header/init chunk (`headerChunk`), it may return:
     - `new Blob([headerChunk.blob, chunk.blob], { type: mimeType })`
   - Otherwise it returns:
     - `chunk.blob`

7) **`ensureChunkPlaybackUrl` creates a URL**
   - Calls `URL.createObjectURL(blob)`
   - Stores it in `chunkUrlMapRef.current.set(chunk.id, url)`
   - Returns the URL

8) **Create a dedicated audio element for this chunk**
   - `const audio = new Audio()`
   - `audio.src = url`
   - `audio.volume = playbackVolume`

9) **Stop the “normal play” audio element**
   - `audioRef.current?.pause()`
   - (This is the *full-session* `<audio>` element; chunk playback uses its own `new Audio()`.)

10) **Attach completion/error listeners**
   - `audio.addEventListener('ended', handlePlaybackComplete)`
   - `audio.addEventListener('error', handlePlaybackComplete)`
   - `handlePlaybackComplete()` calls `finishPlayback()` which:
     - pauses the audio
     - resets `audio.currentTime = 0`
     - removes the entry from `chunkAudioRef.current`
     - clears the UI “playing” state

11) **Record the playback entry**
   - `chunkAudioRef.current.set(chunk.id, { audio, cleanup, startTime: 0, endTime: 0 })`
   - (Note: `endTime` is not used to truncate playback here; it plays the blob until `ended`.)

12) **Start playback**
   - `audio.currentTime = 0`
   - `await audio.play()`
   - `setChunkPlayingId(chunk.id)` so the UI row shows “pause”

### “Difference between chunk 2 and chunk 3”

There is no “special-casing” logic in the click handler for chunk 2 vs chunk 3.

If chunk 2 sounds like “a snippet from the beginning of chunk 1” mixed into it, the only ways that can happen (given the flow above) are:

- **The blob stored in IndexedDB for that chunk row actually contains that audio** (for example, cumulative MediaRecorder blobs); or
- **The header/init segment prepending** changes what the decoder outputs when decoding the chunk blob (MP4 timing metadata), even though we are still “playing that blob”.

The chunk debug button is intentionally “dumb” in the sense that it is playing the bytes of that chunk blob (plus optional header) and letting the browser decode it as-is.

---
## Why “Normal Play” can be correct while “Chunk Play” is weird

Given the traces above:

- Normal play decodes a **single concatenated Blob** for the whole session.
- Chunk play decodes **one selected chunk blob** (optionally with the init/header prepended).

If the content of “chunk 2 blob” is not “only chunk 2’s audio”, but instead contains some earlier audio (or has MP4 timing metadata that makes the decoder render earlier audio), then **chunk play will surface that**, while normal play may still sound correct when decoding the full stream.

