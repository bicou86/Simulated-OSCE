import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import runtimeErrorOverlay from "@replit/vite-plugin-runtime-error-modal";
import { nodePolyfills } from "vite-plugin-node-polyfills";
import { metaImagesPlugin } from "./vite-plugin-meta-images";

export default defineConfig({
  plugins: [
    react(),
    runtimeErrorOverlay(),
    tailwindcss(),
    // Phase 11 J4-hotfix-3 — polyfill Buffer minimal pour @react-pdf/renderer.
    // pdfkit (dépendance transitive de @react-pdf/renderer v4.5.1) utilise
    // Buffer (API Node.js) pour décoder les images JPEG/PNG embarquées via
    // <Image>. Sans polyfill, pdf().toBlob() crashe au runtime navigateur
    // ("Buffer is not defined") dès que le PDF contient au moins une image.
    // On limite strictement le polyfill à `buffer` pour minimiser le bundle
    // et éviter les régressions sur les autres globals Node (process, fs…).
    nodePolyfills({
      include: ["buffer"],
      globals: { Buffer: true, global: false, process: false },
      protocolImports: false,
    }),
    metaImagesPlugin(),
    ...(process.env.NODE_ENV !== "production" &&
    process.env.REPL_ID !== undefined
      ? [
          await import("@replit/vite-plugin-cartographer").then((m) =>
            m.cartographer(),
          ),
          await import("@replit/vite-plugin-dev-banner").then((m) =>
            m.devBanner(),
          ),
        ]
      : []),
  ],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "client", "src"),
      "@shared": path.resolve(import.meta.dirname, "shared"),
      "@assets": path.resolve(import.meta.dirname, "attached_assets"),
    },
  },
  css: {
    postcss: {
      plugins: [],
    },
  },
  root: path.resolve(import.meta.dirname, "client"),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
  },
  server: {
    host: "0.0.0.0",
    allowedHosts: true,
    fs: {
      strict: true,
      deny: ["**/.*"],
    },
  },
});
