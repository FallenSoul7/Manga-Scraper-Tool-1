export default function ExtensionBreadcrumbBadge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span
      role="status"
      aria-label={`${count} new extensions`}
      className="inline-flex h-5 min-w-6 items-center justify-center rounded-full bg-amber-300 px-1.5 text-[10px] font-bold leading-none text-amber-950 shadow-[0_0_12px_rgba(252,211,77,0.9)] animate-pulse"
    >
      +{count}
    </span>
  );
}
