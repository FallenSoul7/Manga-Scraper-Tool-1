const KEYS: string[] = [
  "13YDu67uDgFczo3DnuTIURqas4lfMEPADY6Jaeqky+w=",
  "yEy7wBfBc+gsYPiQL/4Dfd0pIBZFzMwrtlRQGwMXy3Q=",
  "yrP+EVA1Dw==",
  "vZ23RT7pbSlxwiygkHd1dhToIku8SNHPC6V36L4cnwM=",
  "QX0sLahOByWLcWGnv6l98vQudWqdRI3DOXBdit9bxCE=",
  "WJwgqCmf",
  "BkWI8feqSlDZKMq6awfzWlUypl88nz65KVRmpH0RWIc=",
  "v7EIpiQQjd2BGuJzMbBA0qPWDSS+wTJRQ7uGzZ6rJKs=",
  "1SUReYlCRA==",
  "RougjiFHkSKs20DZ6BWXiWwQUGZXtseZIyQWKz5eG34=",
  "LL97cwoDoG5cw8QmhI+KSWzfW+8VehIh+inTxnVJ2ps=",
  "52iDqjzlqe8=",
  "U9LRYFL2zXU4TtALIYDj+lCATRk/EJtH7/y7qYYNlh8=",
  "e/GtffFDTvnw7LBRixAD+iGixjqTq9kIZ1m0Hj+s6fY=",
  "xb2XwHNB",
];

function getKeyBytes(index: number): number[] {
  const b64 = KEYS[index];
  if (!b64) return [];
  try {
    const buf = Buffer.from(b64, "base64");
    return Array.from(buf).map((b) => b & 0xff);
  } catch {
    return [];
  }
}

function rc4(key: number[], data: number[]): number[] {
  if (key.length === 0) return data.slice();
  const s: number[] = [];
  for (let i = 0; i < 256; i++) s.push(i);
  let j = 0;
  for (let i = 0; i < 256; i++) {
    j = (j + s[i]! + key[i % key.length]!) % 256;
    const t = s[i]!;
    s[i] = s[j]!;
    s[j] = t;
  }
  let i = 0;
  j = 0;
  const out: number[] = new Array(data.length);
  for (let k = 0; k < data.length; k++) {
    i = (i + 1) % 256;
    j = (j + s[i]!) % 256;
    const t = s[i]!;
    s[i] = s[j]!;
    s[j] = t;
    out[k] = data[k]! ^ s[(s[i]! + s[j]!) % 256]!;
  }
  return out;
}

const u8 = (n: number) => ((n % 256) + 256) % 256;
const mutS = (e: number) => u8(e + 143);
const mutL = (e: number) => ((e >>> 1) | (e << 7)) & 255;
const mutC = (e: number) => u8(e + 115);
const mutM = (e: number) => (e ^ 177) & 255;
const mutF = (e: number) => u8(e - 188);
const mutG = (e: number) => ((e << 2) | (e >>> 6)) & 255;
const mutH = (e: number) => u8(e - 42);
const mutDollar = (e: number) => ((e << 4) | (e >>> 4)) & 255;
const mutB = (e: number) => u8(e - 12);
const mutUnderscore = (e: number) => u8(e - 20);
const mutY = (e: number) => ((e >>> 1) | (e << 7)) & 255;
const mutK = (e: number) => u8(e - 241);

function getMutKey(mk: number[], idx: number): number {
  if (mk.length > 0 && idx % 32 < mk.length) {
    return mk[idx % 32]!;
  }
  return 0;
}

function round1(data: number[]): number[] {
  const enc = rc4(getKeyBytes(0), data);
  const mutKey = getKeyBytes(1);
  const prefKey = getKeyBytes(2);
  const out: number[] = [];
  for (let i = 0; i < enc.length; i++) {
    if (i < 7 && i < prefKey.length) out.push(prefKey[i]!);
    let v = enc[i]! ^ getMutKey(mutKey, i);
    switch (i % 10) {
      case 0:
      case 9:
        v = mutC(v);
        break;
      case 1:
        v = mutB(v);
        break;
      case 2:
        v = mutY(v);
        break;
      case 3:
        v = mutDollar(v);
        break;
      case 4:
      case 6:
        v = mutH(v);
        break;
      case 5:
        v = mutS(v);
        break;
      case 7:
        v = mutK(v);
        break;
      case 8:
        v = mutL(v);
        break;
    }
    out.push(v & 255);
  }
  return out;
}

