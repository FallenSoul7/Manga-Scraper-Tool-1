import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.comihub.reader",
  appName: "ComiHub",
  webDir: "dist/public",
  bundledWebRuntime: false,
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
