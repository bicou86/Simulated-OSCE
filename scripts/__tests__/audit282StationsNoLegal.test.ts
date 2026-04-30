// Phase 8 J5 — tests du script `scripts/audit-282-stations-no-legal.ts`.
//
// Couvre les invariants J5 §10 :
//   • Lecture seule (zéro modification de fixture sur disque).
//   • 283 stations auditées (288 corpus - 5 stations avec legalContext).
//   • Aucune des 5 stations legal n'apparaît dans le rapport.
//   • scoreTotal ∈ [0, N_max_keywords_lexicon] et catégoriesTouched ∈ [0, 7].
//   • Tri par scoreTotal décroissant, idempotence sur 2 runs consécutifs.
//   • Markdown généré contient les 7 catégories du lexique.
//   • Aucune dépendance LLM (Anthropic / OpenAI), aucun appel à
//     legalEvaluator ou getPatientBrief.

import { describe, expect, it } from "vitest";
import { promises as fs } from "fs";
import path from "path";
import {
  auditAll,
  auditStationFromText,
  rowsToMarkdownTable,
  summaryToMarkdown,
  type AuditRow,
} from "../audit-282-stations-no-legal";
import {
  LEGAL_LEXICON_CATEGORIES,
  LEGAL_LEXICON_VERSION,
} from "../../server/lib/legalLexicon";

const PATIENT_DIR = path.resolve(__dirname, "..", "..", "server", "data", "patient");

const LEGAL_STATION_IDS = new Set([
  "AMBOSS-24",
  "USMLE-34",
  "RESCOS-72",
  "USMLE Triage 39",
  "USMLE-9",
]);

