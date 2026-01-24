# Known issues (2026-01)

This list tracks known bugs and platform limitations that are not fully resolved.
These are not necessarily on the core roadmap, but are important for stability.

## 1) Intermittent iOS microphone connection failure (no audio captured)
Summary: On iOS, recording sometimes starts but never receives PCM audio callbacks.
The mic icon appears briefly, then the session ends with no audio.

Observed symptoms:
- Recording starts, but no audio chunks are created.
- After ~15 seconds, the app logs "No PCM audio callback detected within timeout".
- Session ends with "Session completed without playable audio".
- Global error buffer is empty; no JS errors captured.
- Restarting the app or rebooting the device does not always resolve it.

Evidence (captured 2026-01-21):
- Session: `956931e5-a8c6-459b-bc05-f649a4653661`
- Logs show:
  - "Requesting microphone stream"
  - "Microphone stream acquired"
  - "PCM capture started"
  - "No PCM audio callback detected within timeout"
  - "No audio captured after timeout; stopping recording"
  - "Session completed without playable audio"

Notes:
- This appears to be intermittent and device-specific on iOS.
- Root cause is unclear; may be a WebKit audio pipeline or permission issue.

Suggested diagnostics to collect:
- Device model + iOS version.
- Whether running as PWA or in Safari/Chrome.
- Full log export around the start/stop window.
- Doctor report from the affected session.

Related docs:
- `documentation/debugging.md` (section "No-audio capture example")
- `documentation/spec/20260117-233721_recording-stability-debugging.md`
