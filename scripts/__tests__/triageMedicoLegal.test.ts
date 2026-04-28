// Phase 6 J1 — tests du script de triage médico-légal.
//
// Couvre les 8 invariants documentés dans le brief :
//   1. Le script tourne sur les 287 stations sans crash.
//   2. Les 3 pilotes Phase 5 (AMBOSS-24, USMLE-34, RESCOS-72) sont
//      classés A avec leur catégorie (auto-cohérence).
//   3. Mutex statut : aucune station n'est classée à la fois A et B.
//   4. Toute station status A a une suggested_category dans
//      {secret_pro_levee, signalement_maltraitance, certificat_complaisance}.
//   5. Le CSV produit est valide RFC 4180 (parsing round-trip).
//   6. Counts par statut sommés = 287 (exhaustivité).
//   7. Aucune dépendance OpenAI/Anthropic dans le script (grep statique).
//   8. Heuristiques déterministes (2 runs = même CSV).

import { promises as fs } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import {
  CSV_HEADERS,
  rowsToCsv,
  summarize,
  triageAll,
  triageOne,
  type TriageRow,
} from "../triage-medico-legal";

const PATIENT_DIR = path.resolve(__dirname, "..", "..", "server", "data", "patient");
const SCRIPT_PATH = path.resolve(__dirname, "..", "triage-medico-legal.ts");

// Helpers ─────────────────────────────────────────────────────────────

let cachedRows: TriageRow[] | undefined;
async function getRows(): Promise<TriageRow[]> {
  if (cachedRows) return cachedRows;
  cachedRows = await triageAll(PATIENT_DIR);
  return cachedRows;
}

const ALLOWED_A_CATEGORIES = new Set([
  "secret_pro_levee",
  "signalement_maltraitance",
  "certificat_complaisance",
]);

// Parser CSV minimal RFC 4180 — utilisé pour le round-trip test 5.
// Gère les guillemets doublés, virgules dans les cellules quotées, et
// les sauts de ligne dans les cellules quotées (que notre script ne
// produit pas, mais on reste robuste).
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let i = 0;
  let inQuotes = false;
  while (i < text.length) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i += 2;
        continue;
      }
      if (c === '"') {
        inQuotes = false;
        i += 1;
        continue;
      }
      cell += c;
      i += 1;
      continue;
    }
    if (c === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (c === ",") {
      row.push(cell);
      cell = "";
      i += 1;
      continue;
    }
    if (c === "\n" || c === "\r") {
      // Fin de ligne (sauf ligne vide finale).
      row.push(cell);
      cell = "";
      if (row.length > 1 || row[0] !== "") rows.push(row);
      row = [];
      // Skipper \r\n ensemble.
      if (c === "\r" && text[i + 1] === "\n") i += 2;
      else i += 1;
      continue;
    }
    cell += c;
    i += 1;
  }
  // Dernière cellule si pas de newline final.
  if (cell !== "" || row.length > 0) {
    row.push(cell);
    if (row.length > 1 || row[0] !== "") rows.push(row);
  }
  return rows;
}

// ─── Tests ───────────────────────────────────────────────────────────

describe("Phase 6 J1 — triage médico-légal : sanity & exhaustivité", () => {
  it("test 1 — le script tourne sur les 287 stations sans crash", async () => {
    const rows = await getRows();
    expect(rows.length).toBe(287);
    for (const r of rows) {
      expect(r.id.length).toBeGreaterThan(0);
      expect(["A", "B", "C"]).toContain(r.suggested_status);
    }
  });

  it("test 6 — counts par statut sommés = 287 (exhaustivité)", async () => {
    const rows = await getRows();
    const s = summarize(rows);
    expect(s.total).toBe(287);
    expect(s.byStatus.A + s.byStatus.B + s.byStatus.C).toBe(287);
  });
});

