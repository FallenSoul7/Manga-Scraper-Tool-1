export function getProxiedImageUrl(originalUrl: string, sourceId: string): string {
  if (!originalUrl) return "";
  
  // Check localStorage for the setting we'll create in Settings
  const isVpnEnabled = localStorage.getItem("builtin_vpn_enabled") === "true";
  
  if (!isVpnEnabled) return originalUrl;

  // The backend route you already have: /api/image
  const encodedUrl = encodeURIComponent(originalUrl);
  return `/api/image?url=${encodedUrl}&source=${sourceId}`;
}
