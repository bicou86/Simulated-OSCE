// Phase 6 J2 — tests du script d'application des annotations.
// Phase 7 J3 — mises à jour : USMLE-9 a reçu une annotation legalContext
// directe (violence_sexuelle_adulte) + medicoLegalReviewed=true en J3
// — hors du périmètre du script applyTriageJ2 (qui ne traite que les
// stations status A/B du CSV J1, sans toucher au status C). Les
// invariants du script lui-même restent stricts ; ce sont les
// assertions de l'état corpus qui ont évolué (286→287 reviewed).
//
// Couvre les 8 invariants documentés dans le brief J2 (mise à jour J3) :
//   1. Le script tourne sur les 286 stations cibles sans crash.
//   2. USMLE Triage 39 reçoit legalContext.category="signalement_maltraitance".
//   3. USMLE Triage 39 reçoit medicoLegalReviewed=true.
//   4. Les 285 autres stations B reçoivent medicoLegalReviewed=true
//      SANS legalContext.
//   5. USMLE-9 — annotée Phase 7 J3 indépendamment du script
//      (violence_sexuelle_adulte direct fixture edit).
//   6. Idempotence — 2 runs successifs produisent le même état.
//   7. Aucune fixture ne perd de champs (les champs existants sont
//      préservés byte-for-byte sauf l'ajout des champs additifs).
//   8. Pas de modification du brief patient (champs name/age/symptoms
//      etc. inchangés).

import { promises as fs } from "fs";
import path from "path";
import os from "os";
import { describe, expect, it } from "vitest";
import {
  applyTriageJ2,
  USMLE_TRIAGE_39_LEGAL_CONTEXT,
} from "../apply-triage-j2";

const PROJECT_ROOT = path.resolve(__dirname, "..", "..");
const PATIENT_DIR = path.join(PROJECT_ROOT, "server", "data", "patient");
const VALIDATED_CSV = path.join(
  PROJECT_ROOT,
  "triage-output",
  "phase-6-j1-validated.csv",
);
const SCRIPT_PATH = path.join(PROJECT_ROOT, "scripts", "apply-triage-j2.ts");

// ─── Helpers ──────────────────────────────────────────────────────────

async function loadAllStations(): Promise<
  Array<{ shortId: string; data: Record<string, unknown> }>
> {
  const out: Array<{ shortId: string; data: Record<string, unknown> }> = [];
  const files = (await fs.readdir(PATIENT_DIR))
    .filter((f) => f.startsWith("Patient_") && f.endsWith(".json"))
    .sort();
  const seen = new Set<string>();
  for (const f of files) {
    const txt = await fs.readFile(path.join(PATIENT_DIR, f), "utf-8");
    const parsed = JSON.parse(txt) as { stations: Array<Record<string, unknown>> };
    for (const s of parsed.stations) {
      const fullId = s.id as string;
      const shortId = fullId.split(" - ")[0];
      if (seen.has(shortId)) continue;
      seen.add(shortId);
      out.push({ shortId, data: s });
    }
  }
  return out;
}

function findStation(
  rows: Array<{ shortId: string; data: Record<string, unknown> }>,
  shortId: string,
): Record<string, unknown> {
  const r = rows.find((x) => x.shortId === shortId);
  if (!r) throw new Error(`station introuvable : ${shortId}`);
  return r.data;
}

// ─── Tests directs sur les fixtures actuelles (post-J2 appliqué) ────

