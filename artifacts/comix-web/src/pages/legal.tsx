import { Link } from "wouter";

type LegalSection = { title: string; children: React.ReactNode };

function LegalLayout({ title, updated, children }: { title: string; updated: string; children: React.ReactNode }) {
  return (
    <main className="container mx-auto max-w-4xl px-4 py-10 sm:py-16">
      <p className="mb-3 text-sm font-semibold uppercase tracking-[0.2em] text-primary">ComiHub policy</p>
      <h1 className="font-serif text-4xl font-bold tracking-tight">{title}</h1>
      <p className="mt-3 text-sm text-muted-foreground">Last updated: {updated}</p>
      <div className="prose prose-neutral mt-10 max-w-none dark:prose-invert">{children}</div>
    </main>
  );
}

function Section({ title, children }: LegalSection) {
  return <section><h2>{title}</h2>{children}</section>;
}

export function PrivacyPage() {
  return <LegalLayout title="Privacy Policy" updated="September 18, 2026">
    <p>ComiHub values your privacy. This Privacy Policy explains what information may be processed when you use the ComiHub web application, how it is used, and the choices available to you.</p>
    <Section title="Information we process"><p>ComiHub may process information you provide directly, such as an account email address, support correspondence, library preferences, and settings. The application may also process technical information such as browser type, device characteristics, approximate network information, error logs, and request metadata needed to operate and protect the service.</p></Section>
    <Section title="Local storage and cookies"><p>ComiHub uses browser storage, including local storage, IndexedDB, and service-worker caches, to remember settings, reading progress, library data, and cached source responses. These technologies help the application work reliably and do not necessarily identify you by name.</p><p>ComiHub and its third-party advertising partners may use cookies, local storage, pixels, or similar technologies to deliver, measure, limit, and personalize advertising, subject to the provider’s policies and your applicable choices. You can manage cookies through your browser settings. Blocking them may affect some features or ad personalization.</p></Section>
    <Section title="Advertising and third parties"><p>ComiHub may work with third-party advertising partners. Those partners may independently collect information about browser activity to provide advertising, measurement, fraud prevention, or frequency capping. Their processing is governed by their own privacy policies. ComiHub does not sell your personal information as a standalone data-broker product.</p><p>ComiHub also relies on service providers for hosting, databases, authentication, analytics, security, email support, and content-source requests. Providers receive only the information reasonably needed to perform their services and must handle it under their applicable agreements.</p></Section>
    <Section title="How information is used"><p>Information may be used to provide and secure ComiHub, authenticate accounts, synchronize optional library data, remember preferences, answer support requests, diagnose failures, prevent abuse, comply with legal obligations, and understand aggregate service performance.</p></Section>
    <Section title="Privacy compliance and your choices"><p>ComiHub aims to handle personal information in accordance with applicable privacy and data-protection laws. Depending on where you live, you may have rights to access, correct, delete, restrict, or object to certain processing, and to withdraw consent where processing is based on consent. Contact <a href="mailto:support@comihub.top">support@comihub.top</a> to make a request. We may need to verify the request and may retain limited records when required for security or law.</p></Section>
    <Section title="Children and retention"><p>ComiHub is not directed to children under the age required by applicable law. We retain information only as long as reasonably needed for the purposes described above, legitimate operational needs, dispute resolution, and legal obligations.</p></Section>
    <Section title="Changes and contact"><p>We may update this policy when the service or legal requirements change. The updated date above identifies the current version. Questions can be sent through the <Link href="/contact">Contact page</Link> or to <a href="mailto:support@comihub.top">support@comihub.top</a>.</p></Section>
  </LegalLayout>;
}

export function TermsPage() {
  return <LegalLayout title="Terms of Use" updated="September 18, 2026">
    <p>These Terms of Use govern access to ComiHub. By using the service, you agree to follow these terms and applicable law. If you do not agree, do not use ComiHub.</p>
    <Section title="The service"><p>ComiHub provides a web-based interface for browsing and reading supported content sources. Features, extensions, source availability, and formats may change without notice. ComiHub does not guarantee that a particular title, chapter, episode, video, or source will remain available.</p></Section>
    <Section title="Third-party content"><p>ComiHub is not the owner or publisher of content supplied by third-party sources. Sources may have separate terms, licenses, copyright policies, and privacy practices. You are responsible for using those sources lawfully. See the <Link href="/dmca">DMCA and copyright page</Link> for rights-holder notices.</p></Section>
    <Section title="Acceptable use"><p>You may not use ComiHub to violate law, infringe rights, interfere with service operation, bypass access controls, distribute malware, scrape at abusive rates, or attempt to access accounts or data that do not belong to you. You must not misrepresent your identity or use the service to harm others.</p></Section>
    <Section title="Accounts and availability"><p>You are responsible for keeping account credentials secure and for activity performed through your account. ComiHub may suspend access to protect users, sources, infrastructure, or legal interests. The service is provided on an availability basis and may contain errors or interruptions.</p></Section>
    <Section title="Disclaimers and limits"><p>To the extent permitted by law, ComiHub is provided “as is” without warranties of uninterrupted availability, accuracy, completeness, fitness for a particular purpose, or continued source access. ComiHub is not responsible for the content, conduct, availability, or policies of independent third-party sources. Nothing in these terms excludes liability that cannot legally be excluded.</p></Section>
    <Section title="Changes and contact"><p>We may update these terms as the service evolves. Continued use after an update means you accept the revised terms. Questions may be sent to <a href="mailto:support@comihub.top">support@comihub.top</a>.</p></Section>
  </LegalLayout>;
}

export function AdvertisingPage() {
  return <LegalLayout title="Advertising Policy" updated="September 18, 2026">
    <p>ComiHub may display advertising to support hosting, development, security, and maintenance of the service. This policy explains how advertising is presented and how third-party advertising partners may operate.</p>
    <Section title="Third-party advertising partners"><p>Ads may be supplied by independent advertising networks. These partners can use cookies, pixels, device identifiers, or similar technologies to measure campaigns, prevent fraud, limit repeated ads, and provide contextual or interest-based advertising where permitted. Each partner has its own privacy policy and user controls.</p></Section>
    <Section title="Transparency and user choice"><p>Advertisements are intended to be distinguishable from ComiHub content. Do not click an advertisement unless you are interested in it, and review the destination’s terms before providing information or making a purchase. Browser settings and available regional consent tools can be used to manage cookies and personalized advertising.</p></Section>
    <Section title="Restricted content"><p>ComiHub does not knowingly seek advertising that is illegal, deceptive, malicious, or inappropriate for the service. If you see an ad that appears unsafe, misleading, or unrelated to the network’s policy, please report it to <a href="mailto:support@comihub.top">support@comihub.top</a> with the page and ad details.</p></Section>
    <Section title="Updates"><p>Advertising partners and formats may change as ComiHub develops. This page will be updated when material practices change. For privacy details, read the <Link href="/privacy">Privacy Policy</Link>.</p></Section>
  </LegalLayout>;
}

export default PrivacyPage;

