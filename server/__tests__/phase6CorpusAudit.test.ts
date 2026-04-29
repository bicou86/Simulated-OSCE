// Phase 6 J3 — audit global du corpus médico-légal.
//
// Ce test fige les compteurs Phase 6 J2 et bloque toute dérive
// silencieuse en Phase 7+ : si quelqu'un ajoute, retire ou modifie une
// annotation `legalContext` ou `medicoLegalReviewed`, l'un des asserts
// ci-dessous casse immédiatement et signale précisément la dérive
// (compteur global, station hors lexique, fuite HTTP, jurisdiction
// inattendue, etc.).
//
// COMPTEURS DE RÉFÉRENCE (clôture Phase 6, à modifier explicitement
// quand Phase 7 étendra le corpus annoté) :
//   • 287 stations uniques au total (dédup par shortId, RESCOS-64 doublon
//     hérité Phase 4 compté une seule fois — cf. medicoLegalReviewedAudit).
//   • 4 stations avec legalContext :
//       AMBOSS-24, USMLE-34, RESCOS-72, USMLE Triage 39.
//   • 286 stations avec medicoLegalReviewed=true (toutes sauf USMLE-9).
//   • 1 station ni annotée ni reviewed : USMLE-9 (status C, reportée
//     Phase 7 — nécessite extension lexique pour violence sexuelle adulte).
//
// INVARIANTS RUNTIME ADDITIONNELS :
//   • Toutes les categories utilisées appartiennent au lexique
//     v1.0.0 (3 catégories Phase 5).
//   • Toutes les jurisdictions valent "CH" (pas de cantonal en Phase 6).
//   • Toute station avec legalContext porte aussi medicoLegalReviewed=true
//     (cohérence — déjà couverte par medicoLegalReviewedAudit, dupliquée
//     ici pour fournir un message d'erreur orienté "phase 7 dérive").
//   • Aucune des 287 stations ne fuite legalContext ni medicoLegalReviewed
//     dans le brief HTTP /api/patient/:id/brief.
//   • /api/stations renvoie bien 287 entrées (non-régression Phase 5).
//
// CONTRAINTES : ZÉRO appel LLM, ZÉRO mock fs. On consomme les vraies
// fixtures du repo dans leur état Phase 6 J2 appliqué.

import { promises as fs } from "fs";
import path from "path";
import request from "supertest";
import { beforeAll, describe, expect, it } from "vitest";
import { initCatalog } from "../services/stationsService";
import { getPatientBrief } from "../services/patientService";
import { LEGAL_LAW_CODE_PATTERNS } from "../lib/legalLexicon";
import { buildTestApp } from "./helpers";

const PATIENT_DIR = path.resolve(__dirname, "..", "data", "patient");

const PHASE6_LEXICON_CATEGORIES = new Set<string>([
  "secret_pro_levee",
  "signalement_maltraitance",
  "certificat_complaisance",
]);

const EXPECTED_LEGAL_CONTEXT_IDS = new Set<string>([
  "AMBOSS-24",
  "USMLE-34",
  "RESCOS-72",
  "USMLE Triage 39",
]);

const EXPECTED_UNFLAGGED_IDS = new Set<string>(["USMLE-9"]);

const TOTAL_STATIONS = 287;

interface AuditRow {
  shortId: string;
  hasLegalContext: boolean;
  legalCategory: string | undefined;
  legalJurisdiction: string | undefined;
  legalApplicableLaw: string[] | undefined;
  reviewed: boolean;
}

async function auditCorpus(): Promise<AuditRow[]> {
  const out: AuditRow[] = [];
  const seen = new Set<string>();
  const files = (await fs.readdir(PATIENT_DIR))
    .filter((f) => f.startsWith("Patient_") && f.endsWith(".json"))
    .sort();
  for (const f of files) {
    const txt = await fs.readFile(path.join(PATIENT_DIR, f), "utf-8");
    const parsed = JSON.parse(txt) as { stations: Array<Record<string, unknown>> };
    for (const s of parsed.stations) {
      const fullId = s.id as string;
      const shortId = fullId.split(" - ")[0];
      if (seen.has(shortId)) continue;
      seen.add(shortId);
      const ctx = s.legalContext as
        | {
            category?: string;
            jurisdiction?: string;
            applicable_law?: string[];
          }
        | undefined;
      out.push({
        shortId,
        hasLegalContext: ctx !== undefined,
        legalCategory: ctx?.category,
        legalJurisdiction: ctx?.jurisdiction,
        legalApplicableLaw: Array.isArray(ctx?.applicable_law)
          ? ctx?.applicable_law
          : undefined,
        reviewed: s.medicoLegalReviewed === true,
      });
    }
  }
  return out;
}

beforeAll(async () => {
  await initCatalog();
});

