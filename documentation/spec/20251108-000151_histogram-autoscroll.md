## Summary
- Track playback progress within the histogram and keep the viewport auto-scrolling while allowing manual drag overrides.

## ✅ Done
- Logged user requirements for a playback-synced green progress bar and auto-scroll behavior on the histogram viewport.

## 🚧 In Progress / Placeholders
- Design how the player progress bar integrates with the existing histogram rendering pipeline.
- Determine interaction rules so manual drags temporarily override auto-scroll without desynchronizing playback.

## ⏭️ Next Actions / Dependencies
- Implement a green playback progress indicator that advances with audio playback.
- Auto-scroll the histogram once the indicator reaches ~75% of the visible window, resuming after manual interaction ends.
- Validate the experience during live capture and playback, covering both short and long recordings.
