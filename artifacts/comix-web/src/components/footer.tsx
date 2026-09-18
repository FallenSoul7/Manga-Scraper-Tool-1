import { Link } from "wouter";
import { Library } from "lucide-react";

const links = [
  ["Privacy", "/privacy"],
  ["Terms", "/terms"],
  ["Advertising", "/advertising"],
  ["About", "/about"],
  ["Contact", "/contact"],
  ["DMCA / Copyright", "/dmca"],
] as const;

export function Footer() {
  return (
    <footer className="border-t bg-muted/20">
      <div className="container mx-auto flex max-w-6xl flex-col gap-5 px-4 py-8 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Library className="h-4 w-4 text-primary" aria-hidden="true" />
          <span>ComiHub</span>
        </div>
        <nav aria-label="Footer navigation" className="flex flex-wrap gap-x-5 gap-y-2 text-sm text-muted-foreground">
          {links.map(([label, href]) => <Link key={href} href={href} className="transition-colors hover:text-foreground hover:underline">{label}</Link>)}
        </nav>
        <p className="text-xs text-muted-foreground">© {new Date().getFullYear()} ComiHub</p>
      </div>
    </footer>
  );
}

export default Footer;

