export const FIRST_USE_POLICY_VERSION = "2026-09-22";

const AGREEMENT_KEY = "comihub-first-use-agreement-v1";
const ADULT_CONSENT_KEY = "comihub-adult-access-consent-v1";

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Consent is best-effort in private/restricted browser storage. The UI
    // remains safe by default when a value cannot be persisted.
  }
}

export function hasAcceptedFirstUseAgreement(): boolean {
  return read(AGREEMENT_KEY) === FIRST_USE_POLICY_VERSION;
}

export function acceptFirstUseAgreement() {
  write(AGREEMENT_KEY, FIRST_USE_POLICY_VERSION);
}

export function hasAdultAccessConsent(): boolean {
  return read(ADULT_CONSENT_KEY) === FIRST_USE_POLICY_VERSION;
}

export function acceptAdultAccessConsent() {
  write(ADULT_CONSENT_KEY, FIRST_USE_POLICY_VERSION);
}
