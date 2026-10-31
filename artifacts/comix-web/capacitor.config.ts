import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.comihub.reader",
  appName: "ComiHub",
  webDir: "dist/public",
  bundledWebRuntime: false,
  plugins: {
    // Capacitor 8 bundles CapacitorHttp with @capacitor/core. Keep its fetch/XHR
    // patch enabled so calls made through clientFetch use native networking in
    // installed Android/iOS builds instead of the WebView's CORS-enforced fetch.
    CapacitorHttp: {
      enabled: true,
    },
    LiveUpdate: {
      publicKey: "-----BEGIN PUBLIC KEY-----\nMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAqMiyusT3YGvNcROCsaO9\nmTYAnUh+jcNFHgBpTUmn3Vh6q/TiCZs6ilOc/luEwcl44Z+48VZFjV7kRipsbScS\nFer07QuWURM5qGZwXKsha6e9efYp1pMiq09oj5rrpV34CLNsxxp6TEkAkn4MDdG0\nsY0tUJxWnDnAIr4fCvjeX6+lgM9F0vZFo5oleu4rkSJyhRSlD1DhCpDUtQy7c5Bh\nienRbU2u2edGnQ9JBk7mpwwx5JpTHV4zqcLkFAdKwlActQ6AY5f7N68At0oDIlcG\n8A/7264jo223nmWWuPfr1kJXEbG3KEzdAJIn2h1vEZkZgm5R3/9BtH4htTW8/l4M\niQIDAQAB\n-----END PUBLIC KEY-----",
      readyTimeout: 30_000,
      autoBlockRolledBackBundles: true,
      autoDeleteBundles: true,
    },
  },
  ios: {
    contentInset: "automatic",
    backgroundColor: "#000000",
  },
  server: {
    // Production builds load the bundled Vite files. Do not enable a remote
    // server URL in the distributed app; that would weaken offline behavior.
    cleartext: false,
  },
};

export default config;
