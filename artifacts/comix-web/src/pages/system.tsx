import { Link } from "wouter";
import { Settings, Download, BarChart3, Database, Info, FolderOpen } from "lucide-react";

interface SystemBlock {
  href?: string;
  label: string;
  description: string;
  icon: typeof Settings;
  comingSoon?: boolean;
}

const blocks: SystemBlock[] = [
  {
    href: "/settings",
    label: "Settings",
    description: "Theme, library defaults, reader, backup & restore.",
    icon: Settings,
  },
  {
    href: "/categories",
    label: "Categories",
    description: "Create, rename, reorder and delete library categories.",
    icon: FolderOpen,
  },
  {
    label: "Downloads",
    description: "Save chapters for offline reading. Coming soon.",
    icon: Download,
    comingSoon: true,
  },
  {
    href: "/stats",
    label: "Stats",
    description: "Reading time, top titles, streak.",
    icon: BarChart3,
  },
  {
    label: "Storage",
    description: "Cache size, clear images, manage data.",
    icon: Database,
    comingSoon: true,
  },
  {
    label: "About",
    description: "Version, changelog, credits.",
    icon: Info,
    comingSoon: true,
  },
];

function Block({ block }: { block: SystemBlock }) {
  const Icon = block.icon;
  const inner = (
    <div
      className={`relative h-full rounded-2xl border p-5 sm:p-6 transition-all flex flex-col gap-3 ${
        block.comingSoon
          ? "bg-card/50 border-dashed text-muted-foreground"
          : "bg-card hover:bg-muted hover:border-primary/40 hover:shadow-md cursor-pointer"
      }`}
    >
      <div className={`h-11 w-11 rounded-xl flex items-center justify-center ${
        block.comingSoon ? "bg-muted" : "bg-primary/10 text-primary"
      }`}>
        <Icon className="h-5 w-5" />
      </div>
      <div className="space-y-1">
        <h3 className="font-serif font-bold text-lg text-foreground flex items-center gap-2">
          {block.label}
          {block.comingSoon && (
            <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
              Soon
            </span>
          )}
        </h3>
        <p className="text-sm text-muted-foreground leading-relaxed">{block.description}</p>
      </div>
    </div>
  );

  if (block.href && !block.comingSoon) {
    return (
      <Link href={block.href} className="block h-full">
        {inner}
      </Link>
    );
  }
  return inner;
}

export default function SystemPage() {
  return (
    <main className="container mx-auto px-4 pt-4 sm:pt-6 pb-8 max-w-5xl animate-in fade-in duration-300">
      <div className="mb-6 sm:mb-8">
        <h1 className="text-3xl sm:text-4xl md:text-5xl font-serif font-bold mb-2">System</h1>
        <p className="text-muted-foreground text-base sm:text-lg">
          Configuration, storage and tools for your reader.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
        {blocks.map((b) => (
          <Block key={b.label} block={b} />
        ))}
      </div>
    </main>
  );
}
