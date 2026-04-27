import { useRoute, Link } from "wouter";
import { useGetChapterPages } from "@workspace/api-client-react";
import { proxyImage } from "@/lib/utils";
import { Loader2, X } from "lucide-react";
import { useEffect } from "react";

export default function Reader() {
  const [, params] = useRoute("/reader/:chapterId");
  const chapterId = params?.chapterId;

  const { data: pagesData, isLoading } = useGetChapterPages(chapterId || "", {
    query: { enabled: !!chapterId }
  });

  // Scroll to top on mount
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [chapterId]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-black flex flex-col items-center justify-center text-white/50">
        <Loader2 className="h-8 w-8 animate-spin mb-4" />
        <p>Loading chapter pages...</p>
      </div>
    );
  }

  if (!pagesData || pagesData.pages.length === 0) {
    return (
      <div className="min-h-screen bg-black flex flex-col items-center justify-center text-white/50">
        <p className="mb-4">No pages found or chapter is empty.</p>
        <Link href="/" className="text-white hover:underline">Return Home</Link>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0f0f0f] relative">
      <div className="sticky top-0 z-50 bg-[#0f0f0f]/90 backdrop-blur border-b border-white/10 h-14 flex items-center px-4 justify-between transition-transform duration-300">
        <div className="text-white/80 font-medium truncate flex-1">
          Chapter Reader
        </div>
        <Link href="/" className="text-white/60 hover:text-white transition-colors p-2 rounded-full hover:bg-white/10">
          <X className="h-5 w-5" />
        </Link>
      </div>

      <div className="max-w-3xl mx-auto flex flex-col items-center pb-20">
        {pagesData.pages.map((page) => (
          <img
            key={page.index}
            src={proxyImage(page.url)}
            alt={`Page ${page.index}`}
            className="w-full h-auto object-contain block"
            loading={page.index < 3 ? "eager" : "lazy"}
          />
        ))}
      </div>
    </div>
  );
}
