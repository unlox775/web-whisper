# web-whisper

web-whisper is a Progressive Web App (PWA) that captures long-form audio directly in the browser, encodes it into durable MP3 chunks, and prepares snips for transcription with OpenAI's Whisper (served via [Groq](https://groq.com/)). The project showcases how far you can get with modern AI tooling. This entire app is being assembled inside [Cursor](https://cursor.com/) with the help of cursor agents.

> **Project status:** MVP in progress. PCM capture, chunking, playback, diagnostics, and snip-based transcription are live. Next up: full-session downloads, clipboard-first transcription UX, and iOS background recording.

## Try It Now

- **Web app (GitHub Pages):** https://unlox775.github.io/web-whisper/
- Install the PWA from Safari/Chrome (“Add to Home Screen” / “Install app”). On iOS you may still see microprompting for microphone access—tap “Allow” when prompted. Safari settings (Settings → Safari → Microphone) can be set to “Allow” to reduce prompts, but iOS currently re-prompts PWAs after each cold start.

## How to Use

1. **Get a Groq API key (optional for recording, required for transcription):**
   - Create a free Groq account: https://console.groq.com/
   - Generate an API token. Usage may incur costs based on audio length; check Groq pricing before heavy use. This app does not estimate charges.
   - If you skip this step or leave transcription disabled, the app records audio but does not transcribe.
2. **Open the PWA:** visit the URL above, or install it as a home-screen app.
3. **Configure settings:** tap “Settings” to enable or disable transcription, paste your Groq API key, validate it, set a storage cap, and toggle developer mode.
4. **Record:** tap “Start recording.” The app captures PCM, encodes MP3 chunks every ~4 seconds, and persists them to IndexedDB immediately.
5. **Playback:** tap a session card, open the detail drawer, and hit play. Developer mode exposes chunk and snip playback, storage inspection, logs, and diagnostics.

### Developer Mode Goodies

- Live chunk counter + buffer usage while recording.
- Chunk and snip lists with per-item playback and downloads.
- Volume histogram with snip boundaries.
- Developer console with IndexedDB tables and session logs.
- Doctor diagnostics for chunk coverage and range access.

## Current Architecture (MVP)

- **Capture:** AudioContext + ScriptProcessor to capture PCM and encode MP3 chunks with Lame.js.
- **Storage:** `manifestService` (idb) manages sessions, chunks, volume profiles, snips, and logs.
- **Analysis:** volume profiles and snip detection feed the histogram and snip list.
- **Playback:** full-session MP3 playback plus chunk and snip slicing via `recordingSlicesApi`.
- **Transcription:** snip audio sent to Groq Whisper with per-snip transcripts.
- **Diagnostics:** developer console and doctor checks for coverage and decode issues.

### Roadmap

- iOS native wrapper for reliable background recording.
- Storage retention and automatic deletion for completed snips.
- Full-session audio download.
- Clipboard-first transcription UX (auto-copy + quick copy button).
- Cross-browser compatibility matrix and fixes.
- Usability feedback sessions before UI polish.

See `documentation/roadmap.md` for detailed goals and acceptance criteria.
See `documentation/contributor-roadmap.md` for optional community contributions.

### Known issues
See `documentation/knownissues.md` for the current list and diagnostic notes.

## Building It Yourself

All development is happening inside Cursor with cursor agents. If you want to tinker:

```bash
npm install
npm run dev
```

The PWA build artifacts land in `docs/` for GitHub Pages hosting: `npm run build`.

## Collaboration Log

Every iteration is documented in `documentation/spec/` as a paired markdown spec + prompt transcript (e.g., `20251105-224815_developer-mode.md` and `...-PROMPT.txt`). That folder is the canonical changelog of AI-assisted development sessions.

## Support and maintenance

This is an open-source personal tool. Please file issues on GitHub if you hit bugs.
Maintenance is best-effort, and community contributions are welcome. If you want to
build the iOS app, use your own Apple Developer credentials.

## OpenAI Whisper + Groq

Whisper remains one of OpenAI’s most impressive releases—it handles noisy, rapid speech with minimal fuss. Groq’s hosted Whisper-Large-v3 makes it inexpensive (and often free) to run large batches. This app is opinionated toward that model—once transcription wiring lands, recordings will flow straight to Groq with minimal configuration.

## Credits

- Built by an engineer learning PWAs + audio pipelines on the fly.
- Powered entirely by Cursor Pro + cursor agents.
- Whisper by OpenAI; Groq for blazing-fast inference.
