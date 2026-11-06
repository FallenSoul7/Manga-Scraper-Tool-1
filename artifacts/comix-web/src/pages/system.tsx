import { useEffect, useState } from "react";
import { Link } from "wouter";
import {
  Settings, Download, BarChart3, Info, FolderOpen, Sparkles, Puzzle, ShieldCheck,
  Trash2, AppWindow, LogIn, Lock, Crown, Smartphone, UserRound,
} from "lucide-react";
import ExtensionBreadcrumbBadge from "@/components/extension-breadcrumb-badge";
import { useExtensionBreadcrumbState } from "@/lib/extension-registry";
import { getCachedUser, onAuthChanged } from "@/lib/auth-cache";

interface SystemBlock {
  href?: string;
  label: string;
  description: string;
  icon: typeof Settings;
  comingSoon?: boolean;
  highlight?: boolean;
  profileTone?: "signed-in" | "signed-out";
  authStatus?: string;
}

function Block({ block, extensionBadgeCount = 0 }: { block: SystemBlock; extensionBadgeCount?: number }) {
  const Icon = block.icon;
  const inner = (
    <div
      className={`relative h-full rounded-2xl border px-4 py-2 sm:px-5 sm:py-3 transition-all flex flex-col gap-1 ${
        block.comingSoon
          ? "bg-card/50 border-dashed text-muted-foreground"
          : block.profileTone === "signed-out"
          ? "bg-emerald-500/5 border-emerald-500/40 hover:bg-emerald-500/10 hover:border-emerald-500/60 hover:shadow-md cursor-pointer"
          : block.profileTone === "signed-in" || block.highlight
          ? "bg-primary/5 border-primary/40 hover:bg-primary/10 hover:border-primary/60 hover:shadow-md cursor-pointer"
          : "bg-card hover:bg-muted hover:border-primary/40 hover:shadow-md cursor-pointer"
      }`}
    >
      <div className={`h-9 w-9 rounded-lg flex items-center justify-center ${
        block.comingSoon
          ? "bg-muted"
          : block.profileTone === "signed-out"
          ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
          : block.profileTone === "signed-in" || block.highlight
          ? "bg-primary/20 text-primary"
          : "bg-primary/10 text-primary"
      }`}>
        <Icon className="h-3.5 w-3.5" />
      </div>
      <div className="space-y-1 flex-1">
        <h3 className="font-serif font-bold text-base text-foreground flex items-center gap-2">
          {block.label}
          {block.authStatus && (
            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${block.profileTone === "signed-in" ? "bg-primary/10 text-primary" : "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"}`}>
              {block.authStatus}
            </span>
          )}
          {extensionBadgeCount > 0 && <ExtensionBreadcrumbBadge count={extensionBadgeCount} />}
          {block.highlight && (
            <span className="text-[10px] font-bold uppercase tracking-wider text-primary bg-primary/10 px-1.5 py-0.5 rounded">New</span>
          )}
          {block.comingSoon && (
            <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground bg-muted px-1.5 py-0.5 rounded">Soon</span>
          )}
        </h3>
        <p className="text-xs text-muted-foreground leading-relaxed">{block.description}</p>
      </div>
    </div>
  );

  if (block.href && !block.comingSoon) {
    return <Link href={block.href} className="block h-full">{inner}</Link>;
  }
  return inner;
}

const blocks: SystemBlock[] = [
  {
    href: "/comi-ai",
    label: "Comi AI",
    description: "AI chat assistant — sort your Tachimanga library by genre, tags, or any rule.",
    icon: Sparkles,
    highlight: true,
  },
  {
    href: "/settings",
    label: "Settings",
    description: "Theme, library defaults, reader, backup & restore.",
    icon: Settings,
  },
  {
    href: "/extension-settings",
    label: "Extensions",
    description: "Add and manage source extensions on this device.",
    icon: Puzzle,
  },
  {
    href: "/privacy-mode",
    label: "Privacy Mode",
    description: "Download and enable the browser helper for direct device requests.",
    icon: ShieldCheck,
    highlight: true,
  },
  {
    href: "/subscription",
    label: "Subscription",
    description: "No ads, unlimited downloads, and expanded cloud library limits.",
    icon: Crown,
    highlight: true,
  },
  {
    href: "/categories",
    label: "Categories",
    description: "Create, rename, reorder and delete library categories.",
    icon: FolderOpen,
  },
  {
    href: "/downloads",
    label: "Downloads",
    description: "Save chapters for offline reading.",
    icon: Download,
  },
  {
    href: "/stats",
    label: "Stats",
    description: "Reading time, top titles, streak.",
    icon: BarChart3,
  },
  {
    href: "/cache",
    label: "Cache",
    description: "View cache size and clear stored data.",
    icon: Trash2,
  },
  {
    href: "/install",
    label: "Add to Home Screen",
    description: "Add ComiHub to this device for quick access and offline reading.",
    icon: Smartphone,
  },
  {
    href: "/install-comihub",
    label: "Install ComiHub",
    description: "Choose Android, iOS, Windows, or Linux installation options.",
    icon: AppWindow,
  },
  {
    href: "/login",
    label: "Account",
    description: "Sign in with Google to sync your library across devices.",
    icon: LogIn,
  },
  {
    href: "/lock",
    label: "Lock",
    description: "Set a 6-digit PIN to protect your library.",
    icon: Lock,
  },
  {
    label: "About",
    description: "Version, changelog, credits.",
    icon: Info,
    comingSoon: true,
  },
];

export default function SystemPage() {
  const breadcrumb = useExtensionBreadcrumbState();
  const [user, setUser] = useState(() => getCachedUser());
  useEffect(() => onAuthChanged(() => setUser(getCachedUser())), []);
  const systemBlocks: SystemBlock[] = [
    {
      href: "/profile",
      label: "Profile",
      description: user ? "Manage your username and profile picture." : "Not logged in — open your profile or sign in.",
      icon: UserRound,
      profileTone: user ? "signed-in" : "signed-out",
      authStatus: user ? "Logged in" : "Not logged in",
    },
    ...blocks,
  ];
  return (
    <main className="container mx-auto px-4 pt-4 sm:pt-6 pb-8 max-w-5xl animate-in fade-in duration-300">
      <div className="mb-6 sm:mb-8">
        <h1 className="text-3xl sm:text-4xl md:text-5xl font-serif font-bold mb-2">System</h1>
        <p className="text-muted-foreground text-base sm:text-lg">
          Configuration, storage and tools for your reader.
        </p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
        {systemBlocks.map((b) => (
          <Block
            key={b.label}
            block={b}
            extensionBadgeCount={b.href === "/extension-settings" && breadcrumb.step === "extensions" ? breadcrumb.missingExtensionCount : 0}
          />
        ))}
      </div>
      <nav aria-label="System information links" className="mt-8 flex flex-wrap justify-center gap-x-5 gap-y-2 border-t pt-6 text-sm text-muted-foreground">
        <Link href="/privacy" className="transition-colors hover:text-foreground hover:underline">Privacy</Link>
        <Link href="/terms" className="transition-colors hover:text-foreground hover:underline">Terms</Link>
        <Link href="/advertising" className="transition-colors hover:text-foreground hover:underline">Advertising</Link>
        <Link href="/about" className="transition-colors hover:text-foreground hover:underline">About</Link>
        <Link href="/contact" className="transition-colors hover:text-foreground hover:underline">Contact</Link>
        <Link href="/dmca" className="transition-colors hover:text-foreground hover:underline">DMCA / Copyright</Link>
      </nav>
    </main>
  );
}
