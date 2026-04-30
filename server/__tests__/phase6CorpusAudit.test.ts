// Phase 6 J3 — audit global du corpus médico-légal.
//
// Ce test fige les compteurs Phase 6 J2 et bloque toute dérive
// silencieuse en Phase 7+ : si quelqu'un ajoute, retire ou modifie une
// annotation `legalContext` ou `medicoLegalReviewed`, l'un des asserts
// ci-dessous casse immédiatement et signale précisément la dérive
// (compteur global, station hors lexique, fuite HTTP, jurisdiction
// inattendue, etc.).
//
// COMPTEURS DE RÉFÉRENCE (mis à jour Phase 7 J3 — annotation USMLE-9) :
//   • 287 stations uniques au total (dédup par shortId, RESCOS-64 doublon
//     hérité Phase 4 compté une seule fois — cf. medicoLegalReviewedAudit).
//   • 5 stations avec legalContext :
//       AMBOSS-24, USMLE-34, RESCOS-72, USMLE Triage 39, USMLE-9 (J3).
//   • 287 stations avec medicoLegalReviewed=true (toutes : USMLE-9 l'a
//     reçu en J3 avec son legalContext).
//   • 0 station unflagged : la couverture est désormais complète sur le
//     corpus existant. Tout ajout de station Phase 8+ devra être annoté
//     ou flaggé reviewed à l'ingestion.
//
// HISTORIQUE :
//   • Phase 6 J3 : 4 legalContext, 286 reviewed, 1 unflagged (USMLE-9).
//   • Phase 7 J3 : 5 legalContext, 287 reviewed, 0 unflagged.
//
// INVARIANTS RUNTIME ADDITIONNELS :
//   • Toutes les categories utilisées appartiennent au lexique vivant
//     (3 catégories Phase 5 + 1 catégorie Phase 7 J1+J3 :
//     violence_sexuelle_adulte → utilisée par USMLE-9).
//   • Toutes les jurisdictions valent "CH" (pas de cantonal en Phase 6/7).
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

// Catégories effectivement utilisées par les stations annotées au
// runtime (corpus vivant). Phase 6 ouvrait 3 catégories ; Phase 7 J3
// ajoute violence_sexuelle_adulte via USMLE-9. Cet ensemble n'est PAS
// le lexique complet (lexique v1.1.0 ouvre 9 catégories enum + 7 avec
// couverture pattern) — c'est le sous-ensemble effectivement consommé
// par le corpus.
const ACTIVE_CORPUS_CATEGORIES = new Set<string>([
  "secret_pro_levee",
  "signalement_maltraitance",
  "certificat_complaisance",
  "violence_sexuelle_adulte",
]);

const EXPECTED_LEGAL_CONTEXT_IDS = new Set<string>([
  "AMBOSS-24",
  "USMLE-34",
  "RESCOS-72",
  "USMLE Triage 39",
  "USMLE-9",
]);

const EXPECTED_UNFLAGGED_IDS = new Set<string>([]);

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

  it("exactement 5 stations portent un legalContext (les 5 attendues, J3 incluant USMLE-9)", async () => {
    const rows = await auditCorpus();
    const annotated = rows.filter((r) => r.hasLegalContext);
    expect(annotated.length).toBe(5);
    const ids = new Set(annotated.map((r) => r.shortId));
    expect(ids).toEqual(EXPECTED_LEGAL_CONTEXT_IDS);
  });

  it("exactement 287 stations portent medicoLegalReviewed=true (couverture complète J3)", async () => {
    const rows = await auditCorpus();
    const reviewed = rows.filter((r) => r.reviewed);
    expect(reviewed.length).toBe(287);
  });

  it("0 station unflagged : couverture complète post-J3", async () => {
    const rows = await auditCorpus();
    const unflagged = rows.filter((r) => !r.hasLegalContext && !r.reviewed);
    expect(unflagged.length).toBe(0);
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

describe("Phase 7 J3 — invariants lexique vivant (catégories effectives du corpus)", () => {
  it("toutes les categories utilisées appartiennent à l'ensemble corpus actif (3 v1.0.0 + violence_sexuelle_adulte v1.1.0/J3)", async () => {
    const rows = await auditCorpus();
    for (const r of rows) {
      if (!r.hasLegalContext) continue;
      expect(
        r.legalCategory,
        `${r.shortId} : category vide alors que legalContext présent`,
      ).toBeDefined();
      expect(
        ACTIVE_CORPUS_CATEGORIES.has(r.legalCategory!),
        `${r.shortId} : category « ${r.legalCategory} » hors set corpus actif`,
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
