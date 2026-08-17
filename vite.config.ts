import path from "node:path";

import prerender from "@prerenderer/rollup-plugin";
import react from "@vitejs/plugin-react-swc";
import { defineConfig } from "vitest/config";

// https://vitejs.dev/config/
export default defineConfig(() => ({
  server: {
    host: "::",
    port: 8080,
  },
  plugins: [
    react(),
    prerender({
      routes: [
        "/",
        "/popular",
        "/docs",
        "/docs/humans",
        "/docs/technical",
        "/docs/about",
      ],
      // CI runs this build as root inside a container, where Chrome refuses to
      // start under its setuid sandbox. GitLab hid that by building in the
      // puppeteer image; ngit-ci uses the coordinator's own, so say it here.
      rendererOptions: {
        launchOptions: {
          args: ["--no-sandbox", "--disable-setuid-sandbox"],
        },
      },
    }),
  ],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
    onConsoleLog(log) {
      return !log.includes("React Router Future Flag Warning");
    },
    env: {
      DEBUG_PRINT_LIMIT: '0', // Suppress DOM output that exceeds AI context windows
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
}));