describe("Phase 6 J1 — auto-cohérence avec les 3 pilotes Phase 5", () => {
  it("test 2a — AMBOSS-24 ressort status A / secret_pro_levee", async () => {
    const rows = await getRows();
    const r = rows.find((x) => x.id === "AMBOSS-24");
    expect(r).toBeDefined();
    expect(r!.suggested_status).toBe("A");
    expect(r!.suggested_category).toBe("secret_pro_levee");
    expect(r!.already_annotated).toBe(true);
  });

  it("test 2b — USMLE-34 ressort status A / signalement_maltraitance", async () => {
    const rows = await getRows();
    const r = rows.find((x) => x.id === "USMLE-34");
    expect(r).toBeDefined();
    expect(r!.suggested_status).toBe("A");
    expect(r!.suggested_category).toBe("signalement_maltraitance");
    expect(r!.already_annotated).toBe(true);
  });

  it("test 2c — RESCOS-72 ressort status A / certificat_complaisance", async () => {
    const rows = await getRows();
    const r = rows.find((x) => x.id === "RESCOS-72");
    expect(r).toBeDefined();
    expect(r!.suggested_status).toBe("A");
    expect(r!.suggested_category).toBe("certificat_complaisance");
    expect(r!.already_annotated).toBe(true);
  });

  it("test 2d — summarize.pilotsCheckOk = true", async () => {
    const rows = await getRows();
    const s = summarize(rows);
    expect(s.pilotsCheckOk).toBe(true);
  });
});

describe("Phase 6 J1 — invariants de classification", () => {
  it("test 3 — mutex statut : aucune station n'a 2 statuts simultanés", async () => {
    const rows = await getRows();
    // Triplement-check : par construction `suggested_status` est un
    // discriminant unique. On vérifie qu'il appartient bien à {A,B,C}
    // et qu'aucune ligne ne porte de double tag accidentel.
    for (const r of rows) {
      const matches = ["A", "B", "C"].filter((s) => s === r.suggested_status);
      expect(matches.length, `${r.id} doit avoir exactement 1 statut`).toBe(1);
    }
  });

  it("test 4 — toute station status A a une suggested_category dans les 3 catégories Phase 5", async () => {
    const rows = await getRows();
    const aRows = rows.filter((r) => r.suggested_status === "A");
    expect(aRows.length).toBeGreaterThan(0);
    for (const r of aRows) {
      expect(
        ALLOWED_A_CATEGORIES.has(r.suggested_category),
        `${r.id} a category=« ${r.suggested_category} » hors des 3 catégories Phase 5`,
      ).toBe(true);
    }
  });

  it("toute station status B a une suggested_category vide", async () => {
    const rows = await getRows();
    for (const r of rows.filter((x) => x.suggested_status === "B")) {
      expect(r.suggested_category).toBe("");
    }
  });

  it("toute station status C a une suggested_category vide", async () => {
    const rows = await getRows();
    for (const r of rows.filter((x) => x.suggested_status === "C")) {
      expect(r.suggested_category).toBe("");
    }
  });
});

describe("Phase 6 J1 — CSV RFC 4180", () => {
  it("test 5 — round-trip : rows → csv → parsed = rows", async () => {
    const rows = await getRows();
    const csv = rowsToCsv(rows);
    const parsed = parseCsv(csv);
    // Header + 287 lignes.
    expect(parsed.length).toBe(rows.length + 1);
    expect(parsed[0]).toEqual([...CSV_HEADERS]);
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const p = parsed[i + 1];
      expect(p[0], `id row ${i}`).toBe(r.id);
      expect(p[1], `source row ${i}`).toBe(r.source);
      expect(p[2], `title row ${i}`).toBe(r.title);
      expect(p[3], `setting row ${i}`).toBe(r.setting);
      expect(p[4], `stationType row ${i}`).toBe(r.stationType);
      expect(p[5], `suggested_status row ${i}`).toBe(r.suggested_status);
      expect(p[6], `suggested_category row ${i}`).toBe(r.suggested_category);
      expect(parseFloat(p[7]), `confidence row ${i}`).toBeCloseTo(r.confidence, 2);
      expect(p[8], `rationale row ${i}`).toBe(r.rationale);
      expect(p[9], `already_annotated row ${i}`).toBe(r.already_annotated ? "true" : "false");
    }
  });

  it("le CSV produit échappe correctement les virgules dans les rationales", async () => {
    const rows = await getRows();
    const csv = rowsToCsv(rows);
    // Les rationales contiennent souvent des virgules → on doit voir
    // des cellules quotées dans le CSV. Sinon, le parsing aurait planté
    // sur le test 5. On asserte juste qu'au moins une cellule est
    // quotée pour confirmer que l'échappement actif.
    expect(csv).toMatch(/"[^"]*,[^"]*"/);
  });
});

