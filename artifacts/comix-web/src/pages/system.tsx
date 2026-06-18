import { useState, useEffect } from "react";
import { Link } from "wouter";
import {
  Settings, Download, BarChart3, Info, FolderOpen, Sparkles,
  Shield, Trash2, AppWindow, LogIn, UserCircle,
} from "lucide-react";
import { getCachedUser, setCachedUser, onAuthChanged, type CachedUser } from "@/lib/auth-cache";
import { apiUrl } from "@/lib/api-url";

interface SystemBlock {
  href?: string;
  label: string;
  description: string;
  icon: typeof Settings;
  comingSoon?: boolean;
  highlight?: boolean;
  disabled?: boolean;
  extra?: React.ReactNode;
}

function Block({ block }: { block: SystemBlock }) {
  const Icon = block.icon;
  const inner = (
    <div
      className={`relative h-full rounded-2xl border p-5 sm:p-6 transition-all flex flex-col gap-3 ${
        block.comingSoon || block.disabled
          ? "bg-card/50 border-dashed text-muted-foreground"
          : block.highlight
          ? "bg-primary/5 border-primary/40 hover:bg-primary/10 hover:border-primary/60 hover:shadow-md cursor-pointer"
          : "bg-card hover:bg-muted hover:border-primary/40 hover:shadow-md cursor-pointer"
      }`}
    >
      <div className={`h-11 w-11 rounded-xl flex items-center justify-center ${
        block.comingSoon || block.disabled
          ? "bg-muted"
          : block.highlight
          ? "bg-primary/20 text-primary"
          : "bg-primary/10 text-primary"
      }`}>
        <Icon className="h-5 w-5" />
      </div>
      <div className="space-y-1 flex-1">
        <h3 className="font-serif font-bold text-lg text-foreground flex items-center gap-2">
          {block.label}
          {block.highlight && (
            <span className="text-[10px] font-bold uppercase tracking-wider text-primary bg-primary/10 px-1.5 py-0.5 rounded">New</span>
          )}
          {block.comingSoon && (
            <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground bg-muted px-1.5 py-0.5 rounded">Soon</span>
          )}
        </h3>
        <p className="text-sm text-muted-foreground leading-relaxed">{block.description}</p>
        {block.extra}
      </div>
    </div>
  );

  if (block.href && !block.comingSoon && !block.disabled) {
    return <Link href={block.href} className="block h-full">{inner}</Link>;
  }
  return inner;
}

function ProfileExtra({ user }: { user: CachedUser }) {
  return (
    <div className="mt-2 flex items-center gap-2.5">
      {user.photo ? (
        <img
          src={user.photo}
          alt={user.displayName}
          referrerPolicy="no-referrer"
          className="w-8 h-8 rounded-full border border-border shrink-0"
        />
      ) : (
        <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center shrink-0">
          <span className="text-xs font-bold text-primary">
            {(user.username?.[0] ?? user.displayName?.[0] ?? "?").toUpperCase()}
          </span>
        </div>
      )}
      <div className="min-w-0">
        <p className="text-sm font-semibold text-foreground truncate">{user.username || user.displayName}</p>
        <p className="text-xs text-muted-foreground truncate">{user.email}</p>
      </div>
    </div>
  );
}

export default function SystemPage() {
  const [user, setUser] = useState(() => getCachedUser());

  useEffect(() => {
    setUser(getCachedUser());

    // Re-render on any auth cache change (set/cleared by any component)
    const unsubscribe = onAuthChanged(() => setUser(getCachedUser()));

    // Also check the server directly — catches the case where the user
    // logged in via Safari (iOS PWA) and the cache hasn't been populated yet
    fetch(apiUrl("/api/auth/me"), { credentials: "include" })
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data?.user) {
          setCachedUser(data.user);
          // setUser will be called via onAuthChanged event above
        }
      })
      .catch(() => {});

    return unsubscribe;
  }, []);

  const loggedIn = !!user;

  const blocks: SystemBlock[] = [
    {
      href: "/comi-ai",
      label: "Comi AI",
      description: "AI chat assistant — sort your Tachimanga library by genre, tags, or any rule.",
      icon: Sparkles,
      highlight: true,
    },
    {
      href: "/vpn",
      label: "Built-in VPN",
      description: "Route images through the server to bypass regional blocks.",
      icon: Shield,
    },
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
      label: "Install",
      description: "Add ComiHub to your home screen for offline use.",
      icon: AppWindow,
    },
    {
      href: "/profile",
      label: "Profile",
      description: loggedIn
        ? "Tap to edit your username or sign out."
        : "Sign in to back up your library across devices.",
      icon: UserCircle,
      extra: loggedIn && user ? <ProfileExtra user={user} /> : undefined,
    },
    ...(!loggedIn ? [{
      href: "/login",
      label: "Login",
      description: "Sign in with Google to sync your library across devices.",
      icon: LogIn,
    } as SystemBlock] : []),
    {
      label: "About",
      description: "Version, changelog, credits.",
      icon: Info,
      comingSoon: true,
    },
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
        {blocks.map((b) => (
          <Block key={b.label} block={b} />
        ))}
      </div>
    </main>
  );
}
