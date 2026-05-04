// Phase 11 J4-hotfix-3 — vérification du polyfill Buffer côté navigateur
// pour @react-pdf/renderer.
//
// Contexte : @react-pdf/renderer v4.5.1 → pdfkit utilise Buffer (API
// Node.js) pour décoder les images JPEG/PNG embarquées via <Image>. Sans
// polyfill côté navigateur, pdf().toBlob() crashe au runtime
// ("Buffer is not defined") dès qu'un PDF contient au moins une image.
// La correction injecte vite-plugin-node-polyfills avec scope strict sur
// `buffer` dans vite.config.ts.
//
// Ce fichier teste deux invariants :
//   1. Buffer est disponible en tant que constructeur fonctionnel
//      (vrai en Node natif sans polyfill, mais documente le contrat
//      runtime ; le polyfill rend la même API disponible côté browser).
//   2. La configuration Vite contient bien l'entrée nodePolyfills ciblée
//      sur `buffer` (sentinelle de régression : si quelqu'un retire le
//      plugin, ce test casse avant que le bug runtime navigateur réémerge).

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("Phase 11 J4-hotfix-3 — polyfill Buffer pour @react-pdf/renderer", () => {
  it("Buffer global : disponible et fonctionnel (typeof + Buffer.from)", () => {
    expect(typeof globalThis.Buffer).toBe("function");
    expect(Buffer.from("test").length).toBe(4);
    expect(Buffer.from([0x68, 0x69]).toString("utf-8")).toBe("hi");
  });

  it("vite.config.ts : nodePolyfills avec scope strict sur 'buffer'", () => {
    const viteConfigPath = resolve(import.meta.dirname, "../../../vite.config.ts");
    const source = readFileSync(viteConfigPath, "utf-8");
    // L'import du plugin doit être présent.
    expect(source).toMatch(
      /from\s+["']vite-plugin-node-polyfills["']/,
    );
    // L'appel doit cibler explicitement `buffer` dans `include`.
    expect(source).toMatch(/nodePolyfills\(\s*\{[\s\S]*?include:\s*\[\s*["']buffer["']\s*\]/);
    // `Buffer: true` doit être présent dans `globals` (sinon le plugin
    // n'injecte pas la variable globale window.Buffer).
    expect(source).toMatch(/Buffer:\s*true/);
  });
});
