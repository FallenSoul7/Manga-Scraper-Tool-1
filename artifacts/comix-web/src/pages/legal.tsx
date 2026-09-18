import { Link } from "wouter";
import { ArrowLeft, ShieldCheck } from "lucide-react";
import type { ReactNode } from "react";

function LegalShell({ title, effectiveDate, children }: { title: string; effectiveDate: string; children: ReactNode }) {
  return (
    <main className="container mx-auto max-w-3xl px-4 py-10 pb-24">
      <Link href="/system" className="inline-flex items-center text-sm text-muted-foreground hover:text-primary mb-8"><ArrowLeft className="mr-2 h-4 w-4" />Back to System</Link>
      <div className="flex items-start gap-3 mb-8"><div className="mt-1 rounded-xl bg-primary/10 p-3 text-primary"><ShieldCheck className="h-5 w-5" /></div><div><h1 className="text-3xl font-serif font-bold">{title}</h1><p className="text-sm text-muted-foreground mt-1">Effective date: {effectiveDate}</p></div></div>
      <article className="prose prose-sm dark:prose-invert max-w-none prose-headings:font-serif prose-a:text-primary">{children}</article>
      <div className="mt-10 border-t pt-5 text-sm text-muted-foreground">Questions about these documents? Contact the ComiHub team through the support channel listed in the app.</div>
    </main>
  );
}

export function PrivacyPolicyPage() {
  return <LegalShell title="Privacy Policy" effectiveDate="September 18, 2026">
    <p>This Privacy Policy explains how ComiHub collects, uses, stores, and shares information when you use the ComiHub application and related services.</p>
    <h2>1. Information we collect</h2>
    <p><strong>Account information.</strong> If you create an account, we receive your email address, username, account identifiers, and authentication information from our authentication provider. We do not store your plaintext password.</p>
    <p><strong>Library and app data.</strong> ComiHub may store your library, categories, reading progress, preferences, installed extensions, update subscriptions, and downloaded content locally on your device. If you sign in and use synchronization, selected app data is transmitted to our backend so it can be synchronized across your devices.</p>
    <p><strong>Technical information.</strong> Our hosting, authentication, analytics, security, and advertising providers may process IP address, browser/device information, approximate location, request logs, and diagnostic information as necessary to operate and protect the service.</p>
    <h2>2. How we use information</h2>
    <p>We use information to provide authentication, synchronize your library when requested, operate and improve ComiHub, prevent abuse, troubleshoot failures, communicate service changes, and display or measure advertising where advertising is enabled.</p>
    <h2>3. Advertising and third parties</h2>
    <p>ComiHub may use third-party advertising providers. Depending on the provider, ads may use cookies, mobile identifiers, or similar technologies to limit repetition, measure performance, prevent fraud, or provide contextual or personalized advertising. The provider’s own privacy policy also applies to its processing. We will identify active advertising and consent controls in the app before enabling personalized advertising.</p>
    <h2>4. Cookies and local storage</h2>
    <p>We use essential cookies or equivalent storage for authentication, security, preferences, and service operation. ComiHub also uses browser storage for local app data and caching. You can remove local data through the app’s Cache controls or your browser/device settings. Removing it may delete locally stored library or downloaded content.</p>
    <h2>5. Sharing</h2>
    <p>We share information only with service providers that help us host, authenticate, synchronize, secure, analyze, or advertise the service, or when required by law. We do not sell your library or reading history as a standalone product.</p>
    <h2>6. Retention and choices</h2>
    <p>We retain account and synchronized data while your account is active or as needed for legitimate operational and legal purposes. You may request access, correction, deletion, or clarification about your personal information. You may also disable synchronization by signing out and remove local data through the app.</p>
    <h2>7. Children</h2>
    <p>ComiHub is not directed to children who are below the minimum age required to use online services in their location. Do not create an account if you are not legally permitted to do so.</p>
    <h2>8. Changes and contact</h2>
    <p>We may update this Policy when our practices change. The effective date above will be updated when material changes are published. Before enabling advertising or serving users in a jurisdiction with additional consent requirements, this template should be reviewed and completed with the responsible legal entity, contact address, provider list, and applicable regional disclosures.</p>
  </LegalShell>;
}

