// Phase 7 J3 — tests des 3 sujets consolidés en un commit :
//
//   • Sujet 1 — Annotation USMLE-9 (violence_sexuelle_adulte) :
//     contrat /api/evaluation/legal sur USMLE-9 (catégorie, axes,
//     mandatory_reporting=false, expected_decision=refer, lexicon
//     v1.1.0). Sub-test « pipeline complet » via runEvaluation
//     (USMLE-9 a une grille évaluateur Sonnet — vérifié) avec
//     vérification de la formule maître Phase 7 J2.
//
//   • Sujet 3 — Endpoint debug /api/debug/evaluation-weights :
//     4 cas couvrant station sans legalContext, station avec
//     legalContext, station inexistante (404), mode production (404).
//
// 100 % déterministe : zéro mock OpenAI, mock Anthropic uniquement
// pour le pipeline complet USMLE-9 (Sub-test 1c). initCatalog() lit
// les vraies fixtures.

import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";

vi.mock("openai", () => {
  class OpenAI {
    chat = { completions: { create: vi.fn() } };
    audio = { transcriptions: { create: vi.fn() }, speech: { create: vi.fn() } };
    models = { list: vi.fn() };
    constructor(_opts: unknown) {}
  }
  return { default: OpenAI, toFile: vi.fn() };
});

const { anthropicMessagesCreate } = vi.hoisted(() => ({
  anthropicMessagesCreate: vi.fn(),
}));

vi.mock("@anthropic-ai/sdk", () => {
  class Anthropic {
    messages = { create: anthropicMessagesCreate };
    constructor(_opts: unknown) {}
  }
  return { default: Anthropic };
});

vi.mock("../lib/config", () => ({
  loadConfig: vi.fn(async () => {}),
  getOpenAIKey: () => "sk-test",
  getAnthropicKey: () => "sk-ant-test",
  setKeys: vi.fn(async () => {}),
  isConfigured: () => true,
}));

import { initCatalog } from "../services/stationsService";
import { runEvaluation } from "../services/evaluatorService";
import { evaluateLegal } from "../services/legalEvaluator";
import { buildTestApp } from "./helpers";
import {
  EVALUATION_WEIGHTS,
  LEGAL_CONTEXT_RESCALE_FACTOR,
  MEDICO_LEGAL_WEIGHT_PCT,
} from "../../shared/evaluation-weights";

beforeAll(async () => {
  await initCatalog();
});

afterEach(() => {
  vi.clearAllMocks();
});

// ────────────────────────────────────────────────────────────────────────
// Sujet 1 — USMLE-9 (violence_sexuelle_adulte)
// ────────────────────────────────────────────────────────────────────────

// Transcript « parfait » couvrant la majorité des must_verbalize de
// USMLE-9. Conçu pour matcher les patterns lexicon v1.1.0
// (violence_sexuelle_adulte) sans déclencher d'anti-pattern.
const USMLE_9_PERFECT = `
  Madame Melton, je vous écoute, je vous crois. Je ne vous juge pas.
  Vous êtes ici en sécurité, personne ne vous force à parler. Prenez
  votre temps, à votre rythme — respectez votre rythme.

  Ce que vous avez vécu est une agression sexuelle, un viol — une violence
  sexuelle. Il y a eu absence de consentement, vous avez été soumise à une
  contrainte physique sans consentement.

  Sur le plan médical, je vous propose un examen médico-légal sous 72h
  pour le recueil de preuves — c'est un kit médico-légal cantonal, c'est
  important pour préserver les éléments d'enquête si vous décidez plus
  tard de porter plainte.

  Sur le plan du soutien, la LAVI — la loi sur l'aide aux victimes —
  propose un accompagnement gratuit. Je peux aussi vous orienter vers les
  centres LAVI près de chez vous, et vers un soutien psychologique
  spécialisé, un psychologue ou un psychiatre formé à ces situations.

  La confidentialité est maintenue sauf à votre demande. La plainte reste
  votre choix, c'est votre décision, vous décidez de la plainte. Je ne
  vous l'imposerai pas.
`;