describe("Phase 6 J1 — déterminisme", () => {
  it("test 8 — 2 runs successifs produisent EXACTEMENT le même CSV", async () => {
    const rows1 = await triageAll(PATIENT_DIR);
    const rows2 = await triageAll(PATIENT_DIR);
    const csv1 = rowsToCsv(rows1);
    const csv2 = rowsToCsv(rows2);
    expect(csv1).toBe(csv2);
  });
});

describe("Phase 6 J1 — pas de dépendance LLM", () => {
  it("test 7 — le script n'importe ni openai ni @anthropic-ai/sdk", async () => {
    const code = await fs.readFile(SCRIPT_PATH, "utf-8");
    // grep statique : interdire les imports/require de SDK LLM.
    expect(code).not.toMatch(/from\s+["']openai["']/);
    expect(code).not.toMatch(/from\s+["']@anthropic-ai\/sdk["']/);
    expect(code).not.toMatch(/require\(["']openai["']\)/);
    expect(code).not.toMatch(/require\(["']@anthropic-ai\/sdk["']\)/);
  });

  it("aucun fetch HTTP côté triage (pas d'API call externe)", async () => {
    const code = await fs.readFile(SCRIPT_PATH, "utf-8");
    expect(code).not.toMatch(/\bfetch\(/);
    expect(code).not.toMatch(/\bhttps?\.request\(/);
    expect(code).not.toMatch(/\baxios\b/);
  });
});

describe("Phase 6 J1 — heuristiques unitaires", () => {
  it("triageOne : station avec legalContext présent → status A + already_annotated=true", () => {
    const r = triageOne({
      source: "AMBOSS",
      raw: {
        id: "AMBOSS-99 - Test fixture - 28 ans",
        setting: "Cabinet",
        patient_description: "Femme 28 ans",
        legalContext: { category: "secret_pro_levee" },
      },
    });
    expect(r.suggested_status).toBe("A");
    expect(r.suggested_category).toBe("secret_pro_levee");
    expect(r.already_annotated).toBe(true);
    expect(r.confidence).toBe(1.0);
  });

  it("triageOne : mineur + violence → A / signalement_maltraitance", () => {
    const r = triageOne({
      source: "RESCOS",
      raw: {
        id: "TEST-1 - Maltraitance enfant",
        patient_description: "Garçon 6 ans, ecchymoses multiples, trauma non expliqué",
        age: 6,
      },
    });
    expect(r.suggested_status).toBe("A");
    expect(r.suggested_category).toBe("signalement_maltraitance");
  });

  it("triageOne : suicide explicit → A / secret_pro_levee", () => {
    const r = triageOne({
      source: "RESCOS",
      raw: {
        id: "TEST-2 - Idées suicidaires",
        patient_description: "Femme 35 ans, idées suicidaires depuis 2 semaines",
        age: 35,
      },
    });
    expect(r.suggested_status).toBe("A");
    expect(r.suggested_category).toBe("secret_pro_levee");
  });

  it("triageOne : demande certificat pour voyage → A / certificat_complaisance", () => {
    const r = triageOne({
      source: "RESCOS",
      raw: {
        id: "TEST-3 - Certificat pour voyage",
        patient_description: "Homme 30 ans, demande arrêt de travail pour voyage personnel",
        age: 30,
      },
    });
    expect(r.suggested_status).toBe("A");
    expect(r.suggested_category).toBe("certificat_complaisance");
  });

  it("triageOne : station clinique routinière → status B", () => {
    const r = triageOne({
      source: "RESCOS",
      raw: {
        id: "TEST-4 - Douleurs abdominales banales - 35 ans",
        setting: "Cabinet",
        patient_description: "Femme 35 ans, douleurs abdominales depuis 2 jours",
        age: 35,
      },
    });
    expect(r.suggested_status).toBe("B");
    expect(r.suggested_category).toBe("");
  });

  it("triageOne : pédiatrie sans red flag → status C", () => {
    const r = triageOne({
      source: "RESCOS",
      raw: {
        id: "TEST-5 - Toux chez nourrisson - 5 mois",
        setting: "Cabinet pédiatrique",
        patient_description: "Nourrisson 5 mois, toux depuis 3 jours, mère présente",
        age: 0,
      },
    });
    expect(r.suggested_status).toBe("C");
  });
});
