# Recording stability debugging

## ✅ Done
- Added wake lock management for active recordings with visibility recovery and logging.
- Captured global error and rejection buffer plus log snapshot on no-audio timeout.
- Documented npm install prerequisite for builds in `AGENTS.md`.
- Regenerated build artifacts after npm install and build.
- Switched Groq transcription default to whisper-large-v3-turbo.
- Added progressive backoff retries for auto/live transcription recovery.
- Derived session list statuses for transcribing/partial/untranscribed sessions.
- Logged capture diagnostics (stream + audio context) during no-audio timeouts.
- Documented the 2026-01-21 no-audio capture event in the debugging guide.

## 🚧 In progress
- Validate iOS wake lock support and fallback behavior.

## ⏭️ Next actions
- Review logs from future recording start failures to isolate the root cause.
- Inspect capture diagnostics on the next no-audio failure for root cause.