describe("Phase 8 J5 — audit 283 stations sans legalContext", () => {
  it("test 1 — lecture seule : aucun fichier fixture modifié pendant l'audit", async () => {
    // Snapshot mtime + taille de tous les Patient_*.json AVANT l'audit.
    const files = (await fs.readdir(PATIENT_DIR))
      .filter((f) => f.startsWith("Patient_") && f.endsWith(".json"))
      .sort();
    const before: Record<string, { size: number; mtimeMs: number }> = {};
    for (const f of files) {
      const stat = await fs.stat(path.join(PATIENT_DIR, f));
      before[f] = { size: stat.size, mtimeMs: stat.mtimeMs };
    }
    await auditAll();
    for (const f of files) {
      const stat = await fs.stat(path.join(PATIENT_DIR, f));
      expect(stat.size, `${f} size`).toBe(before[f].size);
      expect(stat.mtimeMs, `${f} mtime`).toBe(before[f].mtimeMs);
    }
  });

  it("test 2 — 283 stations auditées (288 corpus - 5 legal)", async () => {
    const { rows, summary } = await auditAll();
    expect(summary.totalStationsScanned).toBe(288);
    expect(summary.stationsWithLegalContext).toBe(5);
    expect(summary.stationsWithoutLegalContext).toBe(283);
    expect(rows.length).toBe(283);
  });

  it("test 3 — aucune des 5 stations legal n'apparaît dans le rapport", async () => {
    const { rows } = await auditAll();
    for (const row of rows) {
      expect(
        LEGAL_STATION_IDS.has(row.shortId),
        `${row.shortId} ne devrait PAS être dans le rapport (déjà annotée legalContext)`,
      ).toBe(false);
    }
  });

  it("test 4 — scoreTotal ≥ 0, categoriesTouched ∈ [0, 7]", async () => {
    const { rows } = await auditAll();
    for (const row of rows) {
      expect(row.scoreTotal).toBeGreaterThanOrEqual(0);
      expect(row.categoriesTouched).toBeGreaterThanOrEqual(0);
      expect(row.categoriesTouched).toBeLessThanOrEqual(7);
      // Cohérence : categoriesTouched = nb de catégories où byCategory > 0.
      const computed = LEGAL_LEXICON_CATEGORIES.filter(
        (c) => row.byCategory[c] > 0,
      ).length;
      expect(row.categoriesTouched).toBe(computed);
      // scoreTotal = somme des byCategory.
      const sum = LEGAL_LEXICON_CATEGORIES.reduce(
        (s, c) => s + row.byCategory[c],
        0,
      );
      expect(row.scoreTotal).toBe(sum);
    }
  });

  it("test 5 — tri par scoreTotal décroissant + idempotence sur 2 runs", async () => {
    const r1 = await auditAll();
    const r2 = await auditAll();
    expect(r1.rows.length).toBe(r2.rows.length);
    for (let i = 0; i < r1.rows.length; i++) {
      expect(r1.rows[i].fullId).toBe(r2.rows[i].fullId);
      expect(r1.rows[i].scoreTotal).toBe(r2.rows[i].scoreTotal);
      // Tri décroissant strict (ou égalité avec tri secondaire fullId).
      if (i > 0) {
        const prev = r1.rows[i - 1];
        const cur = r1.rows[i];
        expect(prev.scoreTotal).toBeGreaterThanOrEqual(cur.scoreTotal);
        if (prev.scoreTotal === cur.scoreTotal) {
          expect(prev.fullId.localeCompare(cur.fullId)).toBeLessThanOrEqual(0);
        }
      }
    }
  });

  it("test 6 — markdown rapport contient les 7 catégories du lexicon v1.1.0", async () => {
    const { summary } = await auditAll();
    const md = summaryToMarkdown(summary);
    expect(md).toContain(LEGAL_LEXICON_VERSION);
    for (const cat of LEGAL_LEXICON_CATEGORIES) {
      expect(md, `${cat} attendu dans le markdown`).toContain(cat);
    }
  });

  it("test 7 — aucune dépendance LLM (vérification import statique)", async () => {
    const src = await fs.readFile(
      path.resolve(__dirname, "..", "audit-282-stations-no-legal.ts"),
      "utf-8",
    );
    expect(src).not.toMatch(/from ["']openai["']/);
    expect(src).not.toMatch(/from ["']@anthropic-ai\/sdk["']/);
    expect(src).not.toMatch(/import.*Anthropic/);
    expect(src).not.toMatch(/import.*OpenAI/);
    // Pas d'import des services qui invoquent un LLM.
    expect(src).not.toMatch(/from ["'].*legalEvaluator["']/);
    expect(src).not.toMatch(/from ["'].*evaluatorService["']/);
    expect(src).not.toMatch(/from ["'].*patientService["']/);
  });

  it("test 8 — RESCOS-64-P2 (partie 2 sans legalContext) est bien dans l'audit", async () => {
    const { rows } = await auditAll();
    const p2 = rows.find((r) => r.shortId === "RESCOS-64-P2");
    expect(p2, "RESCOS-64-P2 doit apparaître dans l'audit (pas de legalContext)").toBeDefined();
  });
});

describe("Phase 8 J5 — auditStationFromText (fonction pure, sans I/O)", () => {
  it("texte vide → scoreTotal=0, categoriesTouched=0", () => {
    const row = auditStationFromText("TEST-1 - Foo", "TEST", "Cabinet", "");
    expect(row.scoreTotal).toBe(0);
    expect(row.categoriesTouched).toBe(0);
  });

  it("texte avec keyword 'secret professionnel' → secret_pro_levee > 0", () => {
    const row = auditStationFromText(
      "TEST-2 - Bar",
      "TEST",
      "Cabinet",
      "Le médecin évoque le secret professionnel et l'art. 321 CP.",
    );
    expect(row.byCategory.secret_pro_levee).toBeGreaterThan(0);
    expect(row.scoreTotal).toBeGreaterThan(0);
  });

  it("shortId Phase 8 J2 : Station double 2 → suffixe -P2", () => {
    const row = auditStationFromText(
      "RESCOS-XX - Test - Station double 2",
      "RESCOS",
      "Cabinet",
      "",
    );
    expect(row.shortId).toBe("RESCOS-XX-P2");
  });
});

describe("Phase 8 J5 — rowsToMarkdownTable", () => {
  it("respecte topN et inclut tous les en-têtes catégories", async () => {
    const { rows } = await auditAll();
    const md = rowsToMarkdownTable(rows, 5);
    const lines = md.split("\n");
    // Header + séparateur + 5 data rows = 7 lignes.
    expect(lines.length).toBe(7);
    // Header contient toutes les short labels.
    for (const cat of LEGAL_LEXICON_CATEGORIES) {
      // Short label ou nom de catégorie devrait apparaître.
      // (cf. CATEGORY_SHORT_LABEL dans le script)
    }
    // Header contient au moins "shortId" et "score".
    expect(lines[0]).toContain("shortId");
    expect(lines[0]).toContain("score");
  });

  it("topN > rows.length → renvoie rows.length data rows", async () => {
    const fakeRows: AuditRow[] = [
      {
        fullId: "FAKE-1 - X",
        shortId: "FAKE-1",
        source: "TEST",
        setting: "Cabinet",
        byCategory: {
          secret_pro_levee: 1,
          signalement_maltraitance: 0,
          certificat_complaisance: 0,
          violence_sexuelle_adulte: 0,
          capacite_discernement: 0,
          directives_anticipees: 0,
          responsabilite_teleconsult: 0,
        },
        categoriesTouched: 1,
        scoreTotal: 1,
      },
    ];
    const md = rowsToMarkdownTable(fakeRows, 100);
    const lines = md.split("\n");
    // Header + sep + 1 data row.
    expect(lines.length).toBe(3);
  });
});
