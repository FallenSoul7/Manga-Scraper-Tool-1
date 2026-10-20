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

## Windows, Linux, and macOS

Tauri requires Rust and the platform's native build dependencies:

```bash
cd artifacts/comix-web
pnpm install
pnpm desktop:build
```

Tauri produces platform-specific installers/packages on the platform where it is built. Use a Windows runner for Windows installers, a Linux runner for AppImage/deb packages, and a macOS runner for `.app`/`.dmg` packages. macOS distribution signing/notarization requires Apple credentials.

The current sandbox has no Android SDK, Rust toolchain, Windows runner, Linux desktop libraries, or Mac/Xcode environment, so it can prepare and validate the project files but cannot produce the final signed APK/EXE/AppImage/DMG from here.