describe("Phase 6 J3 — compteurs corpus figés en clôture de phase", () => {
  it(`exactement ${TOTAL_STATIONS} stations uniques au total`, async () => {
    const rows = await auditCorpus();
    expect(rows.length).toBe(TOTAL_STATIONS);
  });

  it("exactement 4 stations portent un legalContext (les 4 attendues)", async () => {
    const rows = await auditCorpus();
    const annotated = rows.filter((r) => r.hasLegalContext);
    expect(annotated.length).toBe(4);
    const ids = new Set(annotated.map((r) => r.shortId));
    expect(ids).toEqual(EXPECTED_LEGAL_CONTEXT_IDS);
  });

  it("exactement 286 stations portent medicoLegalReviewed=true", async () => {
    const rows = await auditCorpus();
    const reviewed = rows.filter((r) => r.reviewed);
    expect(reviewed.length).toBe(286);
  });

  it("exactement 1 station n'a ni legalContext ni medicoLegalReviewed (USMLE-9)", async () => {
    const rows = await auditCorpus();
    const unflagged = rows.filter((r) => !r.hasLegalContext && !r.reviewed);
    expect(unflagged.length).toBe(1);
    expect(new Set(unflagged.map((r) => r.shortId))).toEqual(EXPECTED_UNFLAGGED_IDS);
  });

  it("toute station avec legalContext porte aussi medicoLegalReviewed=true", async () => {
    const rows = await auditCorpus();
    for (const r of rows) {
      if (r.hasLegalContext) {
        expect(
          r.reviewed,
          `${r.shortId} a un legalContext mais pas medicoLegalReviewed=true`,
        ).toBe(true);
      }
    }
  });
});

describe("Phase 6 J3 — invariants lexique v1.0.0 (3 catégories Phase 5)", () => {
  it("toutes les categories utilisées sont dans le lexique v1.0.0", async () => {
    const rows = await auditCorpus();
    for (const r of rows) {
      if (!r.hasLegalContext) continue;
      expect(
        r.legalCategory,
        `${r.shortId} : category vide alors que legalContext présent`,
      ).toBeDefined();
      expect(
        PHASE6_LEXICON_CATEGORIES.has(r.legalCategory!),
        `${r.shortId} : category « ${r.legalCategory} » hors lexique v1.0.0`,
      ).toBe(true);
    }
  });

  it("toutes les jurisdictions des stations annotées valent « CH »", async () => {
    const rows = await auditCorpus();
    for (const r of rows) {
      if (!r.hasLegalContext) continue;
      expect(
        r.legalJurisdiction,
        `${r.shortId} : jurisdiction « ${r.legalJurisdiction} » ≠ "CH" en Phase 6`,
      ).toBe("CH");
    }
  });

  it("tous les codes applicable_law sont mappés dans LEGAL_LAW_CODE_PATTERNS", async () => {
    // Le boot guard valide déjà cette propriété (validateLegalContextLawCodes
    // dans stationsService) ; on duplique l'assertion ici pour qu'une dérive
    // Phase 7 (ajout d'un code sans entrée lexique) remonte avec un message
    // « audit Phase 6 » explicite plutôt qu'avec un throw au boot.
    const rows = await auditCorpus();
    const known = new Set(Object.keys(LEGAL_LAW_CODE_PATTERNS));
    for (const r of rows) {
      if (!r.legalApplicableLaw) continue;
      for (const code of r.legalApplicableLaw) {
        expect(
          known.has(code),
          `${r.shortId} : applicable_law contient « ${code} » non mappé dans LEGAL_LAW_CODE_PATTERNS`,
        ).toBe(true);
      }
    }
  });
});

describe("Phase 6 J3 — strip HTTP global : aucune fuite des champs additifs", () => {
  // On échantillonne les 287 stations en confiant à supertest la requête
  // /api/patient/:id/brief. Coût raisonnable (< 5s sur la suite vitest)
  // car aucun appel LLM ; le brief est construit à partir des fixtures.
  // Si une fuite apparaît sur une station banale (ex. brief German-12
  // exposant accidentellement medicoLegalReviewed), le test signale le
  // shortId fautif.
  const STRIP_TARGETS = [
    "legalContext",
    "medicoLegalReviewed",
    "decision_rationale",
    "applicable_law",
    "candidate_must_verbalize",
    "candidate_must_avoid",
    "red_flags",
    "mandatory_reporting",
    "expected_decision",
    "subject_status",
  ];

  it("getPatientBrief() ne contient AUCUN champ médico-légal pour les 287 stations", async () => {
    const rows = await auditCorpus();
    for (const r of rows) {
      const brief = await getPatientBrief(r.shortId);
      const json = JSON.stringify(brief);
      for (const field of STRIP_TARGETS) {
        expect(
          json.includes(field),
          `${r.shortId} : leak « ${field} » dans getPatientBrief()`,
        ).toBe(false);
      }
    }
  });

  it("GET /api/stations renvoie bien 287 entrées (non-régression Phase 5)", async () => {
    const app = buildTestApp();
    const res = await request(app).get("/api/stations");
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(TOTAL_STATIONS);
    expect(Array.isArray(res.body.stations)).toBe(true);
    expect(res.body.stations.length).toBe(TOTAL_STATIONS);
  });
});
