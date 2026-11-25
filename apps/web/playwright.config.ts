import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./browser",
  use: { baseURL: "http://127.0.0.1:48736", channel: "chrome" },
  webServer: {
    command: "vp build && vp preview --host 127.0.0.1 --port 48736 --strictPort",
    url: "http://127.0.0.1:48736",
  },
});
