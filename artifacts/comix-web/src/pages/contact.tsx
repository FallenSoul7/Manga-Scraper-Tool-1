import { FormEvent, useState } from "react";
import { Mail, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

const SUPPORT_EMAIL = "support@comihub.top";

export default function ContactPage() {
  const [submitted, setSubmitted] = useState(false);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const subject = String(form.get("subject") || "ComiHub support request");
    const message = String(form.get("message") || "");
    const name = String(form.get("name") || "");
    const email = String(form.get("email") || "");
    const body = `Name: ${name}\nReply email: ${email}\n\n${message}`;
    window.location.href = `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    setSubmitted(true);
  }

  return (
    <main className="container mx-auto max-w-3xl px-4 py-10 sm:py-16">
      <div className="mb-8">
        <p className="mb-3 text-sm font-semibold uppercase tracking-[0.2em] text-primary">Contact</p>
        <h1 className="font-serif text-4xl font-bold tracking-tight">Need help with ComiHub?</h1>
        <p className="mt-4 leading-7 text-muted-foreground">
          Send a support request, report a broken page, or ask about an extension. We will receive your message at{" "}
          <a className="font-medium text-primary underline underline-offset-4" href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-5 rounded-xl border bg-card p-6 shadow-sm sm:p-8">
        <div className="grid gap-5 sm:grid-cols-2">
          <label className="space-y-2 text-sm font-medium">Name<input name="name" required autoComplete="name" className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-base font-normal shadow-sm md:text-sm" /></label>
          <label className="space-y-2 text-sm font-medium">Email<input name="email" type="email" required autoComplete="email" className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-base font-normal shadow-sm md:text-sm" /></label>
        </div>
        <label className="block space-y-2 text-sm font-medium">Subject<Input name="subject" required placeholder="How can we help?" /></label>
        <label className="block space-y-2 text-sm font-medium">Message<Textarea name="message" required rows={7} placeholder="Describe the issue or request…" /></label>
        <div className="flex flex-wrap items-center gap-4">
          <Button type="submit"><Send className="h-4 w-4" /> Open email</Button>
          <a href={`mailto:${SUPPORT_EMAIL}`} className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"><Mail className="h-4 w-4" /> Email support directly</a>
        </div>
        {submitted && <p role="status" className="text-sm text-muted-foreground">Your email client should now be open. If it did not open, email {SUPPORT_EMAIL} directly.</p>}
      </form>
    </main>
  );
}

export { ContactPage };