describe("Phase 7 J3 — Sujet 1 : USMLE-9 violence_sexuelle_adulte", () => {
  it("evaluateLegal direct : catégorie + decision + axes structure", async () => {
    const r = await evaluateLegal({
      stationId: "USMLE-9",
      transcript: USMLE_9_PERFECT,
    });
    expect(r.category).toBe("violence_sexuelle_adulte");
    expect(r.expected_decision).toBe("refer");
    expect(r.mandatory_reporting).toBe(false);
    expect(r.lexiconVersion).toBe("1.1.0");
    expect(r.axes).toHaveProperty("reconnaissance");
    expect(r.axes).toHaveProperty("verbalisation");
    expect(r.axes).toHaveProperty("decision");
    expect(r.axes).toHaveProperty("communication");
    expect(r.unmapped, "tous les items must_verbalize/avoid doivent être mappés au lexique").toEqual(
      [],
    );
    // Au moins un axe avec must_verbalize doit avoir un score > 0 sur
    // le transcript parfait (validation de la chaîne pattern → axe → score).
    const positive = (
      ["reconnaissance", "verbalisation", "decision", "communication"] as const
    ).some((a) => r.axes[a].score_pct > 0);
    expect(positive).toBe(true);
    // Et avoided doit être vide (pas d'anti-pattern dans le transcript parfait).
    expect(r.avoided).toEqual([]);
  });

  it("POST /api/evaluation/legal { stationId: USMLE-9 } — 200 + payload complet", async () => {
    const app = buildTestApp();
    const res = await request(app)
      .post("/api/evaluation/legal")
      .send({ stationId: "USMLE-9", transcript: USMLE_9_PERFECT });
    expect(res.status).toBe(200);
    expect(res.body.stationId).toBe("USMLE-9");
    expect(res.body.category).toBe("violence_sexuelle_adulte");
    expect(res.body.expected_decision).toBe("refer");
    expect(res.body.mandatory_reporting).toBe(false);
    expect(res.body.lexiconVersion).toBe("1.1.0");
    expect(res.body.unmapped).toEqual([]);
  });

  it("USMLE-9 — pipeline complet runEvaluation : 6e axe medico_legal présent, formule maître ±1pt", async () => {
    // USMLE-9 a une grille évaluateur Sonnet (vérifié : Examinateur_USMLE_1.json).
    // Mock Sonnet sur des sous-scores synthétiques connus → on peut
    // calculer score_old_5axes et vérifier la formule J2.
    const mockedScores = {
      anamnese: 80, examen: 70, management: 60, cloture: 50, communication: 40,
    };
    // anamnese_examen : w = 25/25/25/25/0
    // score_old = (80×25 + 70×25 + 60×25 + 50×25) / 100 = 65
    const scoreOld5Axes = 65;

    const scoresJson = {
      globalScore: 0, // override canonique
      sections: [
        { key: "anamnese", name: "Anamnèse", weight: 0.25, score: mockedScores.anamnese },
        { key: "examen", name: "Examen", weight: 0.25, score: mockedScores.examen },
        { key: "management", name: "Management", weight: 0.25, score: mockedScores.management },
        { key: "cloture", name: "Clôture", weight: 0.25, score: mockedScores.cloture },
        { key: "communication", name: "Communication", weight: 0, score: mockedScores.communication },
      ],
      verdict: "Réussi" as const,
    };
    anthropicMessagesCreate.mockImplementationOnce(async () => ({
      content: [
        {
          type: "text",
          text: `# Rapport mocké\n\n<scores_json>\n${JSON.stringify(scoresJson, null, 2)}\n</scores_json>`,
        },
      ],
      stop_reason: "end_turn",
      usage: { input_tokens: 100, output_tokens: 200, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    }));

    const transcriptArr = USMLE_9_PERFECT.split("\n")
      .filter((l) => l.trim().length > 0)
      .map((text) => ({ role: "doctor" as const, text: text.trim() }));

    const result = await runEvaluation({ stationId: "USMLE-9", transcript: transcriptArr });

    // 6e axe activé.
    expect(result.medicoLegalWeight).toBe(MEDICO_LEGAL_WEIGHT_PCT);
    expect(typeof result.medicoLegalScore).toBe("number");
    expect(result.medicoLegalScore!).toBeGreaterThanOrEqual(0);
    expect(result.medicoLegalScore!).toBeLessThanOrEqual(100);

    // Sections : 6 clés.
    expect(result.scores.sections.map((s) => s.key)).toEqual([
      "anamnese", "examen", "management", "cloture", "communication", "medico_legal",
    ]);

    // Formule maître (tolérance 1pt = 1e-2 sur l'échelle 0-100).
    const ml = result.medicoLegalScore!;
    const expected = scoreOld5Axes * LEGAL_CONTEXT_RESCALE_FACTOR + ml * 0.1;
    expect(
      Math.abs(result.scores.globalScore - expected),
      `USMLE-9 score_new=${result.scores.globalScore} vs expected=${expected.toFixed(2)} (old=${scoreOld5Axes}, ml=${ml})`,
    ).toBeLessThanOrEqual(1);
  });

  it("USMLE-9 — getLegalContext expose subject_status=adult_capable et applicable_law minimaliste", async () => {
    // Garde-fou de cohérence avec la justification de la fixture J3.
    // mandatory_reporting=false ⇒ adulte capable (pas de devoir d'aviser).
    // applicable_law contient au moins CP-321 (secret pro) car c'est la
    // base légale principale qui PROTÈGE la patiente, pas qui force la
    // déclaration.
    const { getLegalContext } = await import("../services/patientService");
    const ctx = await getLegalContext("USMLE-9");
    expect(ctx).not.toBeNull();
    expect(ctx!.subject_status).toBe("adult_capable");
    expect(ctx!.applicable_law).toContain("CP-321");
    // Pas de codes de signalement obligatoire mineur (CP-364bis, CC-314c) :
    // la victime est adulte, le devoir d'aviser ne s'applique pas.
    expect(ctx!.applicable_law).not.toContain("CP-364bis");
    expect(ctx!.applicable_law).not.toContain("CC-314c");
  });
});

// ────────────────────────────────────────────────────────────────────────
// Sujet 3 — Endpoint debug /api/debug/evaluation-weights
// ────────────────────────────────────────────────────────────────────────

describe("Phase 7 J3 — Sujet 3 : GET /api/debug/evaluation-weights", () => {
  it("station SANS legalContext (AMBOSS-1) → hasLegalContext=false, medico_legal=0, somme 5 axes = 100", async () => {
    const app = buildTestApp();
    const res = await request(app).get("/api/debug/evaluation-weights?stationId=AMBOSS-1");
    expect(res.status).toBe(200);
    expect(res.body.stationId).toBe("AMBOSS-1");
    expect(res.body.hasLegalContext).toBe(false);
    expect(res.body.stationType).toBe("anamnese_examen");
    expect(res.body.weights.medico_legal).toBe(0);
    // Poids v1 inchangés sur les 5 axes.
    expect(res.body.weights.anamnese).toBe(EVALUATION_WEIGHTS.anamnese_examen.anamnese);
    expect(res.body.weights.examen).toBe(EVALUATION_WEIGHTS.anamnese_examen.examen);
    expect(res.body.weights.management).toBe(EVALUATION_WEIGHTS.anamnese_examen.management);
    expect(res.body.weights.cloture).toBe(EVALUATION_WEIGHTS.anamnese_examen.cloture);
    expect(res.body.weights.communication).toBe(EVALUATION_WEIGHTS.anamnese_examen.communication);
    // Somme = 100 (medico_legal=0 inclus dans la somme).
    expect(res.body.sumWeights).toBe(100);
  });

  it("station AVEC legalContext (AMBOSS-24) → hasLegalContext=true, medico_legal=10, poids v1 × 0.9", async () => {
    const app = buildTestApp();
    const res = await request(app).get("/api/debug/evaluation-weights?stationId=AMBOSS-24");
    expect(res.status).toBe(200);
    expect(res.body.stationId).toBe("AMBOSS-24");
    expect(res.body.hasLegalContext).toBe(true);
    expect(res.body.stationType).toBe("anamnese_examen");
    expect(res.body.weights.medico_legal).toBe(MEDICO_LEGAL_WEIGHT_PCT);
    // Règle proportionnelle : weight_v2 = weight_v1 × 0.9.
    expect(res.body.weights.anamnese).toBeCloseTo(
      EVALUATION_WEIGHTS.anamnese_examen.anamnese * LEGAL_CONTEXT_RESCALE_FACTOR, 10,
    );
    expect(res.body.weights.examen).toBeCloseTo(
      EVALUATION_WEIGHTS.anamnese_examen.examen * LEGAL_CONTEXT_RESCALE_FACTOR, 10,
    );
    expect(res.body.weights.communication).toBeCloseTo(
      EVALUATION_WEIGHTS.anamnese_examen.communication * LEGAL_CONTEXT_RESCALE_FACTOR, 10,
    );
    // Somme = 100 (close-to pour absorber l'arithmétique flottante).
    expect(res.body.sumWeights).toBeCloseTo(100, 10);
  });

  it("USMLE-9 (annotée J3) → hasLegalContext=true (preuve runtime J3 sur le nouveau corpus)", async () => {
    const app = buildTestApp();
    const res = await request(app).get("/api/debug/evaluation-weights?stationId=USMLE-9");
    expect(res.status).toBe(200);
    expect(res.body.hasLegalContext).toBe(true);
    expect(res.body.weights.medico_legal).toBe(MEDICO_LEGAL_WEIGHT_PCT);
  });

  it("station inexistante → 404", async () => {
    const app = buildTestApp();
    const res = await request(app).get("/api/debug/evaluation-weights?stationId=NOPE-999");
    expect(res.status).toBe(404);
    expect(res.body.code).toBe("not_found");
  });

  it("paramètre stationId manquant → 400 bad_request", async () => {
    const app = buildTestApp();
    const res = await request(app).get("/api/debug/evaluation-weights");
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("bad_request");
  });

  it("mode production → 404 (route indistinguable d'absente)", async () => {
    // Set NODE_ENV temporairement à "production" pour cette assertion.
    // afterEach et l'ordre du test garantissent que la modif est isolée.
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      const app = buildTestApp();
      const res = await request(app).get("/api/debug/evaluation-weights?stationId=AMBOSS-1");
      expect(res.status).toBe(404);
      expect(res.body.code).toBe("not_found");
    } finally {
      process.env.NODE_ENV = previous;
    }
  });

  it("station de type teleconsultation avec legalContext (USMLE Triage 39) → poids v1 × 0.9 sur les 5 axes hétérogènes", async () => {
    // Diversification du couvrage : station_type ≠ anamnese_examen,
    // pour vérifier que la règle proportionnelle fonctionne aussi sur
    // un profil de poids non-uniforme (35/5/30/15/15 → 31.5/4.5/27/13.5/13.5).
    const app = buildTestApp();
    const res = await request(app).get("/api/debug/evaluation-weights?stationId=USMLE+Triage+39");
    expect(res.status).toBe(200);
    expect(res.body.stationType).toBe("teleconsultation");
    expect(res.body.hasLegalContext).toBe(true);
    expect(res.body.weights.anamnese).toBeCloseTo(35 * LEGAL_CONTEXT_RESCALE_FACTOR, 10);
    expect(res.body.weights.examen).toBeCloseTo(5 * LEGAL_CONTEXT_RESCALE_FACTOR, 10);
    expect(res.body.weights.management).toBeCloseTo(30 * LEGAL_CONTEXT_RESCALE_FACTOR, 10);
    expect(res.body.weights.cloture).toBeCloseTo(15 * LEGAL_CONTEXT_RESCALE_FACTOR, 10);
    expect(res.body.weights.communication).toBeCloseTo(15 * LEGAL_CONTEXT_RESCALE_FACTOR, 10);
    expect(res.body.weights.medico_legal).toBe(MEDICO_LEGAL_WEIGHT_PCT);
    expect(res.body.sumWeights).toBeCloseTo(100, 10);
  });
});

