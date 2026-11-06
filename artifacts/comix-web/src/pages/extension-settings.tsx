import ExtensionRepositoryConnector from "@/components/extension-repository-connector";
import Tier1ExtensionImporter from "@/components/tier1-extension-importer";

export default function ExtensionSettingsPage() {
  return (
    <main className="container mx-auto max-w-xl animate-in fade-in px-4 py-8 duration-300">
      <ExtensionRepositoryConnector />
      <details className="mt-8 rounded-xl border border-border/60 p-4">
        <summary className="cursor-pointer text-sm font-medium">Add a custom Tier 1 JSON source</summary>
        <p className="mt-1 text-xs text-muted-foreground">This imports a declarative JSON manifest. It is separate from the official source list and does not run JavaScript.</p>
        <div className="mt-4">
          <Tier1ExtensionImporter />
        </div>
      </details>
    </main>
  );
}