describe("Phase 6 J2 — état post-application sur les fixtures", () => {
  it("test 1 — applyTriageJ2 sans crash + 0 erreurs (run idempotent)", async () => {
    const stats = await applyTriageJ2({ write: false });
    expect(stats.errors).toEqual([]);
    // En mode idempotent, tout est already flagged / already present.
    expect(stats.flagged).toBe(0);
    expect(stats.legalContextAdded).toBe(0);
  });

  it("test 2 — USMLE Triage 39 a legalContext.category = signalement_maltraitance", async () => {
    const rows = await loadAllStations();
    const s = findStation(rows, "USMLE Triage 39");
    const ctx = s.legalContext as { category?: string } | undefined;
    expect(ctx).toBeDefined();
    expect(ctx!.category).toBe("signalement_maltraitance");
  });

  it("USMLE Triage 39 : applicable_law contient les codes attendus (CP-364bis + CC-314c minimum)", async () => {
    const rows = await loadAllStations();
    const s = findStation(rows, "USMLE Triage 39");
    const ctx = s.legalContext as { applicable_law?: string[] };
    expect(ctx.applicable_law).toBeDefined();
    expect(ctx.applicable_law).toContain("CP-364bis");
    expect(ctx.applicable_law).toContain("CC-314c");
  });

  it("USMLE Triage 39 : expected_decision=report + mandatory_reporting=true", async () => {
    const rows = await loadAllStations();
    const s = findStation(rows, "USMLE Triage 39");
    const ctx = s.legalContext as { expected_decision?: string; mandatory_reporting?: boolean };
    expect(ctx.expected_decision).toBe("report");
    expect(ctx.mandatory_reporting).toBe(true);
  });

  it("test 3 — USMLE Triage 39 a medicoLegalReviewed=true", async () => {
    const rows = await loadAllStations();
    const s = findStation(rows, "USMLE Triage 39");
    expect(s.medicoLegalReviewed).toBe(true);
  });

  it("test 4 — 287 stations ont medicoLegalReviewed=true (post-J3 : USMLE-9 désormais annotée)", async () => {
    const rows = await loadAllStations();
    const reviewed = rows.filter((r) => r.data.medicoLegalReviewed === true);
    // Phase 6 J2 : 286 marquées (status C USMLE-9 exclu).
    // Phase 7 J3 : couverture complète, USMLE-9 reçoit violence_sexuelle_adulte.
    expect(reviewed.length).toBe(287);
  });

  it("les 285 stations B (sauf 4 status A) ont medicoLegalReviewed=true SANS legalContext", async () => {
    const rows = await loadAllStations();
    const A_IDS = new Set([
      "AMBOSS-24",
      "USMLE-34",
      "RESCOS-72",
      "USMLE Triage 39",
    ]);
    let count = 0;
    for (const r of rows) {
      if (A_IDS.has(r.shortId)) continue;
      if (r.shortId === "USMLE-9") continue;
      expect(
        r.data.medicoLegalReviewed,
        `${r.shortId} doit avoir medicoLegalReviewed=true`,
      ).toBe(true);
      expect(
        r.data.legalContext,
        `${r.shortId} ne doit PAS avoir legalContext`,
      ).toBeUndefined();
      count += 1;
    }
    // 287 - 4 (A) - 1 (C USMLE-9) = 282 stations B.
    expect(count).toBe(282);
  });

  it("test 5 — USMLE-9 (status C J1, annotée J3) reçoit legalContext + medicoLegalReviewed=true", async () => {
    // Phase 6 J2 : USMLE-9 était sans flag (status C, reportée Phase 7).
    // Phase 7 J3 : annotation directe (HORS script applyTriageJ2 qui
    // continue de skip le status C par design — l'annotation USMLE-9
    // est un edit fixture manuel J3, pas une régénération via le CSV).
    const rows = await loadAllStations();
    const s = findStation(rows, "USMLE-9");
    expect(s.medicoLegalReviewed).toBe(true);
    const ctx = s.legalContext as { category?: string } | undefined;
    expect(ctx).toBeDefined();
    expect(ctx!.category).toBe("violence_sexuelle_adulte");
  });

  it("les 4 stations status A ont toutes medicoLegalReviewed=true ET legalContext", async () => {
    const rows = await loadAllStations();
    for (const id of ["AMBOSS-24", "USMLE-34", "RESCOS-72", "USMLE Triage 39"]) {
      const s = findStation(rows, id);
      expect(s.medicoLegalReviewed, `${id}.medicoLegalReviewed`).toBe(true);
      expect(s.legalContext, `${id}.legalContext`).toBeDefined();
    }
  });
});

// ─── Tests d'idempotence + préservation byte-for-byte ───────────────

