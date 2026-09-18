import { BookOpen, MonitorPlay, ShieldCheck, Smartphone } from "lucide-react";

const features = [
  { icon: BookOpen, title: "A unified reader", text: "Read supported manga, comics, and text-based stories in one focused interface." },
  { icon: MonitorPlay, title: "Multiple formats", text: "ComiHub supports image chapters, text novels, and selected video content through source-aware readers." },
  { icon: Smartphone, title: "Built for the web", text: "Use ComiHub on desktop, mobile browsers, or as an installed progressive web app." },
  { icon: ShieldCheck, title: "Source-aware design", text: "Each extension is handled independently with clear fallbacks and local browser caching where appropriate." },
];

export default function AboutPage() {
  return (
    <main className="container mx-auto max-w-5xl px-4 py-10 sm:py-16">
      <section className="max-w-3xl">
        <p className="mb-3 text-sm font-semibold uppercase tracking-[0.2em] text-primary">About ComiHub</p>
        <h1 className="font-serif text-4xl font-bold tracking-tight sm:text-5xl">Your web-based reading and content hub.</h1>
        <p className="mt-6 text-lg leading-8 text-muted-foreground">
          ComiHub is a reader application that brings supported manga, comics, novels, and selected media sources into one organized experience. It helps readers browse sources, maintain a personal library, and continue reading across devices without requiring a native app.
        </p>
      </section>

      <section className="mt-12 grid gap-4 sm:grid-cols-2" aria-label="ComiHub features">
        {features.map(({ icon: Icon, title, text }) => (
          <article key={title} className="rounded-xl border bg-card p-6 shadow-sm">
            <Icon className="h-6 w-6 text-primary" aria-hidden="true" />
            <h2 className="mt-4 text-lg font-semibold">{title}</h2>
            <p className="mt-2 leading-7 text-muted-foreground">{text}</p>
          </article>
        ))}
      </section>

      <section className="mt-12 rounded-xl border bg-muted/30 p-6 sm:p-8">
        <h2 className="text-2xl font-semibold">Our approach</h2>
        <p className="mt-3 leading-7 text-muted-foreground">
          ComiHub is an independent interface and does not claim ownership of third-party content. Sources and extensions may change, become unavailable, or apply their own terms. If you believe content available through a source infringes your rights, please contact us through the DMCA page so we can review the report.
        </p>
      </section>
    </main>
  );
}

export { AboutPage };

