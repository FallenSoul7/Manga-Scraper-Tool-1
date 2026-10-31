import { ArrowLeft } from "lucide-react";
import { Link } from "wouter";
import ExtensionRepositoryConnector from "@/components/extension-repository-connector";
import Tier1ExtensionImporter from "@/components/tier1-extension-importer";

export default function ExtensionSettingsPage() {
  return (
    <main className="container mx-auto max-w-xl animate-in fade-in px-4 py-8 duration-300">
      <Link href="/system" className="mb-5 inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> System
      </Link>
      <div className="mb-6">
        <h1 className="font-serif text-2xl font-bold text-foreground">Extensions</h1>
      </div>
      <ExtensionRepositoryConnector />
      <details className="mt-8 rounded-xl border border-border/60 p-4">
        <summary className="cursor-pointer text-sm font-medium">Add a Tier 1 JSON manifest</summary>
        <div className="mt-4">
          <Tier1ExtensionImporter />
        </div>
      </details>
    </main>
  );
}
