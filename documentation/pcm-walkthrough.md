# PCM Walkthrough – Audio for Middle Schoolers

Imagine speaking into a microphone as if you were drawing a wavy line on paper. The microphone senses how much the air is vibrating (loud vs soft) thousands of times every second. The computer turns those vibrations into numbers — that’s **Pulse-Code Modulation (PCM)**.

## 1. Turning Sound into Numbers

1. **Sampling** – The browser measures the air pressure at a regular pace. If we sample at 48,000 times per second (48 kHz), we grab 48,000 numbers for every second of speech. Think of it as taking 48,000 snapshots of a wave.
2. **Quantization** – Each snapshot becomes a number. With 16-bit audio, the number can range from -32,768 to +32,767 (negative means the wave is below the center line, positive means above). Bigger numbers = louder sound.
3. **Channels** – For mono audio we store one series of numbers. For stereo, we store two (left and right). Web Whisper records mono to keep files small.

> 🎧 Try visualizing this: Imagine a fast “connect-the-dots” picture. The dots are PCM samples. Connect them, and you recreate the original sound wave.

## 2. Why We Don’t Store Raw PCM Forever

PCM is huge! A single second of 48 kHz 16-bit mono PCM roughly equals:

```
48,000 samples × 2 bytes per sample ≈ 96 KB per second
```

Ten minutes of speech would exceed 50 MB. That’s inconvenient for phones and slow networks, so we compress PCM using AAC (inside MP4). AAC keeps the sound quality while shrinking file size dramatically.

## 3. Where PCM Lives in Web Whisper Today

- The browser captures PCM from the microphone inside its media pipeline. We **do not** manually handle these samples yet; we rely on `MediaRecorder` to compress them into AAC chunks.
- Even though we never touch raw PCM, understanding it is crucial for future features like silence detection and voice activity detection (VAD). Those features need access to PCM frames via an `AudioWorklet`.
- When we add the analysis pipeline, we’ll fork the `MediaStream` into an `AudioContext`, run the PCM through custom processors, and leave the `MediaRecorder` behavior unchanged.

## 4. Visualizing AAC with Init Segments

When AAC encodes PCM, it groups samples into **frames** (e.g., 1024 samples each). The init segment we receive before the first audio chunk describes:

- Sample rate (e.g., 48 kHz)
- Channel layout (mono or stereo)
- Codec profile (LC AAC vs HE AAC)

Players need this metadata to unpack the frames correctly. That’s why chunk zero exists even though it sounds like silence — it’s more like the instruction manual for the other chunks.

## 5. How We’ll Tap PCM in the Future

1. Use `AudioContext.createMediaStreamSource(stream)` to feed the microphone `MediaStream` into the Web Audio API.
2. Add an `AudioWorkletNode` that receives PCM frames in manageable blocks (e.g., 128 samples at a time).
3. Perform analysis (loudness, silence detection) without interfering with `MediaRecorder`.
4. Optionally store summary data alongside the chunk metadata for smarter transcription/bandwidth decisions.

For a gentle intro to Web Audio and PCM processing, see:

- [MDN: Basic concepts behind Web Audio API](https://developer.mozilla.org/docs/Web/API/Web_Audio_API/Basic_concepts_behind_Web_Audio_API)
- [Mozilla Hacks: Audio Worklet Basics](https://hacks.mozilla.org/2017/09/audio-worklet-design-pattern/) – describes how audio worklets operate on stream buffers.

Understanding PCM is the first step toward advanced features like live waveform visualization, silence trimming, or AI-based diarization. Now that you grasp the basics, continue with `capture-flow.md` for the full recorder sequence and timing diagnostics.
