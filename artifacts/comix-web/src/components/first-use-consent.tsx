import { useState } from "react";
import { Link } from "wouter";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import {
  FIRST_USE_POLICY_VERSION,
  acceptFirstUseAgreement,
  hasAcceptedFirstUseAgreement,
} from "@/lib/compliance-consent";

export function FirstUseConsent() {
  const [accepted, setAccepted] = useState(() => hasAcceptedFirstUseAgreement());
  const [isAdult, setIsAdult] = useState(false);
  const [readPolicies, setReadPolicies] = useState(false);

  if (accepted) return null;

  const canContinue = isAdult && readPolicies;

  function continueToComiHub() {
    if (!canContinue) return;
    acceptFirstUseAgreement();
    setAccepted(true);
  }

  return (
    <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/80 px-4 py-6 backdrop-blur-sm">
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="comihub-first-use-title"
        className="max-h-[calc(100dvh-3rem)] w-full max-w-lg overflow-y-auto rounded-2xl border border-border bg-background p-6 shadow-2xl sm:p-8"
      >
        <p className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-primary">Before you continue</p>
        <h1 id="comihub-first-use-title" className="text-2xl font-bold tracking-tight">ComiHub terms and content notice</h1>
        <p className="mt-4 text-sm leading-6 text-muted-foreground">
          ComiHub is an independent reader interface. Sources and extensions are optional, may be operated by third parties, and may have their own terms and rights status. ComiHub does not force you to install any extension or use any particular source.
        </p>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          You choose which sources or extensions to add. Installing an extension does not transfer ownership or permission for third-party content to ComiHub or to you. Do not use a source to bypass access controls, infringe rights, or access unlawful material.
        </p>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          Mature sources are hidden by default and require a separate confirmation. This notice is not a guarantee of legality or a substitute for the source operator’s rules or professional legal advice.
        </p>

        <div className="mt-6 space-y-4 rounded-xl border border-border bg-muted/30 p-4">
          <label className="flex items-start gap-3 text-sm leading-5">
            <Checkbox checked={isAdult} onCheckedChange={(value) => setIsAdult(value === true)} className="mt-0.5" />
            <span>I confirm that I am at least 18 years old, or the age of majority where I live.</span>
          </label>
          <label className="flex items-start gap-3 text-sm leading-5">
            <Checkbox checked={readPolicies} onCheckedChange={(value) => setReadPolicies(value === true)} className="mt-0.5" />
            <span>
              I agree to the <Link href="/terms" className="font-semibold text-primary underline">Terms of Use</Link> and acknowledge the <Link href="/privacy" className="font-semibold text-primary underline">Privacy Policy</Link>.
            </span>
          </label>
        </div>

        <p className="mt-4 text-xs text-muted-foreground">Policy version: {FIRST_USE_POLICY_VERSION}. You can review the policies again at any time from the site footer.</p>
        <Button className="mt-6 w-full" disabled={!canContinue} onClick={continueToComiHub}>
          Agree and continue
        </Button>
      </section>
    </div>
  );
}
