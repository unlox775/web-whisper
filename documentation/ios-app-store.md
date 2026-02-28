# iOS App Store build (Capacitor wrapper)

This repo includes an iOS wrapper project under `ios/` so you can install on-device and ship via TestFlight.

## What you get

- A native iOS shell (`WKWebView`) that loads the built web app from `docs/`.
- Microphone permission prompt configured (`NSMicrophoneUsageDescription`).
- Background audio mode enabled in the project (`UIBackgroundModes: audio`) as a prerequisite for native background recording work.

## Build and install (macOS + Xcode required)

1. Build the web app and sync it into the iOS project:

```bash
npm install
npm run native:ios
```

2. Open the Xcode project:

- Open `ios/App/App.xcodeproj` in Xcode.

3. Set signing:

- In Xcode, select the `App` target → **Signing & Capabilities**.
- Set your **Team**.
- Update the **Bundle Identifier** to something you own (e.g., `com.yourname.webwhisper`).

4. Run on device:

- Plug in your iPhone.
- Select your device as the run target.
- Click **Run**.

## TestFlight

- In Xcode: **Product → Archive**.
- In Organizer: **Distribute App** → **App Store Connect** → upload.
- Then manage builds in App Store Connect → TestFlight.

## Notes / limitations (current)

- On iOS (Capacitor), recording uses a **native recorder** so it continues when backgrounded/screen locked.
- Today the native recording is imported back into the web app’s IndexedDB on **Stop** (so playback works with existing web UI). Very long recordings may need follow-up work to avoid large in-memory transfers.
- Transcription/snip workflows are still web-first; native background transcription is a future milestone in `documentation/roadmap.md`.

