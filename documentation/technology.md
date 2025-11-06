# Browser Technology Primer

*Audience: curious engineers and product partners who want a plain-English description of the moving parts involved in Web Whisper’s audio capture. Every section includes links to introductory resources for further reading.*

## 1. Building Blocks the Browser Exposes

| Concept | What it is | Why we use it | Learn more |
| --- | --- | --- | --- |
| **MediaDevices.getUserMedia** | A JavaScript promise that asks the operating system for access to microphones and cameras. It returns a `MediaStream` when the user grants permission. | This is the entry point for every recording session. Without a `MediaStream`, nothing else can happen. | [MDN: getUserMedia](https://developer.mozilla.org/docs/Web/API/MediaDevices/getUserMedia) |
| **MediaStream** | A logical “hose” of media tracks (audio, video, or both). Each track is managed by the browser’s media subsystem and ultimately fed by the OS audio driver. | We attach the stream to `MediaRecorder` (for encoded chunks) and — later — to `AudioContext` when we add real-time analysis. | [MDN: MediaStream](https://developer.mozilla.org/docs/Web/API/MediaStream) |
| **MediaRecorder** | A high-level encoder that converts a `MediaStream` into compressed files or chunks (`Blob` objects) in the background. | It saves us from implementing codecs; browsers ship with AAC (MP4) and Opus (WebM) encoders. We ask for 4-second chunks and get `Blob`s without blocking the UI thread. | [MDN: MediaRecorder](https://developer.mozilla.org/docs/Web/API/MediaRecorder) |
| **Blob** | A “Binary Large Object” abstraction representing a chunk of bytes (in our case, encoded audio). | Chunks from `MediaRecorder` arrive as `Blob`s. We can store them directly in IndexedDB, stream them to a server, or stitch them back into a single file via `new Blob([...])`. | [MDN: Blob](https://developer.mozilla.org/docs/Web/API/Blob) |
| **IndexedDB** | The browser’s transactional database. Operates asynchronously and can store large binary payloads (including `Blob`s). | We persist every chunk and session manifest locally so recordings survive reloads and crashes. | [MDN: IndexedDB](https://developer.mozilla.org/docs/Web/API/IndexedDB_API) |
| **Pulse-Code Modulation (PCM)** | A method of representing an analog waveform by measuring its amplitude at regular intervals (samples). PCM is the raw audio format most codecs ingest before compression. | Even though `MediaRecorder` hides the raw PCM stream, understanding PCM helps explain sample rates, bit depth, and why init segments exist. | [Wikipedia: Pulse-code modulation](https://en.wikipedia.org/wiki/Pulse-code_modulation) |

## 2. What Happens When the User Grants Microphone Access?

1. `getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } })` returns a promise. The browser shows a permission prompt; the OS surfaces its own dialog if required.
2. The promise resolves to a `MediaStream` containing one audio track. Internally, the browser has started pulling PCM samples from the microphone at the device’s native sample rate (commonly 44.1 kHz or 48 kHz).
3. We hand that stream directly to `new MediaRecorder(stream, config)`. The recorder spins up an encoder pipeline (AAC when available, Opus otherwise) and begins buffering samples.

> **Key insight:** At no point do we manually handle raw PCM in the current implementation. The browser keeps its own sliding buffer, ensuring samples are accumulated safely while we wait for the recorder to emit a chunk.

## 3. How Timeslices Create “Automatic” Chunks

When you call `recorder.start(timesliceMs)`, the browser does three things:

1. It schedules an internal timer that fires roughly every `timesliceMs` milliseconds.
2. On each tick, it encodes the buffered PCM samples gathered since the previous tick (or since the recorder started) and wraps them in a `Blob`.
3. It dispatches a `dataavailable` event containing the blob. The event’s `timecode` property reflects the media timeline relative to the recorder start (according to the browser).

Because the browser handles the buffering, we do **not** manually watch a clock to slice audio. Our job is to listen for `dataavailable` events and respond quickly enough that we do not fall behind. The new logging added to `capture/controller.ts` reports when `event.timecode` is missing, so we can correlate fallback durations with recorder state transitions.

## 4. What Is the MP4 Init Segment and Why Is It Separate?

- AAC inside MP4 uses an “ISO Base Media File Format” structure. The **init segment** contains metadata (`ftyp`, `moov` atoms) describing sample rate, channel layout, codec profile, and other stream characteristics.
- Browsers emit this metadata only once per recording session. It is tiny (hundreds of bytes) but required when concatenating chunks. Without it, decoders do not know how to interpret the subsequent audio frames.
- `MediaRecorder` always sends the init segment as the **first** `Blob`. That’s why chunk zero looks useless in isolation — it is not playable on its own — but the playback pipeline prepends it before concatenating the remaining audio chunks.

For a gentle introduction to MP4 atoms, see [Wikipedia: ISO base media file format](https://en.wikipedia.org/wiki/ISO_base_media_file_format) and [MDN: Media container formats](https://developer.mozilla.org/docs/Web/Media/Formats/Containers).

## 5. Where Do PCM Frames Go If We Never Touch Them?

Even though we rely on AAC chunks today, the browser is continuously pulling PCM samples into an internal ring buffer. That buffer feeds the encoder, but the same stream can be tapped by an **AudioContext**. Our architecture keeps this door open by exposing `captureController.attachAnalysisPort(port)` — future work will plug in an `AudioWorklet` that receives PCM frames without disturbing the recorder. Until then, the PCM waveforms live entirely inside the browser’s media graph.

## 6. Timing, Drift, and Why We Measure in Milliseconds

- Each chunk’s `startMs`/`endMs` is derived from the controller’s clock (`Date.now()`), not merely from `event.timecode`. This compensates for browsers that omit or reset the timecode property.
- The new logging shows both values so we can reconcile discrepancies.
- The reconciling step after `stop()` re-reads chunk metadata from IndexedDB and recomputes the duration to ensure the manifest never lags behind stored audio.

## 7. Suggested Reading After This Primer

- [MDN: Using the MediaStream Recording API](https://developer.mozilla.org/docs/Web/API/MediaStream_Recording_API/Using_the_MediaStream_Recording_API)
- [MDN: Guide to Web Audio](https://developer.mozilla.org/docs/Web/API/Web_Audio_API/Using_Web_Audio_API) – groundwork for understanding future PCM processing.
- [W3C Media Capture and Streams Specification](https://www.w3.org/TR/mediacapture-streams/) – definitive reference for `MediaStream` internals.

Continue with `libraries.md` for a module-by-module tour, or jump to `pcm-walkthrough.md` if you want an intuitive explanation of sampling theory before diving deeper.
