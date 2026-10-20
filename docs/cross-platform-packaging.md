# Cross-platform ComiHub distribution

## Available now: installable PWA

The production ComiHub site is an installable Progressive Web App. The same build works on:

- **iPhone and iPad:** Safari → Share → Add to Home Screen.
- **macOS:** Safari/Chrome/Edge → Add to Dock or Install ComiHub.
- **Windows:** Chrome/Edge → Install page as app.
- **Linux:** Chromium/Chrome/Edge → Install page as app.
- **Android:** Chrome → Add to Home screen or Install app.

The PWA manifest now has a stable application ID, standalone display behavior, window-controls-overlay support where available, and install categories. Service-worker caching and offline chapter downloads remain device-local.

## Native packages

A real `.ipa`, `.dmg`, `.msi`, or Linux package cannot be signed and produced from the web sandbox alone:

- iOS/iPadOS requires macOS, Xcode, an Apple Developer signing identity, and App Store or Ad Hoc provisioning.
- macOS signing/notarization requires Apple Developer credentials.
- Windows installers require a Windows build/signing environment for the best user experience.
- Linux packages can be built in CI, but each target distribution may need its own artifact.

The intended native route is a thin Tauri shell around the same Vite build for Windows, macOS, and Linux, with Tauri mobile for iOS later. The shell must keep the backend/API and IndexedDB behavior unchanged so users do not get a second incompatible data store.

## Distribution stages

1. Ship and validate the PWA install path on every platform.
2. Add a Tauri desktop workspace and CI matrix for Windows, macOS, and Linux.
3. Add macOS signing/notarization and Windows code signing when credentials and runners are available.
4. Add the iOS Tauri/Capacitor target from a Mac runner, then submit through App Store Connect.

No platform-specific source fork should be created. All reader, downloads, extension, and tracker features stay in the shared web application.