export function TermsPage() {
  return <LegalShell title="Terms of Service" effectiveDate="September 18, 2026">
    <p>These Terms govern your use of ComiHub. By creating an account or using account-only features, you agree to these Terms and the <Link href="/privacy">Privacy Policy</Link>.</p>
    <h2>1. Eligibility and accounts</h2>
    <p>You must be legally permitted to use ComiHub in your location. You are responsible for keeping your credentials secure and for activity performed through your account. Do not share an account in a way that violates a source’s rules or applicable law.</p>
    <h2>2. Acceptable use</h2>
    <p>You may use ComiHub for lawful personal use. You must not circumvent access controls, abuse sources, overload services, infringe rights, distribute malware, attempt unauthorized access, or use ComiHub to violate applicable law or third-party terms.</p>
    <h2>3. Sources and content</h2>
    <p>ComiHub is an interface that connects to independent sources and does not guarantee the availability, accuracy, legality, safety, licensing, or permanence of third-party content. You are responsible for complying with the laws and terms that apply to content you access. A source may block requests, change its domain, remove content, or stop working without notice.</p>
    <h2>4. Local storage and synchronization</h2>
    <p>Some features store data locally on your device. Synchronization is provided as a convenience and is not a backup guarantee. Keep your own backup of data that matters to you.</p>
    <h2>5. Advertising</h2>
    <p>ComiHub may display advertisements or sponsored content. Ads may be provided by third parties and may be governed by additional provider terms. ComiHub does not endorse every advertised product or service.</p>
    <h2>6. Availability and changes</h2>
    <p>We may modify, suspend, or discontinue features, extensions, accounts, or advertising. We may update these Terms by publishing a revised version. Continued use after the effective date means you accept the revised Terms, where permitted by law.</p>
    <h2>7. Disclaimer and limitation</h2>
    <p>ComiHub is provided on an “as available” basis to the fullest extent permitted by law. We disclaim warranties not required by law and are not responsible for third-party source outages, content, malware, loss of local data, or indirect damages to the extent permitted by applicable law.</p>
    <h2>8. Contact and legal review</h2>
    <p>Before public launch of advertising, the operator should replace any generic support wording with the legal entity name, address, governing law, dispute process, and jurisdiction-specific consumer rights required for the intended markets.</p>
  </LegalShell>;
}

export function AdvertisingPage() {
  return <LegalShell title="Advertising and Cookies" effectiveDate="September 18, 2026">
    <p>This notice explains how advertising is intended to work in ComiHub. It supplements the <Link href="/privacy">Privacy Policy</Link>; it is not a guarantee that every provider or format is available in every region.</p>
    <h2>Essential operation</h2>
    <p>ComiHub may use essential storage for login, security, preferences, and consent choices. These technologies are required for requested features and cannot be disabled through an advertising preference control.</p>
    <h2>Advertising choices</h2>
    <p>Where required by law, ComiHub will ask for consent before personalized advertising or non-essential advertising technologies are enabled. Declining should not prevent access to core ComiHub features, although contextual ads may still be shown where permitted.</p>
    <h2>Provider controls</h2>
    <p>Advertising providers may offer their own opt-out or privacy controls. Provider names, purposes, retention periods, and links must be listed here before ads are enabled in production. Do not enable an advertising SDK until its consent mode, regional behavior, and data-processing terms have been reviewed.</p>
    <h2>Managing storage</h2>
    <p>You can clear ComiHub’s local cache from the Cache page or clear site data from your browser/device settings. Browser privacy controls may also limit cookies or advertising identifiers.</p>
  </LegalShell>;
}
