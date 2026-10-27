# ComiHub installed-app web updates

## Goal

Let existing Android and iOS installs receive compatible ComiHub web changes after Vercel deploys them, without downloading and reinstalling an APK or IPA for every web fix. Backend-only changes should be available through Render's API as soon as that service deploys.

## Current behavior and risks

- The app already uses Capawesome Live Update on Android and iOS. It downloads a signed web bundle, stages it, and applies it on a later app launch.
- The updater checks at startup and when the app returns to the foreground. It also has a 24-hour cooldown after staging a bundle, which can block a second quick test release.
- `pnpm build` invokes the OTA bundle generator. If `COMIHUB_OTA_PRIVATE_KEY` is missing, the generator exits successfully without publishing a bundle. A production website deploy can therefore succeed without updating installed apps.
- Vercel currently gives `/native-updates/latest.json` a cache lifetime. The live response was a Vercel cache hit with a high `Age` value, so clients may keep seeing an older manifest after a deploy.
- A valid signed manifest is available in production, but its commit identifier is not present in this checkout; it cannot be verified against the current branch here.
- Provider dashboard settings are not stored in the repository. This work cannot enable GitHub auto-deploy for Vercel or Render.

## Proposed behavior

1. Keep update checks event-driven: check when the native app opens and when it returns to the foreground. Do not poll on a timer.
2. Remove the 24-hour delay between successful updates. Continue deduplicating a bundle already staged, verify the signature and checksum, and stage a valid newer bundle.
3. Keep applying a staged bundle on the next app launch rather than forcibly reloading during reading. Failed checks must not block normal startup.
4. Give `/native-updates/latest.json` a `no-store` cache policy. Keep immutable, content-addressed ZIP bundles cacheable.
5. On a Vercel production build, fail with a clear error if the OTA signing key is missing. Local and preview builds may continue without publishing an OTA bundle. The signing key must be configured in Vercel's secret settings and must match the public key embedded in the app.
6. Keep the existing minimum native version requirement. App binaries below the published minimum need one compatible APK/IPA update before they can use OTA updates.

## Scope and limitations

- This updates the web layer only: JavaScript, CSS, HTML, and other bundled web assets.
- Native code, permissions, plugins, and platform configuration still require a new APK or IPA.
- Render API changes do not need an OTA bundle, but Render must deploy the intended GitHub branch for clients to receive them.
- Vercel and Render must each be configured to deploy the intended branch. Those dashboard settings remain the user's responsibility.
- The agent will not commit or push changes; the user will publish them.

## Verification

- Build and typecheck the web and API workspaces.
- Confirm local builds without the signing key still work, while a production Vercel build without the key fails clearly.
- Confirm the latest manifest is not cached and a second bundle is not blocked by the previous successful update.
- After the user deploys, confirm the live manifest references that Vercel commit and that its ZIP checksum and signature validate.
- Confirm current Android and iOS app versions meet the manifest minimum; verify a staged bundle applies after reopening the app.