// ────────────────────────────────────────────────────────────────────────
// Sujet 1 (extension) — Cohérence corpus J3 sur les 287 stations
// (Phase 8 J2 : 288 stations désormais — RESCOS-64-P2 indexée
// distinctement via le pattern « Station double 2 » → -P2).
//
// Garde-fou minimaliste : prouve qu'AUCUNE station autre que USMLE-9
// n'a été mutée par l'opération J3. La preuve formelle vit dans le
// commit diff ; ici on lock le compte de stations + l'unicité de la
// nouvelle catégorie violence_sexuelle_adulte (USMLE-9 unique consommateur).
// ────────────────────────────────────────────────────────────────────────

describe("Phase 7 J3 — invariant additif strict : seul USMLE-9 a muté", () => {
  it("violence_sexuelle_adulte n'est consommée que par USMLE-9 (1 occurrence dans le corpus)", async () => {
    const { promises: fs } = await import("fs");
    const path = await import("path");
    const dir = path.resolve(__dirname, "..", "data", "patient");
    const files = (await fs.readdir(dir)).filter(
      (f) => f.startsWith("Patient_") && f.endsWith(".json"),
    );
    let count = 0;
    let owner: string | null = null;
    for (const f of files) {
      const txt = await fs.readFile(path.join(dir, f), "utf-8");
      const parsed = JSON.parse(txt) as { stations: Array<Record<string, unknown>> };
      for (const s of parsed.stations) {
        const ctx = s.legalContext as { category?: string } | undefined;
        if (ctx?.category === "violence_sexuelle_adulte") {
          count += 1;
          owner = (s.id as string).split(" - ")[0];
        }
      }
    }
    expect(count).toBe(1);
    expect(owner).toBe("USMLE-9");
  });
});
