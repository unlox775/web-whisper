# PCM Walkthrough - Audio for Middle Schoolers

Imagine speaking into a microphone as if you were drawing a wavy line on paper. The microphone senses how much the air is vibrating (loud vs soft) thousands of times every second. The computer turns those vibrations into numbers. Those numbers are PCM (Pulse-Code Modulation).

## 1. Turning sound into numbers
1. Sampling: the browser measures the air pressure at a regular pace. At 48,000 samples per second (48 kHz), we grab 48,000 numbers every second.
2. Quantization: each sample becomes a number. With 16-bit audio, the value ranges from -32,768 to +32,767. Bigger magnitude means louder sound.
3. Channels: mono audio stores one series of numbers; stereo stores two. Web Whisper records mono to keep file size small.

## 2. Why PCM is too big to store forever
PCM is huge. A single second of 48 kHz, 16-bit mono PCM is about:

48,000 samples * 2 bytes per sample = ~96 KB per second

Ten minutes is well over 50 MB. That is why Web Whisper converts PCM to MP3 before persisting it.

## 3. Where PCM lives in Web Whisper today
- The app captures PCM directly using AudioContext + ScriptProcessor.
- PCM is buffered in memory, then encoded to MP3 with Lame.js.
- Only the compressed MP3 chunks are stored in IndexedDB.
- We still decode MP3 back to PCM when we need to compute volume profiles or snip boundaries.

## 4. Why this approach is more reliable
Because we track exact sample counts, chunk timing is deterministic. This avoids the timing surprises that can happen with encoded container fragments.

## 5. Where PCM helps next
PCM lets us:
- compute volume histograms and quiet regions accurately
- build snips that land on real time boundaries
- export WAV slices for clean transcription

If you want a gentle deep dive:
- https://developer.mozilla.org/docs/Web/API/Web_Audio_API/Basic_concepts_behind_Web_Audio_API
- https://en.wikipedia.org/wiki/Pulse-code_modulation
