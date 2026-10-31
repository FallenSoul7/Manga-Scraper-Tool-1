import { ArrowLeft } from "lucide-react";
import { Link } from "wouter";
import Tier1ExtensionImporter from "@/components/tier1-extension-importer";

export default function ExtensionSettingsPage() {
  return (
    <main className="container mx-auto px-4 py-8 max-w-xl animate-in fade-in duration-300">
      <Link href="/system" className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground mb-5 transition-colors gap-1.5">
        <ArrowLeft className="h-4 w-4" /> System
      </Link>
      <div className="mb-6">
        <h1 className="text-2xl font-serif font-bold text-foreground">Extensions</h1>
      </div>
      <Tier1ExtensionImporter />
    </main>
  );
}
