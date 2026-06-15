import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function proxyImage(url: string | undefined, source?: string): string {
  if (!url) return '';
  const baseUrl = import.meta.env.BASE_URL.replace(/\/$/, "");
  const sourceParam = source ? `&source=${encodeURIComponent(source)}` : '';
  return `${baseUrl}/api/image?url=${encodeURIComponent(url)}${sourceParam}`;
}
