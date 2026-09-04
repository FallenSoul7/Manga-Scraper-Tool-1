# PIN Lock Modes Design

## Goal

Make the six-digit PIN lock reliable and let users independently choose whether
it applies when ComiHub is opened as a normal website, as an installed
home-screen/PWA app, or both.

## Current failure

The lock settings page declares a React state setter named `setPin`, which
shadows the imported persistence function also named `setPin`. Submitting the
confirmation therefore updates React input state instead of saving the PIN.
The UI reports success while no local hash or account PIN is written.

## Design

### PIN persistence

- Rename the lock-page input setter so the imported `setPin()` function is
  called when confirmation succeeds.
- Keep the existing salted local SHA-256 hash format.
- Keep account synchronization for authenticated users.
- Keep the existing lockout and recovery flows.

### Lock mode preferences

Store two device-local boolean preferences:

- `lockInBrowser`: lock when running as a normal website tab/window.
- `lockInStandalone`: lock when running as an installed home-screen/PWA app.

Existing devices that already have a PIN but no mode preferences migrate to
both modes enabled. This preserves the secure behavior users expect after the
bug fix. Removing the PIN clears the mode preferences. Changing the PIN keeps
the current mode preferences.

The settings page displays both switches after a PIN exists. Either, both, or
neither can be enabled. Turning both off does not remove the PIN; it only
disables automatic gating until a mode is enabled again.

### Mode detection

Use `window.matchMedia("(display-mode: standalone)")` for Chromium and
`navigator.standalone === true` for iOS Safari/PWA. Treat the app as standalone
when either signal is true; otherwise treat it as browser mode.

### Lock gate lifecycle

- Internal route changes never lock the app.
- A fresh page load checks the configured PIN and the current mode preference.
- When the document becomes hidden, clear the in-memory unlocked flag.
- When the document becomes visible again, lock only if the current display mode
  is enabled.
- Avoid using `window.blur` as a lock trigger because harmless focus changes
  can fire blur without the app actually being backgrounded.
- `pagehide` clears the in-memory unlocked flag so a later return is gated.
- `/lock` remains reachable for PIN management and is never covered by the gate.

### Compatibility

The server-side PIN status remains a fallback for authenticated fresh devices.
Mode preferences are intentionally device-local because the same account can be
used in browser and standalone contexts with different desired behavior.

## Error handling

- If localStorage is unavailable, show the existing save error.
- If account sync fails, retain the local PIN and show the existing warning.
- If the server status request fails, use the local PIN and local mode
  preferences.
- If both modes are disabled, do not show the lock gate even when a PIN exists.

## Verification

Manually verify:

1. Enter and confirm a new PIN; reload; the PIN is requested.
2. Website-only mode locks in browser mode and not standalone mode.
3. Standalone-only mode locks in PWA mode and not browser mode.
4. Both modes lock in both contexts.
5. Both modes disabled leaves the PIN configured but does not gate.
6. Backgrounding and returning to the app locks when the matching mode is on.
7. Internal navigation does not lock.
8. Changing the PIN preserves mode switches.
9. Removing the PIN clears the gate and mode preferences.