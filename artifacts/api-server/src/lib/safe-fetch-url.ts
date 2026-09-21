import { lookup } from "dns/promises";
import { isIP } from "net";

const IPV4_BLOCKED_RANGES: Array<[number, number]> = [
  [0x00000000, 0x00ffffff], // 0.0.0.0/8
  [0x0a000000, 0x0affffff], // 10.0.0.0/8
  [0x64400000, 0x647fffff], // 100.64.0.0/10
  [0x7f000000, 0x7fffffff], // 127.0.0.0/8
  [0xa9fe0000, 0xa9feffff], // 169.254.0.0/16
  [0xc0000000, 0xc00000ff], // 192.0.0.0/24
  [0xc0000200, 0xc00002ff], // 192.0.2.0/24
  [0xc6120000, 0xc613ffff], // 198.18.0.0/15
  [0xc6336400, 0xc63364ff], // 198.51.100.0/24
  [0xc0a80000, 0xc0a8ffff], // 192.168.0.0/16
  [0xcb007100, 0xcb0071ff], // 203.0.113.0/24
  [0xe0000000, 0xffffffff], // multicast, reserved, and broadcast
];

function ipv4ToNumber(ip: string): number {
  return ip.split(".").reduce((value, part) => ((value << 8) | Number(part)) >>> 0, 0);
}

function isBlockedAddress(raw: string): boolean {
  const ip = raw.replace(/^\[|\]$/g, "").toLowerCase();
  const version = isIP(ip);

  if (version === 4) {
    const value = ipv4ToNumber(ip);
    return IPV4_BLOCKED_RANGES.some(([start, end]) => value >= start && value <= end);
  }

  if (version === 6) {
    if (ip === "::1" || ip === "::" || ip.startsWith("fc") || ip.startsWith("fd") || ip.startsWith("fe8") || ip.startsWith("fe9") || ip.startsWith("fea") || ip.startsWith("feb") || ip.startsWith("ff")) {
      return true;
    }
    if (ip.startsWith("::ffff:")) return isBlockedAddress(ip.slice(7));
  }

  return version === 0;
}

export async function isSafeUrl(raw: string): Promise<{ safe: boolean; reason?: string }> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { safe: false, reason: "invalid URL" };
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { safe: false, reason: "scheme not allowed" };
  }

  const hostname = url.hostname.toLowerCase();
  if (hostname === "localhost" || hostname.endsWith(".localhost") || hostname === "metadata.google.internal") {
    return { safe: false, reason: "blocked hostname" };
  }

  if (isIP(hostname) && isBlockedAddress(hostname)) {
    return { safe: false, reason: "private or reserved IP not allowed" };
  }

  if (isIP(hostname)) return { safe: true };

  try {
    const addresses = await lookup(hostname, { all: true });
    if (!addresses.length || addresses.some(({ address }) => isBlockedAddress(address))) {
      return { safe: false, reason: "resolves to private or reserved IP" };
    }
  } catch {
    return { safe: false, reason: "DNS resolution failed" };
  }

  return { safe: true };
}

export async function validateSafeUrl(raw: string): Promise<URL> {
  const result = await isSafeUrl(raw);
  if (!result.safe) throw new Error(result.reason ?? "unsafe URL");
  return new URL(raw);
}
