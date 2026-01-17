# Browser Technology Primer (PCM-first)

Audience: engineers and product partners who want a plain-English view of the moving parts behind Web Whisper. Each section points to optional background reading.

## 1. Core building blocks

| Concept | What it is | Why we use it | Learn more |
| --- | --- | --- | --- |
| `MediaDevices.getUserMedia` | Requests microphone access and returns a `MediaStream`. | Entry point for every recording session. | https://developer.mozilla.org/docs/Web/API/MediaDevices/getUserMedia |
| `MediaStream` | A live stream of audio tracks from the OS. | Feeds the AudioContext graph. | https://developer.mozilla.org/docs/Web/API/MediaStream |
| `AudioContext` | Web Audio graph used for PCM processing. | Enables PCM capture and decoding for analysis. | https://developer.mozilla.org/docs/Web/API/AudioContext |
| `ScriptProcessorNode` | Legacy node that delivers PCM frames to JS. | Current capture path for broad compatibility. | https://developer.mozilla.org/docs/Web/API/ScriptProcessorNode |
| PCM audio | Raw sample values at a fixed sample rate. | Source of truth for chunk timing. | https://en.wikipedia.org/wiki/Pulse-code_modulation |
| Lame.js | In-browser MP3 encoder. | Converts PCM blocks into MP3 chunks. | https://github.com/zhuker/lamejs |
| `Blob` | Binary data container. | Stores each encoded audio chunk. | https://developer.mozilla.org/docs/Web/API/Blob |
| IndexedDB | Browser database for large blobs. | Persists sessions, chunks, snips, and logs. | https://developer.mozilla.org/docs/Web/API/IndexedDB_API |
| `AudioContext.decodeAudioData` | Decodes compressed audio to PCM. | Computes volume profiles for analysis. | https://developer.mozilla.org/docs/Web/API/AudioContext/decodeAudioData |
| `fetch` + `FormData` | HTTP client and multipart payloads. | Sends snip audio to Groq for transcription. | https://developer.mozilla.org/docs/Web/API/Fetch_API |

## 2. Current capture path
1. `getUserMedia` returns a `MediaStream` audio track.
2. `AudioContext` + `ScriptProcessorNode` pull PCM frames into JS.
3. Frames are converted to Int16 and buffered until a target sample count is reached.
4. Lame.js encodes the buffer into MP3, and the blob is persisted in IndexedDB.

Note: ScriptProcessor is deprecated but still widely supported. The plan is to migrate to AudioWorklet when possible.

## 3. Chunk timing and durability
- Chunk boundaries are based on sample counts (sample rate * chunk duration), not timers.
- This makes timing deterministic and avoids drift caused by browser event jitter.
- Each chunk includes `startMs` and `endMs` derived from the running sample count.

## 4. Analysis pipeline
- Each stored chunk is decoded to PCM for volume profiling.
- Volume frames are normalized and concatenated into a session timeline.
- Quiet regions and boundaries are derived from this timeline to produce snips.

## 5. Transcription handoff
- Snip ranges are rendered to WAV (PCM) for precise boundaries.
- Snip audio is posted to Groq Whisper via `fetch` + `FormData`.
- The response is normalized into a compact set of timestamped segments.

## 6. Legacy MP4 note
Earlier iterations used `MediaRecorder` with MP4 fragments. Those fragments are not guaranteed to be independent or sequential, which caused timing confusion. The current PCM-first approach avoids that ambiguity.

## 7. Suggested reading
- https://developer.mozilla.org/docs/Web/API/Web_Audio_API
- https://developer.mozilla.org/docs/Web/API/MediaStream_Recording_API
- https://www.w3.org/TR/mediacapture-streams/
