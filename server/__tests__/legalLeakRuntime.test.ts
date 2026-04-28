// Phase 5 J3 — E2E sans mock LLM : vérifie que /api/patient/:id/brief
// (la « feuille de porte » consultée par le client au démarrage de la
// simulation) ne fuit AUCUN champ médico-légal pour les 3 pilotes
// Phase 5. C'est l'invariant Phase 5 A : le candidat ne voit jamais le
// rationale, la décision attendue, les red flags, ni les listes
// must_verbalize/must_avoid avant son évaluation.
//
// Tests buildés sur le VRAI catalogue (initCatalog) + le VRAI router
// HTTP (buildTestApp), avec supertest pour rester proche de l'usage
// client. 0 mock SDK requis : le brief n'invoque aucun LLM.

import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { promises as fs } from "fs";
import path from "path";
import { initCatalog } from "../services/stationsService";
import { buildTestApp } from "./helpers";
import {
  LEGAL_BLACKLIST_TERMS,
  LEGAL_LAW_CODE_PATTERNS,
} from "../lib/legalLexicon";

const PATIENT_DIR = path.resolve(__dirname, "..", "data", "patient");

async function loadStationRaw(file: string, shortId: string): Promise<any> {
  const raw = await fs.readFile(path.join(PATIENT_DIR, file), "utf-8");
  const parsed = JSON.parse(raw) as { stations: Array<{ id: string }> };
  return parsed.stations.find((s) => s.id.startsWith(shortId + " "));
}

beforeAll(async () => {
  await initCatalog();
});

const PILOTS = [
  { shortId: "AMBOSS-24", file: "Patient_AMBOSS_2.json" },
  { shortId: "USMLE-34", file: "Patient_USMLE_2.json" },
  { shortId: "RESCOS-72", file: "Patient_RESCOS_4.json" },
] as const;

describe("Phase 5 J3 — /api/patient/:id/brief : pas de leak médico-légal", () => {
  it.each(PILOTS)(
    "$shortId : la réponse JSON ne contient AUCUN champ legalContext",
    async ({ shortId }) => {
      const app = buildTestApp();
      const res = await request(app).get(`/api/patient/${shortId}/brief`);
      expect(res.status).toBe(200);
      // Champs strippés.
      expect(res.body).not.toHaveProperty("legalContext");
      expect(res.body).not.toHaveProperty("decision_rationale");
      expect(res.body).not.toHaveProperty("applicable_law");
      expect(res.body).not.toHaveProperty("red_flags");
      expect(res.body).not.toHaveProperty("candidate_must_verbalize");
      expect(res.body).not.toHaveProperty("candidate_must_avoid");
      expect(res.body).not.toHaveProperty("expected_decision");
      expect(res.body).not.toHaveProperty("mandatory_reporting");
    },
  );

  it.each(PILOTS)(
    "$shortId : aucun pattern de detectPatterns d'un code applicable_law n'apparaît dans le JSON sérialisé",
    async ({ shortId, file }) => {
      const station = await loadStationRaw(file, shortId);
      const codes: string[] = station.legalContext.applicable_law;
      const app = buildTestApp();
      const res = await request(app).get(`/api/patient/${shortId}/brief`);
      const serialized = JSON.stringify(res.body);
      const leaks: string[] = [];
      for (const code of codes) {
        const spec = LEGAL_LAW_CODE_PATTERNS[code];
        if (!spec) continue;
        for (const re of spec.detectPatterns) {
          if (re.test(serialized)) {
            leaks.push(`${code} (${re.source})`);
          }
        }
      }
      expect(
        leaks,
        `${shortId} : codes leakés dans /brief : ${leaks.join(" ; ")}`,
      ).toEqual([]);
    },
  );

  it.each(PILOTS)(
    "$shortId : aucun item textuel de must_verbalize/must_avoid/red_flags n'apparaît dans /brief",
    async ({ shortId, file }) => {
      const station = await loadStationRaw(file, shortId);
      const ctx = station.legalContext;
      const app = buildTestApp();
      const res = await request(app).get(`/api/patient/${shortId}/brief`);
      const serialized = JSON.stringify(res.body);
      // decision_rationale est l'inventaire complet — sa présence
      // signifierait une régression majeure.
      expect(serialized).not.toContain(ctx.decision_rationale);
      for (const v of [
        ...ctx.candidate_must_verbalize,
        ...ctx.candidate_must_avoid,
        ...ctx.red_flags,
      ]) {
        expect(serialized, `« ${v } » a fui dans /brief ${shortId}`).not.toContain(v);
      }
    },
  );

  // Invariant additionnel : les acronymes institutionnels (APEA, LAVI,
  // FMH, CDM) ne doivent pas apparaître dans /brief. Un brief contient
  // typiquement « setting / patient_description / vitals / ouverture » —
  // aucune raison narrative d'y trouver ces acronymes pour les 3 pilotes
  // Phase 5 (alors qu'ils peuvent figurer dans le system prompt LLM via
  // motif_cache, lui non exposé au client).
  it.each(PILOTS)(
    "$shortId : aucun acronyme institutionnel (APEA / LAVI / FMH / CDM) dans /brief",
    async ({ shortId }) => {
      const app = buildTestApp();
      const res = await request(app).get(`/api/patient/${shortId}/brief`);
      const serialized = JSON.stringify(res.body);
      for (const t of LEGAL_BLACKLIST_TERMS) {
        // On garde uniquement les acronymes purs (pas les mots composés
        // qui pourraient apparaître naturellement dans un brief).
        if (!/^(APEA|LAVI|FMH|CDM)/i.test(t.term)) continue;
        for (const re of t.detectPatterns) {
          expect(re.test(serialized), `${shortId} : ${t.term} a fui dans /brief`).toBe(false);
        }
      }
    },
  );
});
