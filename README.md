# web-whisper

web-whisper is a Progressive Web App (PWA) that captures long-form audio directly in the browser, slices it into durable chunks, and prepares the data for transcription with OpenAI’s Whisper (served via [Groq](https://groq.com/)). The project showcases how far you can get with modern AI tooling—this entire app is being assembled inside [Cursor](https://cursor.com/) with the help of cursor agents.

> **Project status:** Minimum viable product (MVP) in progress. Recording, chunking, playback, developer tooling, and persistence are live. Live transcription, adaptive snipping, and uploader/backoff logic are next on the roadmap.

## Try It Now

- **Web app (GitHub Pages):** https://unlox775.github.io/web-whisper/
- Install the PWA from Safari/Chrome (“Add to Home Screen” / “Install app”). On iOS you may still see microprompting for microphone access—tap “Allow” when prompted. Safari settings (Settings → Safari → Microphone) can be set to “Allow” to reduce prompts, but iOS currently re-prompts PWAs after each cold start.

## How to Use

1. **Get a Groq API key (optional for now, required for transcription):**
   - Create a free Groq account: https://console.groq.com/
   - Generate an API token (Groq’s Whisper-large-v3 endpoint is extremely affordable—most casual use stays within the free tier).
2. **Open the PWA:** visit the URL above, or install it as a home-screen app.
3. **Configure settings:** tap “Settings” in the header to store your Groq API key, set a storage cap, and toggle developer mode.
4. **Record:** tap “Start recording.” The app writes 4-second AAC chunks into IndexedDB immediately—no gaps, no restarts.
5. **Playback:** tap a session card, open the detail drawer, and hit play. Developer mode exposes chunk-level telemetry, the storage inspector, and a logging console for deeper debugging.

### Developer Mode Goodies

- Live chunk counter + buffer usage while recording.
- Bug toggles inside each session for chunk listings (size, format, duration).
- Developer console with:
  - IndexedDB inspector (sessions & chunk metadata; binary blobs noted as “binary omitted”).
  - Session-by-session logs (“recorder started”, “chunk persisted”, warnings/errors, etc.).

## Current Architecture (MVP)

- **Capture:** MediaRecorder (AAC) + IndexedDB persistence; zero restarts, fixed timeslices (4 s) while we build adaptive snipping.
- **Storage:** `manifestService` (Dexie/idb) manages sessions, chunks, logging, and reconciliation after crashes.
- **UI:** React + Vite + Tailwind-esque CSS; playback UI provides play/pause + progress for combined blobs.
- **Developer Instrumentation:** logging overlay, IndexedDB tables, chunk inspector.

### Roadmap

- AudioWorklet analysis (RMS/ZCR, adaptive snip heuristics).
- Sync layer for future sharing (optional; current scope keeps everything local).
- Whisper integration (Groq, 30 s windows, overlap, transcript retries).
- Storage cap enforcement & retention policies.

## Building It Yourself

All development is happening inside Cursor with cursor agents. If you want to tinker:

```bash
npm install
npm run dev
```

The PWA build artifacts land in `docs/` for GitHub Pages hosting: `npm run build`.

## Collaboration Log

Every iteration is documented in `documentation/spec/` as a paired markdown spec + prompt transcript (e.g., `20251105-224815_developer-mode.md` and `...-PROMPT.txt`). That folder is the canonical changelog of AI-assisted development sessions.

## OpenAI Whisper + Groq

Whisper remains one of OpenAI’s most impressive releases—it handles noisy, rapid speech with minimal fuss. Groq’s hosted Whisper-Large-v3 makes it inexpensive (and often free) to run large batches. This app is opinionated toward that model—once transcription wiring lands, recordings will flow straight to Groq with minimal configuration.

## Credits

- Built by an engineer learning PWAs + audio pipelines on the fly.
- Powered entirely by Cursor Pro + cursor agents.
- Whisper by OpenAI; Groq for blazing-fast inference.