describe("Phase 6 J2 — idempotence et préservation des fixtures", () => {
  it("test 6 — 2 runs successifs (dry) produisent le même état", async () => {
    const stats1 = await applyTriageJ2({ write: false });
    const stats2 = await applyTriageJ2({ write: false });
    expect(stats1).toEqual(stats2);
    // Et les stats sont en mode "déjà appliqué".
    expect(stats1.flagged).toBe(0);
    expect(stats1.alreadyFlagged).toBe(286);
    expect(stats1.legalContextAdded).toBe(0);
    expect(stats1.legalContextAlreadyPresent).toBe(1);
  });

  it("test 7 — fixtures conservent tous leurs champs originaux + ajouts (pas de perte)", async () => {
    // On utilise une fixture temp avec des champs uniques connus, on
    // applique J2 dessus, on vérifie que tous les champs initiaux sont
    // préservés byte-for-byte ET que les champs additifs sont ajoutés.
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "phase6-j2-test-"));
    const tmpPatientDir = path.join(tmp, "patient");
    await fs.mkdir(tmpPatientDir, { recursive: true });
    const originalStation = {
      id: "TEST-LEGACY-1 - Test fixture - Femme 28 ans",
      setting: "Cabinet",
      patient_description: "Femme 28 ans, dorsalgie",
      age: "28 ans",
      vitals: { ta: "120/80 mmHg", fc: "72 bpm" },
      antecedents: { medicaux: "RAS" },
      uniqueProperty: "VALEUR_UNIQUE_TEST_PRESERVATION",
    };
    const fileBody = {
      type: "PATIENT",
      source: "RESCOS",
      stations: [originalStation],
    };
    const tmpFile = path.join(tmpPatientDir, "Patient_TEST.json");
    await fs.writeFile(tmpFile, JSON.stringify(fileBody, null, 2), "utf-8");
    const tmpCsv = path.join(tmp, "validated.csv");
    await fs.writeFile(
      tmpCsv,
      "id,human_validated_status,human_validated_category\nTEST-LEGACY-1,B,\n",
      "utf-8",
    );

    const stats = await applyTriageJ2({
      patientDir: tmpPatientDir,
      csvPath: tmpCsv,
      write: true,
    });
    expect(stats.errors).toEqual([]);
    expect(stats.flagged).toBe(1);

    const after = JSON.parse(await fs.readFile(tmpFile, "utf-8"));
    const s = after.stations[0];
    // Champ marqueur unique préservé.
    expect(s.uniqueProperty).toBe("VALEUR_UNIQUE_TEST_PRESERVATION");
    // Tous les champs originaux préservés.
    expect(s.id).toBe(originalStation.id);
    expect(s.setting).toBe(originalStation.setting);
    expect(s.patient_description).toBe(originalStation.patient_description);
    expect(s.age).toBe(originalStation.age);
    expect(s.vitals).toEqual(originalStation.vitals);
    expect(s.antecedents).toEqual(originalStation.antecedents);
    // Champ additif posé.
    expect(s.medicoLegalReviewed).toBe(true);
    // Pas de legalContext (status B).
    expect(s.legalContext).toBeUndefined();

    await fs.rm(tmp, { recursive: true, force: true });
  });

  it("test 7b — re-écrire le même fichier en idempotent ne produit AUCUN diff texte", async () => {
    // Sur le repo réel : run dry, sauver le contenu, run write, sauver
    // à nouveau, comparer byte-for-byte.
    const file = path.join(PATIENT_DIR, "Patient_USMLE_Triage_2.json");
    const before = await fs.readFile(file, "utf-8");
    const stats = await applyTriageJ2({ write: true });
    expect(stats.errors).toEqual([]);
    expect(stats.filesWritten).toBe(0); // idempotent, rien à écrire
    const after = await fs.readFile(file, "utf-8");
    expect(after).toBe(before);
  });
});

// ─── Test 8 — pas de modification du brief patient ──────────────────

describe("Phase 6 J2 — invariant brief patient inchangé", () => {
  it("test 8 — getPatientBrief() N'EXPOSE PAS medicoLegalReviewed", async () => {
    // Import dynamique pour éviter de charger stationsService au top-level
    // (qui aurait son propre boot).
    const { initCatalog } = await import("../../server/services/stationsService");
    const { getPatientBrief } = await import("../../server/services/patientService");
    await initCatalog();

    // 4 stations annotées + 5 témoins (cf. brief J2 récap §10).
    const targets = [
      "AMBOSS-24",
      "USMLE-34",
      "RESCOS-72",
      "USMLE Triage 39",
      "AMBOSS-1",
      "RESCOS-1",
      "RESCOS-7",
      "USMLE-1",
      "German-1",
    ];
    for (const id of targets) {
      const brief = await getPatientBrief(id);
      const json = JSON.stringify(brief);
      expect(json, `${id} : medicoLegalReviewed leak`).not.toContain("medicoLegalReviewed");
      expect(json, `${id} : legalContext leak`).not.toContain("legalContext");
    }
  });
});

// ─── Sanity static : pas de dépendance LLM dans le script ────────────

describe("Phase 6 J2 — pas de dépendance LLM", () => {
  it("le script n'importe ni openai ni @anthropic-ai/sdk, ni fetch", async () => {
    const code = await fs.readFile(SCRIPT_PATH, "utf-8");
    expect(code).not.toMatch(/from\s+["']openai["']/);
    expect(code).not.toMatch(/from\s+["']@anthropic-ai\/sdk["']/);
    expect(code).not.toMatch(/\bfetch\(/);
    expect(code).not.toMatch(/\baxios\b/);
  });
});

// ─── USMLE_TRIAGE_39_LEGAL_CONTEXT — sanity sur le constant exporté ──

describe("Phase 6 J2 — USMLE_TRIAGE_39_LEGAL_CONTEXT sanity", () => {
  it("la constante respecte le schéma legalContext (4 catégories minimum)", () => {
    const c = USMLE_TRIAGE_39_LEGAL_CONTEXT;
    expect(c.category).toBe("signalement_maltraitance");
    expect(c.jurisdiction).toBe("CH");
    expect(c.subject_status).toBe("minor");
    expect(c.expected_decision).toBe("report");
    expect(c.mandatory_reporting).toBe(true);
    expect(c.applicable_law.length).toBeGreaterThanOrEqual(2);
    expect(c.candidate_must_verbalize.length).toBeGreaterThanOrEqual(4);
    expect(c.candidate_must_avoid.length).toBeGreaterThanOrEqual(3);
    expect(c.red_flags.length).toBeGreaterThanOrEqual(3);
    expect(c.decision_rationale.length).toBeGreaterThan(100);
  });
});
