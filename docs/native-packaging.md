# Native ComiHub packages

ComiHub now has native shells for:

- iOS: `artifacts/comix-web/ios` via Capacitor
- Android: `artifacts/comix-web/android` via Capacitor
- Windows, Linux, and macOS: `artifacts/comix-web/src-tauri` via Tauri

All shells load the same Vite application and keep the same reader, extension, tracker, and offline-download behavior.

## Android APK

On a machine with Android Studio, the Android SDK, and Java:

```bash
cd artifacts/comix-web
pnpm install
pnpm android:sync
pnpm android:open
```

Build a debug APK from Android Studio or with Gradle. For a distributable signed APK, configure a release keystore outside the repository and use Android Studio's **Generate Signed Bundle/APK** flow.

### Immersive manga reader

Like MangaYomi's Flutter reader, which switches to an immersive system UI mode while reader controls are hidden and restores it when controls return, ComiHub's Capacitor Android reader now uses a small native bridge for the same transition. The bridge hides both Android status and navigation bars while controls are hidden, allows Android's transient swipe-to-reveal behavior, and restores the bars when controls are shown or the reader closes.

The iOS shell uses Capacitor's native StatusBar plugin to hide the iOS status bar (time, network, and battery indicators) with the same reader-control toggle. iOS does not expose Android-style navigation-bar hiding here, so the home indicator remains controlled by iOS.

The web/PWA reader keeps its existing Fullscreen API fallback. A browser-installed PWA cannot reliably toggle native system bars on demand; setting the PWA manifest to `display: fullscreen` is a launch-time mode and would hide system bars outside the reader too. The native Android/iOS shells are the reliable path for reader-only system-bar hiding.

### Free iOS sideloading

A personal Apple Developer account can be used to sign and install the app on personal devices without paying for the Apple Developer Program. Apple's free Personal Team provisioning is limited: up to three devices and three sideloaded apps per device, with provisioning that expires after seven days. The app must be refreshed/re-signed and reinstalled periodically. AltStore can refresh sideloaded apps through AltServer, but this is not permanent, public distribution. The paid Apple Developer Program is listed at USD 99 per membership year and is not required for this personal-device workflow. See [Apple's developer account limits](https://developer.apple.com/help/account/basics/about-your-developer-account/) and [AltStore's app-expiration guide](https://faq.altstore.io/altstore-classic/your-altstore).

Signing an iOS build still requires access to Xcode on macOS and the user's Apple Account. This sandbox has no Mac/Xcode environment, so it can prepare the project but cannot produce the user's signed IPA.

The **Install ComiHub** page links to GitHub Release assets. The release workflow builds a directly installable Android APK, Windows NSIS installer, Linux AppImage, and an unsigned iOS IPA for a sideloader to sign with the user's own Apple Account. The iOS button remains marked **Coming soon** until the sideload package is ready and verified.

## Windows, Linux, and macOS

Tauri requires Rust and the platform's native build dependencies:

```bash
cd artifacts/comix-web
pnpm install
pnpm desktop:build
```

Tauri produces platform-specific installers/packages on the platform where it is built. Use a Windows runner for Windows installers, a Linux runner for AppImage/deb packages, and a macOS runner for `.app`/`.dmg` packages. macOS distribution signing/notarization requires Apple credentials.

The current sandbox has no Android SDK, Rust toolchain, Windows runner, Linux desktop libraries, or Mac/Xcode environment, so it can prepare and validate the project files but cannot produce the final signed APK/EXE/AppImage/DMG from here.