function round2(data: number[]): number[] {
  const enc = rc4(getKeyBytes(3), data);
  const mutKey = getKeyBytes(4);
  const prefKey = getKeyBytes(5);
  const out: number[] = [];
  for (let i = 0; i < enc.length; i++) {
    if (i < 6 && i < prefKey.length) out.push(prefKey[i]!);
    let v = enc[i]! ^ getMutKey(mutKey, i);
    switch (i % 10) {
      case 0:
      case 8:
        v = mutC(v);
        break;
      case 1:
        v = mutB(v);
        break;
      case 2:
      case 6:
        v = mutDollar(v);
        break;
      case 3:
        v = mutH(v);
        break;
      case 4:
      case 9:
        v = mutS(v);
        break;
      case 5:
        v = mutK(v);
        break;
      case 7:
        v = mutUnderscore(v);
        break;
    }
    out.push(v & 255);
  }
  return out;
}

function round3(data: number[]): number[] {
  const enc = rc4(getKeyBytes(6), data);
  const mutKey = getKeyBytes(7);
  const prefKey = getKeyBytes(8);
  const out: number[] = [];
  for (let i = 0; i < enc.length; i++) {
    if (i < 7 && i < prefKey.length) out.push(prefKey[i]!);
    let v = enc[i]! ^ getMutKey(mutKey, i);
    switch (i % 10) {
      case 0:
        v = mutC(v);
        break;
      case 1:
        v = mutF(v);
        break;
      case 2:
      case 8:
        v = mutS(v);
        break;
      case 3:
        v = mutG(v);
        break;
      case 4:
        v = mutY(v);
        break;
      case 5:
        v = mutM(v);
        break;
      case 6:
        v = mutDollar(v);
        break;
      case 7:
        v = mutK(v);
        break;
      case 9:
        v = mutB(v);
        break;
    }
    out.push(v & 255);
  }
  return out;
}

function round4(data: number[]): number[] {
  const enc = rc4(getKeyBytes(9), data);
  const mutKey = getKeyBytes(10);
  const prefKey = getKeyBytes(11);
  const out: number[] = [];
  for (let i = 0; i < enc.length; i++) {
    if (i < 8 && i < prefKey.length) out.push(prefKey[i]!);
    let v = enc[i]! ^ getMutKey(mutKey, i);
    switch (i % 10) {
      case 0:
        v = mutB(v);
        break;
      case 1:
      case 9:
        v = mutM(v);
        break;
      case 2:
      case 7:
        v = mutL(v);
        break;
      case 3:
      case 5:
        v = mutS(v);
        break;
      case 4:
      case 6:
        v = mutUnderscore(v);
        break;
      case 8:
        v = mutY(v);
        break;
    }
    out.push(v & 255);
  }
  return out;
}

function round5(data: number[]): number[] {
  const enc = rc4(getKeyBytes(12), data);
  const mutKey = getKeyBytes(13);
  const prefKey = getKeyBytes(14);
  const out: number[] = [];
  for (let i = 0; i < enc.length; i++) {
    if (i < 6 && i < prefKey.length) out.push(prefKey[i]!);
    let v = enc[i]! ^ getMutKey(mutKey, i);
    switch (i % 10) {
      case 0:
        v = mutUnderscore(v);
        break;
      case 1:
      case 7:
        v = mutS(v);
        break;
      case 2:
        v = mutC(v);
        break;
      case 3:
      case 5:
        v = mutM(v);
        break;
      case 4:
        v = mutB(v);
        break;
      case 6:
        v = mutF(v);
        break;
      case 8:
        v = mutDollar(v);
        break;
      case 9:
        v = mutG(v);
        break;
    }
    out.push(v & 255);
  }
  return out;
}

function urlEncode(s: string): string {
  return encodeURIComponent(s)
    .replace(/\+/g, "%20")
    .replace(/\*/g, "%2A")
    .replace(/%7E/g, "~");
}

function toUrlSafeBase64NoPadding(bytes: number[]): string {
  const b64 = Buffer.from(bytes).toString("base64");
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function generateHash(path: string, bodySize = 0, time = 1): string {
  const baseString = `${path}:${bodySize}:${time}`;
  const encoded = urlEncode(baseString);
  const initialBytes: number[] = [];
  for (let i = 0; i < encoded.length; i++) {
    initialBytes.push(encoded.charCodeAt(i) & 0xff);
  }
  const r1 = round1(initialBytes);
  const r2 = round2(r1);
  const r3 = round3(r2);
  const r4 = round4(r3);
  const r5 = round5(r4);
  return toUrlSafeBase64NoPadding(r5);
}
