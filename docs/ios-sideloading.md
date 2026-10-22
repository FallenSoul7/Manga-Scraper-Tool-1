# ComiHub iOS sideload build

ComiHub now includes a real Capacitor iOS project at `artifacts/comix-web/ios`, not only a PWA shortcut.

## Build on a Mac

Requirements:

- macOS with Xcode installed;
- an Apple ID added to Xcode;
- an iPhone connected by USB or available for wireless debugging;
- Developer Mode enabled on the iPhone;
- a free Apple ID or Apple Developer account.

From the repository root:

```bash
cd artifacts/comix-web
pnpm install
pnpm ios:sync
pnpm ios:open
```

In Xcode:

1. Open the `App` project from `ios/App/App.xcodeproj`.
2. Select the `App` target and open **Signing & Capabilities**.
3. Select your Apple development team and change the bundle identifier if needed.
4. Select the connected iPhone as the run destination.
5. Press **Run**.

For a free Apple ID, the installed app is normally limited by Apple's personal-team signing rules and may need periodic re-signing. Paid Apple Developer membership provides normal development provisioning and broader distribution options.

## IPA export and download

The tagged installer workflow builds `ComiHub-ios.ipa` on a macOS runner and publishes it with the GitHub release. The **Install ComiHub** page links to the latest release asset. This IPA is intentionally unsigned so that the user can import it into SideStore, AltStore, Sideloadly, or another compatible sideloader and sign it with their own Apple Account. The repository never contains Apple signing credentials or provisioning profiles.

An unsigned IPA cannot be installed by iOS directly. The sideloader must sign it first; with a free Personal Team, Apple generally limits the installation to personal devices and requires periodic refresh/re-signing.

## Important architecture detail

The iOS app is a thin native shell around the same Vite build. It preserves the existing ComiHub reader, extension adapters, IndexedDB downloads, offline cache, and API configuration. It does not create a second native reader or duplicate the extension system.
