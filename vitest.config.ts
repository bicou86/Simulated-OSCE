import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "client", "src"),
      "@shared": path.resolve(import.meta.dirname, "shared"),
    },
  },
  test: {
    // Tests client dans happy-dom (besoin de fetch/FormData/Blob/URL), tests serveur en node.
    environmentMatchGlobs: [
      ["client/**", "happy-dom"],
      ["server/**", "node"],
    ],
    include: ["client/src/**/*.test.{ts,tsx}", "server/**/*.test.ts"],
    globals: false,
    restoreMocks: true,
  },
});
