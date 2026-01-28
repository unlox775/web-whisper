## Back to the Drawing Board — Streaming audio, “chunks”, and what you can actually guarantee

This doc explains the flaw in the original mental model (“chunks are independent contiguous PCM slices”) and lays out what *is* possible for:

- live playback while recording
- live analysis (quiet gaps / snips)
- confidence that the audio is “complete up through time X”
- eventually discarding old audio without stopping recording

---

## 1) The core mistake: treating MediaRecorder “chunks” as PCM slices

When you use `MediaRecorder` with `mimeType: audio/mp4`, the browser gives you **encoded MP4 fragments**, not raw samples.

Two important consequences:

1) **The blob boundary is not a semantic “audio boundary”.**
   - A `dataavailable` blob is “some container bytes” that the browser decided to emit at that time.

2) **Playback order is not defined by blob order alone; it’s defined by timestamps inside the container.**
   - MP4 has timing metadata (PTS/DTS / fragment decode times).
   - A later-emitted blob can contain frames whose timestamps overlap earlier frames, or be “rebased” in a way that makes it non-self-contained.

This is not RAID. It’s not “rewriting audio to reduce size.” It’s simply how a timestamped container stream works:

- The browser/encoder emits fragments.
- The demuxer builds a single timeline from timestamps.
- Fragments are not guaranteed to be independently playable clips.

---

## 2) Why “full play works” even if “play chunk N” is weird

### Full-session play
This app currently builds:

- `Blob([chunk0, chunk1, chunk2, ...])` and plays it as one MP4 file.

The browser demuxer sees all fragments and constructs one consistent timeline. If there are overlaps, the demuxer may:

- de-overlap / ignore duplicate timestamped samples
- resolve edits / priming in a way that sounds continuous

### Per-chunk play
If you try to play a single fragment as if it were a standalone MP4 file, the demuxer may:

- rebase timestamps to start at 0
- treat the fragment differently without prior context

So “chunk N” is **not a reliable unit of audible time** unless you convert to PCM and treat time explicitly.

---

## 3) What you actually want (restated as requirements)

You want a system that can:

1) Capture audio indefinitely (hours/days).
2) Provide **live confidence** that audio is “complete up to time X”.
3) Analyze “quiet spots” and create snips.
4) Send stable snips to transcription while recording continues.
5) Eventually delete old audio once it’s processed, without stopping capture.

This is fundamentally a **stream processing** problem. The “unit” you need is a stable prefix of PCM time, not MP4 fragment boundaries.

---

## 4) Two viable architectures (choose one)

### Option A (recommended): capture PCM yourself, then encode/store what you need

Use the Web Audio graph:

- `getUserMedia` → `AudioWorklet` (or `ScriptProcessor` fallback) → stream PCM frames into JS

From PCM you can:

- maintain a monotonic “sample index” timeline (ground truth time)
- compute volume frames in real time (your analysis already works on frames)
- declare “complete up to time X” based on the PCM you have in your ring buffer
- cut snips precisely (PCM sample slicing)
- send WAV/PCM/Opus to transcription with deterministic boundaries
- drop old PCM once it’s processed

You can still *also* run MediaRecorder for archival MP4 if you want, but you don’t depend on MP4 fragments for correctness.

This is the cleanest path to “eventual consistency” and deletion.

### Option B: stay in MP4 land, but treat it as streaming media (MSE pipeline)

If you insist on MP4 fragments:

- Use **Media Source Extensions (MSE)**:
  - create a `MediaSource`, append MP4 fragments to a `SourceBuffer`
  - track `sourceBuffer.buffered` ranges

This gives you:

- live playback with a real streaming timeline
- a way to ask: “do I have buffered media from 0..X?”

But: transcription and snipping still require either:

- decoding via WebCodecs incrementally (hard), or
- extracting and decoding stable ranges (still tricky with fMP4)

Also MSE isn’t uniformly great on iOS for all cases.

---

## 5) “Complete up through X seconds” (how to define it)

You need a definition of *stability*.

### If you capture PCM (Option A)
It’s simple:

- If you have PCM samples from sample 0..N, then audio is complete to \(N / sampleRate\).

You can keep:

- `stablePcmEndMs`
- only create snips/transcription jobs for ranges fully below that boundary

### If you stay on MP4 fragments (Option B)
You need a stability rule like:

- “We consider 0..X stable if the streaming timeline reports buffered coverage for 0..X and we haven’t seen new overlapping fragments for some trailing window.”

In practice, you still end up reinventing a PCM timeline if you need reliable cut points for transcription.

---

## 6) Deleting old audio without stopping capture

### Option A (PCM)
Maintain:

- a PCM ring buffer (or chunked PCM store)
- a pointer `processedUpToMs`
- delete PCM older than `processedUpToMs - safetyMarginMs`

### Option B (MP4)
You generally cannot safely delete arbitrary fragments and expect the remaining MP4 fragments to decode correctly unless you:

- keep required init segments
- keep necessary “decoder state” dependencies
- keep enough keyframes/priming context

For audio it’s sometimes doable, but implementation complexity is high and browser-dependent.

---

## 7) What went wrong in *our* current implementation

Right now, we are using MP4 MediaRecorder blobs for:

- archival playback (works when concatenated)
- per-chunk debug playback (not guaranteed)
- analysis volume profiles (decoding individual fragments; can inflate durations on some browsers)

That’s why you saw symptoms like:

- per-chunk play repeating early audio
- volume profile durations not matching expected timeslice durations
- analysis timeline drift / truncation depending on missing profiles

Those are all natural consequences of treating MP4 fragments as independently meaningful time slices.

---

## 8) Concrete next step

If your long-term goal is “record for hours and stream snips to transcription”, the best next step is:

1) Add an `AudioWorklet` PCM capture path that produces:
   - monotonic sample timeline
   - rolling volume frames
2) Build snips and transcription strictly from PCM-derived time.
3) Keep MP4 MediaRecorder only as an optional archive artifact.

That is the “back to the drawing board” direction that makes the whole system deterministic and debuggable.

