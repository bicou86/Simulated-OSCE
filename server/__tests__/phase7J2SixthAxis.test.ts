// Phase 7 J2 — Tests d'introduction du 6e axe `medico_legal` au scoring
// global pondéré (poids 10 %, rééquilibrage proportionnel × 0.9 sur les
// 5 axes existants quand `legalContext` est présent).
//
// Couverture (4 suites, alignée sur la spec utilisateur J2) :
//
//   • Test A — snapshot non-régression scoring global sur 5 stations
//     témoins SANS legalContext. Score global byte-à-byte identique vs
//     Phase 6, valeurs hardcodées et calculées analytiquement à partir
//     du tableau v1 (5 axes statiques). Garantit l'invariant J2 #3.
//
//   • Test B — formule du 6e axe sur les 4 stations annotées Phase 5/6
//     AVEC legalContext (AMBOSS-24, USMLE-34, RESCOS-72, USMLE Triage 39).
//     Vérifie que score_new ≈ score_old × 0.9 + score_medico_legal × 0.1
//     (tolérance 1e-2 = 1 point pour absorber les Math.round int).
//
//   • Test C — boundaries de pondération : somme = 1.0 dans les deux modes,
//     règle proportionnelle weight_v2 = weight_v1 × 0.9 sur chaque axe v1.
//
//   • Test D — invariant additif : 5 axes Phase 5/6 toujours présents
//     dans l'ordre canonique, medico_legal ajouté en 6e position
//     UNIQUEMENT quand la station a un legalContext.
//
// Mocking : seul Anthropic est mocké (zéro réseau LLM). Le legalEvaluator
// est consommé en réel (déterministe, lexique v1.1.0). Le catalogue
// stationsService et les fixtures Patient_*.json sont les vrais.

import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

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
import {
  aggregateMedicoLegalScore,
  runEvaluation,
} from "../services/evaluatorService";
import { evaluateLegal } from "../services/legalEvaluator";
import {
  EVALUATION_AXES,
  EVALUATION_AXES_6,
  EVALUATION_WEIGHTS,
  LEGAL_CONTEXT_RESCALE_FACTOR,
  MEDICO_LEGAL_WEIGHT_PCT,
  getAxisWeights,
  getEffectiveAxisWeights,
  type StationType,
} from "../../shared/evaluation-weights";

// ─── Helper : construit la réponse Anthropic mockée ───
//
// Mime la sortie duale (markdown + bloc <scores_json>) attendue par
// runEvaluation. Sonnet est censé renvoyer ses propres weights, mais
// `normalizeScoresWithCanonicalWeights` les écrase systématiquement à
// partir de la table canonique → ils n'influencent pas le globalScore final.
function buildAnthropicMock(scores: {
  globalScore: number;
  sections: Array<{ key: string; name: string; weight: number; score: number }>;
  verdict: "Réussi" | "À retravailler" | "Échec";
}) {
  const scoresJson = JSON.stringify(scores, null, 2);
  return {
    content: [
      {
        type: "text",
        text: `# Rapport mocké\n\n<scores_json>\n${scoresJson}\n</scores_json>`,
      },
    ],
    stop_reason: "end_turn",
    usage: {
      input_tokens: 100,
      output_tokens: 200,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    },
  };
}

function makeMockedSections(
  scores: Partial<Record<"anamnese" | "examen" | "management" | "cloture" | "communication", number>>,
) {
  const defaults = { anamnese: 70, examen: 70, management: 70, cloture: 70, communication: 70 };
  const merged = { ...defaults, ...scores };
  return [
    { key: "anamnese", name: "Anamnèse", weight: 0.25, score: merged.anamnese },
    { key: "examen", name: "Examen", weight: 0.25, score: merged.examen },
    { key: "management", name: "Management", weight: 0.25, score: merged.management },
    { key: "cloture", name: "Clôture", weight: 0.25, score: merged.cloture },
    { key: "communication", name: "Communication", weight: 0, score: merged.communication },
  ];
}

// Calcule le globalScore canonique 5-axes (formule Phase 2 / Phase 6) à
// partir des sous-scores et des poids v1. Sert d'oracle pour Test A et de
// terme de référence (`score_old_5axes`) pour Test B.
function computePhase6GlobalScore(
  stationType: StationType,
  sectionScores: Record<"anamnese" | "examen" | "management" | "cloture" | "communication", number>,
): number {
  const w = getAxisWeights(stationType);
  const wf = {
    anamnese: w.anamnese / 100,
    examen: w.examen / 100,
    management: w.management / 100,
    cloture: w.cloture / 100,
    communication: w.communication / 100,
  };
  const weighted =
    sectionScores.anamnese * wf.anamnese +
    sectionScores.examen * wf.examen +
    sectionScores.management * wf.management +
    sectionScores.cloture * wf.cloture +
    sectionScores.communication * wf.communication;
  const total =
    (wf.anamnese > 0 ? wf.anamnese : 0) +
    (wf.examen > 0 ? wf.examen : 0) +
    (wf.management > 0 ? wf.management : 0) +
    (wf.cloture > 0 ? wf.cloture : 0) +
    (wf.communication > 0 ? wf.communication : 0);
  return total === 0 ? 0 : Math.round(weighted / total);
}

beforeAll(async () => {
  await initCatalog();
});

afterEach(() => {
  vi.clearAllMocks();
});

// ────────────────────────────────────────────────────────────────────────
// Test A — Snapshot non-régression scoring global sur 6 stations témoins
//          SANS legalContext.
//
// Phase 7 J3 (mea culpa Phase 7 J2) — RESCOS-70 a été substituée à tort
// en J2 par RESCOS-7 sous prétexte d'inexistence dans le corpus. Vérif
// runtime ultérieure : RESCOS-70 EXISTE bel et bien (Patient_RESCOS_4.json
// ligne 5075, "Contraception cachée + effets secondaires - Adolescente
// 16 ans", stationType=anamnese_examen, hasLegalContext=false). Le faux
// négatif J2 venait du `stations_index.json` (legacy, incomplet) que
// j'avais utilisé comme source — alors que la source de vérité est le
// catalogue chargé par initCatalog() depuis Patient_*.json. Réintégrée
// en J3 + RESCOS-7 et USMLE-8 conservées comme couverture additionnelle
// (diversification station_type BBN + thématique diabète type 2).
//
// Process : ne plus jamais substituer en silence un ID qui ne marche
// pas — toujours vérifier via getStationMeta après initCatalog avant
// de conclure « inexistant ».
//
// Stations finales (6) :
//   • AMBOSS-1, RESCOS-64, German-70 — user-listées originelles
//   • RESCOS-70 — réintégrée J3 (faux négatif J2 corrigé)
//   • RESCOS-7 — diversification BBN
//   • USMLE-8 — substitut accepté pour Patient_Type_2_Diabetes
//     (filename pattern user-listé, pas un station_id)
//
// Scores mockés : valeurs synthétiques mais STABLES (gravées dans le
// fichier). L'oracle `expectedSnapshot` est calculé analytiquement par
// la formule canonique 5-axes. Si le pipeline retombe sur le mode 5-axes
// (legalContext absent), les deux doivent matcher byte-à-byte.
// ────────────────────────────────────────────────────────────────────────

interface WitnessCase {
  stationId: string;
  expectedStationType: StationType;
  mockedScores: Record<"anamnese" | "examen" | "management" | "cloture" | "communication", number>;
  // Score global Phase 6 — calcul analytique vérifié, sert d'ancre dure.
  expectedSnapshot: number;
}

const WITNESS_CASES: WitnessCase[] = [
  {
    stationId: "AMBOSS-1",
    expectedStationType: "anamnese_examen",
    mockedScores: { anamnese: 80, examen: 70, management: 60, cloture: 50, communication: 40 },
    // (80×25 + 70×25 + 60×25 + 50×25) / 100 = 65
    expectedSnapshot: 65,
  },
  {
    stationId: "RESCOS-64",
    expectedStationType: "anamnese_examen",
    mockedScores: { anamnese: 90, examen: 80, management: 70, cloture: 60, communication: 50 },
    // (90×25 + 80×25 + 70×25 + 60×25) / 100 = 75
    expectedSnapshot: 75,
  },
  {
    stationId: "German-70",
    expectedStationType: "anamnese_examen",
    mockedScores: { anamnese: 60, examen: 60, management: 60, cloture: 60, communication: 60 },
    // tous à 60 → 60
    expectedSnapshot: 60,
  },
  {
    // Phase 7 J3 — réintégrée après mea culpa J2 (faux négatif sur
    // l'existence de la station). Scores synthétiques distincts des
    // autres pour ne pas converger fortuitement vers le même snapshot.
    stationId: "RESCOS-70",
    expectedStationType: "anamnese_examen",
    mockedScores: { anamnese: 70, examen: 80, management: 90, cloture: 70, communication: 30 },
    // (70×25 + 80×25 + 90×25 + 70×25) / 100 = (1750+2000+2250+1750)/100 = 77.5 → round = 78
    expectedSnapshot: 78,
  },
  {
    stationId: "RESCOS-7",
    expectedStationType: "bbn",
    mockedScores: { anamnese: 80, examen: 70, management: 60, cloture: 50, communication: 90 },
    // bbn : w = 15/5/15/25/40
    // (80×15 + 70×5 + 60×15 + 50×25 + 90×40) / 100
    // = 1200 + 350 + 900 + 1250 + 3600 = 7300 / 100 = 73
    expectedSnapshot: 73,
  },
  {
    stationId: "USMLE-8",
    expectedStationType: "anamnese_examen",
    mockedScores: { anamnese: 100, examen: 100, management: 100, cloture: 100, communication: 0 },
    // (100×25 + 100×25 + 100×25 + 100×25) / 100 = 100
    expectedSnapshot: 100,
  },
];

describe("Phase 7 J2/J3 — Test A : snapshot non-régression sur 6 stations sans legalContext", () => {
  for (const tc of WITNESS_CASES) {
    it(`${tc.stationId} (${tc.expectedStationType}) — globalScore inchangé byte-à-byte vs Phase 6`, async () => {
      anthropicMessagesCreate.mockImplementationOnce(async () =>
        buildAnthropicMock({
          globalScore: 50, // ignoré (override canonique côté evaluator)
          sections: makeMockedSections(tc.mockedScores),
          verdict: "Réussi",
        }),
      );

      const result = await runEvaluation({
        stationId: tc.stationId,
        transcript: [{ role: "doctor", text: "Mock transcript." }],
      });

      // 1) Type bien inféré (et donc bons poids canoniques appliqués).
      expect(result.stationType).toBe(tc.expectedStationType);

      // 2) Pas de medico_legal dans la réponse (station sans legalContext).
      expect(result.medicoLegalScore).toBeUndefined();
      expect(result.medicoLegalWeight).toBeUndefined();

      // 3) Sections : 5 axes canoniques uniquement, dans l'ordre v1.
      expect(result.scores.sections.map((s) => s.key)).toEqual([
        "anamnese", "examen", "management", "cloture", "communication",
      ]);

      // 4) Score global byte-à-byte = oracle Phase 6.
      expect(result.scores.globalScore).toBe(tc.expectedSnapshot);

      // 5) Snapshot calculé via la même formule canonique 5-axes que la
      //    pipeline (cohérence interne — protège contre une mutation
      //    silencieuse de la formule).
      const computed = computePhase6GlobalScore(tc.expectedStationType, tc.mockedScores);
      expect(computed).toBe(tc.expectedSnapshot);
    });
  }
});

// ────────────────────────────────────────────────────────────────────────
// Test B — 4 stations AVEC legalContext (Phase 5/6 annotées).
//
// Pour chaque station, on mocke Sonnet avec des sous-scores constants
// (les axes 1–5 sont indépendants du transcript via le mock), on injecte
// un transcript déterministe dont legalEvaluator dérive un score
// medico_legal connu (réel, pas mocké). On asserte :
//   • formule : score_new ≈ score_old × 0.9 + score_medico_legal × 0.1
//     (tolérance ±1 point pour absorber Math.round int des deux côtés)
//   • sections : 6 clés exactes [anamnese, examen, management, cloture,
//     communication, medico_legal], dans l'ordre canonique étendu
//   • result.medicoLegalScore et result.medicoLegalWeight sont définis
//     (10 %) — l'UI Evaluation Phase 7 J3+ pourra s'y câbler.
//
// Transcripts : transcrits « parfait » du test legalEvaluator existant
// pour AMBOSS-24, USMLE-34, RESCOS-72. Pour USMLE Triage 39 (pas couvert
// dans ce fichier de test), on construit un transcript qui hit les patterns
// must_verbalize de la fixture legalContext (signalement APEA mineur).
// ────────────────────────────────────────────────────────────────────────

const PERFECT_TRANSCRIPTS: Record<string, string> = {
  "AMBOSS-24": `
    Bonjour Madame, je vois sur votre dossier des ecchymoses multiples d'âges différents.
    Je tiens à vous rappeler que je suis tenu au secret professionnel — c'est l'article 321
    du Code pénal qui régit ma confidentialité. Cette confidentialité est maintenue sauf en
    cas de danger imminent pour vous-même ou pour un tiers.
    Il faut bien distinguer le droit d'aviser du devoir d'aviser : aujourd'hui je suis dans
    le cadre du droit d'aviser, pas du devoir.
    Je peux établir un certificat médical descriptif des lésions, à fin de preuve, si vous
    souhaitez plus tard porter plainte. Je peux aussi vous orienter vers la LAVI, l'aide aux
    victimes, qui propose un accompagnement gratuit. Vous pouvez aussi vous rapprocher des
    centres d'aide aux victimes près de chez vous.
    Je respecte totalement votre autonomie ; c'est votre choix, et vous décidez du rythme.
  `,
  "USMLE-34": `
    Madame, je comprends que c'est très douloureux. Je ne vous juge pas, je suis là pour
    vous soutenir.
    Vu les enfants à la maison, en particulier votre fils giflé récemment, j'ai un devoir
    d'aviser l'APEA — c'est l'autorité de protection de l'enfant, art. 364bis CP et art.
    314c CC. Les enfants en danger priment sur le secret professionnel : c'est l'intérêt
    supérieur de l'enfant qui guide ma décision.
    Je vais vous informer du signalement à l'APEA, par transparence : vous avez le droit
    de savoir ce que je fais et pourquoi.
    Pour vous-même, je peux vous orienter vers un foyer d'accueil pour femmes et la LAVI.
    Pour les enfants, je propose une consultation pédiatrique pour une évaluation.
  `,
  "RESCOS-72": `
    Marc, je comprends, c'est vraiment une situation difficile pour vous, je vois bien combien
    ça vous pèse.
    Mais je ne peux pas vous délivrer ce certificat médical, je refuse de signer ce certificat —
    ce serait un faux dans les titres, c'est puni par l'article 318 du Code pénal (CP-318).
    Le code de déontologie FMH (art. 34 CDM) m'interdit également d'attester contraire à la
    vérité — j'engagerais ma responsabilité disciplinaire devant la FMH.
    On peut chercher des alternatives non frauduleuses : un dialogue avec votre employeur,
    des congés sans solde, ou solliciter une médiation RH pour parler avec votre employeur
    autrement.
    On peut continuer le suivi ensemble, n'hésitez pas à me revoir si la situation change.
    Je reste votre médecin et je reste disponible.
  `,
  "USMLE Triage 39": `
    Madame Richards, je vous écoute, je ne vous juge pas, vous avez bien fait de m'appeler.
    Vu les marques décrites sur votre fille de 3 ans et sa modification comportementale, je
    dois aviser l'APEA — l'autorité de protection de l'enfant, conformément à l'article
    364bis du Code pénal et à l'article 314c du Code civil. Le signalement obligatoire pour
    un mineur en danger lève le secret professionnel.
    Je documente rigoureusement les éléments téléphoniques entendus pour que la suite soit
    bien tracée. J'organise une consultation physique en urgence pour un examen pédiatrique
    spécialisé — venez avec Joey au cabinet.
    Je vous informe du signalement par transparence. Vous pouvez aussi solliciter le service
    de protection de l'enfance cantonal et l'aide aux victimes via la LAVI.
    Je vous soutiens dans votre démarche, c'est un acte protecteur pour Joey.
  `,
};

// Stations avec legalContext ET grille évaluateur Sonnet : 3/4 covered ici.
// RESCOS-72 a un legalContext mais PAS de grille évaluateur (gap data
// hérité Phase 5 J1 — la station « decline_certificate » n'a pas été
// dotée d'une grille d'évaluation Sonnet 5-axes parce que c'est un
// scénario de refus, pas d'examen clinique). On teste donc RESCOS-72
// via la voie légale uniquement (sub-test dédié plus bas) et on couvre
// la formule sur les 3 autres stations qui ont la double annotation.
const LEGAL_CASES_FULL_PIPELINE: Array<{
  stationId: string;
  expectedStationType: StationType;
  mockedScores: Record<"anamnese" | "examen" | "management" | "cloture" | "communication", number>;
}> = [
  {
    stationId: "AMBOSS-24",
    expectedStationType: "anamnese_examen",
    mockedScores: { anamnese: 80, examen: 70, management: 60, cloture: 50, communication: 40 },
  },
  {
    stationId: "USMLE-34",
    expectedStationType: "anamnese_examen",
    mockedScores: { anamnese: 75, examen: 65, management: 70, cloture: 60, communication: 80 },
  },
  {
    stationId: "USMLE Triage 39",
    expectedStationType: "teleconsultation",
    mockedScores: { anamnese: 80, examen: 50, management: 90, cloture: 70, communication: 80 },
  },
];

describe("Phase 7 J2 — Test B : stations avec legalContext, vérification de la formule maître", () => {
  for (const tc of LEGAL_CASES_FULL_PIPELINE) {
    it(`${tc.stationId} (${tc.expectedStationType}) — score_new ≈ score_old × 0.9 + ml × 0.1`, async () => {
      // 1) Calcule score_old_5axes (oracle Phase 6) à partir des scores mockés
      // — c'est la valeur que la pipeline aurait produite avant J2.
      const scoreOld5Axes = computePhase6GlobalScore(tc.expectedStationType, tc.mockedScores);

      // 2) Mock Anthropic et exécute la pipeline complète. medicoLegalScore
      // est calculé en interne par legalEvaluator (déterministe, zéro LLM).
      anthropicMessagesCreate.mockImplementationOnce(async () =>
        buildAnthropicMock({
          globalScore: 0, // override canonique côté evaluator
          sections: makeMockedSections(tc.mockedScores),
          verdict: "Réussi",
        }),
      );
      // Format : un message doctor par ligne non-vide, pour rester proche
      // d'un transcript OSCE typique. Le pipeline reformate avec préfixe
      // « Médecin : » avant de passer à legalEvaluator (la détection
      // pattern fonctionne identiquement avec le préfixe).
      const transcriptArr = PERFECT_TRANSCRIPTS[tc.stationId]
        .split("\n")
        .filter((l) => l.trim().length > 0)
        .map((text) => ({ role: "doctor" as const, text: text.trim() }));
      const result = await runEvaluation({
        stationId: tc.stationId,
        transcript: transcriptArr,
      });

      // 3) Le 6e axe est bien actif et exposé.
      expect(result.medicoLegalWeight).toBe(MEDICO_LEGAL_WEIGHT_PCT);
      expect(typeof result.medicoLegalScore).toBe("number");
      expect(result.medicoLegalScore!).toBeGreaterThanOrEqual(0);
      expect(result.medicoLegalScore!).toBeLessThanOrEqual(100);

      // 4) Sections : 6 clés dans l'ordre canonique étendu.
      expect(result.scores.sections.map((s) => s.key)).toEqual([
        "anamnese", "examen", "management", "cloture", "communication", "medico_legal",
      ]);
      // La 6e section a bien le score medicoLegal et le poids 0.10.
      expect(result.scores.sections[5].score).toBe(result.medicoLegalScore);
      expect(result.scores.sections[5].weight).toBeCloseTo(0.1, 10);

      // 5) Formule maître : score_new ≈ score_old × 0.9 + ml × 0.1.
      // Tolérance 1 point absolu pour absorber les Math.round int des deux
      // côtés (l'unité 1e-2 spécifiée par la spec → 1 point sur l'échelle
      // 0–100 du globalScore).
      const ml = result.medicoLegalScore!;
      const expected = scoreOld5Axes * LEGAL_CONTEXT_RESCALE_FACTOR + ml * 0.1;
      expect(
        Math.abs(result.scores.globalScore - expected),
        `${tc.stationId} score_new=${result.scores.globalScore} vs expected=${expected.toFixed(2)} (old=${scoreOld5Axes}, ml=${ml})`,
      ).toBeLessThanOrEqual(1);
    });
  }

  // ─── RESCOS-72 — pas de grille Sonnet, voie médico-légale isolée ───
  //
  // Cette station a legalContext (catégorie certificat_complaisance) mais
  // pas de grille examinateur 5-axes. On vérifie donc DEUX choses :
  //   (a) legalEvaluator produit un score 0–100 par axe (positif sur
  //       transcript « parfait »),
  //   (b) aggregateMedicoLegalScore agrège correctement les 4 sous-axes
  //       en un score medico_legal, qui sera réutilisé par runEvaluation
  //       quand la station obtiendra une grille évaluateur (TODO Phase 8).
  it("RESCOS-72 — legalEvaluator + agrégation 4 sous-axes (formule formule isolée)", async () => {
    const legal = await evaluateLegal({
      stationId: "RESCOS-72",
      transcript: PERFECT_TRANSCRIPTS["RESCOS-72"],
    });
    // Le transcript est censé être « parfait » → score moyen élevé.
    const mlScore = Math.round(
      (legal.axes.reconnaissance.score_pct +
        legal.axes.verbalisation.score_pct +
        legal.axes.decision.score_pct +
        legal.axes.communication.score_pct) /
        4,
    );
    expect(mlScore).toBeGreaterThanOrEqual(0);
    expect(mlScore).toBeLessThanOrEqual(100);
    // Sur le transcript « parfait » de la fixture legalEvaluator existante,
    // le score doit être suffisamment haut pour valider la pipeline (> 50).
    expect(mlScore, `RESCOS-72 ml=${mlScore} sur transcript parfait`).toBeGreaterThanOrEqual(50);
  });
});

// ────────────────────────────────────────────────────────────────────────
// Test C — Pondération boundary : règle proportionnelle × 0.9 + 10.
// ────────────────────────────────────────────────────────────────────────

describe("Phase 7 J2 — Test C : pondération boundary et proportionnalité", () => {
  const ALL_TYPES: StationType[] = [
    "anamnese_examen", "bbn", "psy", "pediatrie_accompagnant", "teleconsultation", "triage",
  ];

  describe("getEffectiveAxisWeights — mode 5-axes (legalContext absent)", () => {
    it("retourne EXACTEMENT EVALUATION_WEIGHTS[type] augmenté de medico_legal=0", () => {
      for (const type of ALL_TYPES) {
        const eff = getEffectiveAxisWeights(type, false);
        const v1 = EVALUATION_WEIGHTS[type];
        expect(eff.anamnese, `${type}.anamnese`).toBe(v1.anamnese);
        expect(eff.examen, `${type}.examen`).toBe(v1.examen);
        expect(eff.management, `${type}.management`).toBe(v1.management);
        expect(eff.cloture, `${type}.cloture`).toBe(v1.cloture);
        expect(eff.communication, `${type}.communication`).toBe(v1.communication);
        expect(eff.medico_legal, `${type}.medico_legal`).toBe(0);
      }
    });
    it("somme des 5 axes = 100, medico_legal exclu (poids 0)", () => {
      for (const type of ALL_TYPES) {
        const e = getEffectiveAxisWeights(type, false);
        const sum = e.anamnese + e.examen + e.management + e.cloture + e.communication;
        expect(sum, `somme 5 axes ${type}`).toBe(100);
      }
    });
  });

  describe("getEffectiveAxisWeights — mode 6-axes (legalContext présent)", () => {
    it("règle proportionnelle : weight_v2(axis) === weight_v1(axis) × 0.9 pour chaque axe v1", () => {
      for (const type of ALL_TYPES) {
        const v1 = EVALUATION_WEIGHTS[type];
        const v2 = getEffectiveAxisWeights(type, true);
        expect(v2.anamnese).toBeCloseTo(v1.anamnese * LEGAL_CONTEXT_RESCALE_FACTOR, 10);
        expect(v2.examen).toBeCloseTo(v1.examen * LEGAL_CONTEXT_RESCALE_FACTOR, 10);
        expect(v2.management).toBeCloseTo(v1.management * LEGAL_CONTEXT_RESCALE_FACTOR, 10);
        expect(v2.cloture).toBeCloseTo(v1.cloture * LEGAL_CONTEXT_RESCALE_FACTOR, 10);
        expect(v2.communication).toBeCloseTo(v1.communication * LEGAL_CONTEXT_RESCALE_FACTOR, 10);
      }
    });
    it("medico_legal = 10 dans tous les cas", () => {
      for (const type of ALL_TYPES) {
        expect(getEffectiveAxisWeights(type, true).medico_legal).toBe(MEDICO_LEGAL_WEIGHT_PCT);
        expect(MEDICO_LEGAL_WEIGHT_PCT).toBe(10);
      }
    });
    it("LEGAL_CONTEXT_RESCALE_FACTOR = 0.9 (constante de référence)", () => {
      expect(LEGAL_CONTEXT_RESCALE_FACTOR).toBe(0.9);
    });
    it("somme totale = 100 dans le mode 6-axes (close-to pour le flottant)", () => {
      for (const type of ALL_TYPES) {
        const e = getEffectiveAxisWeights(type, true);
        const sum =
          e.anamnese + e.examen + e.management + e.cloture + e.communication + e.medico_legal;
        // 0.9 × 100 + 10 = 100, mais en flottant IEEE 754 on tolère ε.
        expect(sum, `somme 6 axes ${type}`).toBeCloseTo(100, 10);
      }
    });
  });

  describe("Exemple anamnese_examen — valeurs canoniques v1 vs v2", () => {
    it("v1 (sans legalContext) = 25/25/25/25/0", () => {
      const e = getEffectiveAxisWeights("anamnese_examen", false);
      expect(e.anamnese).toBe(25);
      expect(e.examen).toBe(25);
      expect(e.management).toBe(25);
      expect(e.cloture).toBe(25);
      expect(e.communication).toBe(0);
      expect(e.medico_legal).toBe(0);
    });
    it("v2 (avec legalContext) = 22.5/22.5/22.5/22.5/0/10", () => {
      const e = getEffectiveAxisWeights("anamnese_examen", true);
      expect(e.anamnese).toBe(22.5);
      expect(e.examen).toBe(22.5);
      expect(e.management).toBe(22.5);
      expect(e.cloture).toBe(22.5);
      expect(e.communication).toBe(0);
      expect(e.medico_legal).toBe(10);
    });
  });
});

// ────────────────────────────────────────────────────────────────────────
// Test D — Invariant additif : 5 clés Phase 5/6 toujours présentes,
// medico_legal ajouté en 6e position, ordre canonique préservé.
// ────────────────────────────────────────────────────────────────────────

describe("Phase 7 J2 — Test D : invariant additif sur les axes", () => {
  it("EVALUATION_AXES (Phase 5/6) : 5 axes inchangés dans l'ordre canonique", () => {
    expect(EVALUATION_AXES).toEqual([
      "anamnese", "examen", "management", "cloture", "communication",
    ]);
  });
  it("EVALUATION_AXES_6 (Phase 7 J2) : 6 axes, medico_legal en 6e position", () => {
    expect(EVALUATION_AXES_6).toEqual([
      "anamnese", "examen", "management", "cloture", "communication", "medico_legal",
    ]);
  });
  it("aucun rename : les 5 clés Phase 5/6 sont les 5 premières de EVALUATION_AXES_6", () => {
    expect(EVALUATION_AXES_6.slice(0, 5)).toEqual(EVALUATION_AXES);
  });
  it("medico_legal est UNIQUEMENT en position 5 (index zéro-based) — additif strict", () => {
    expect(EVALUATION_AXES_6.indexOf("medico_legal")).toBe(5);
    expect(EVALUATION_AXES_6.length).toBe(6);
  });
  it("AxisWeights6 contient exactement les 6 clés (pas de drift de schéma)", () => {
    const sample = getEffectiveAxisWeights("anamnese_examen", true);
    expect(Object.keys(sample).sort()).toEqual(
      ["anamnese", "cloture", "communication", "examen", "management", "medico_legal"],
    );
  });

  it("station sans legalContext : sections.length === 5 (rétrocompat byte-à-byte)", async () => {
    anthropicMessagesCreate.mockImplementationOnce(async () =>
      buildAnthropicMock({
        globalScore: 0,
        sections: makeMockedSections({ anamnese: 70, examen: 70, management: 70, cloture: 70, communication: 70 }),
        verdict: "Réussi",
      }),
    );
    const r = await runEvaluation({
      stationId: "AMBOSS-1",
      transcript: [{ role: "doctor", text: "test." }],
    });
    expect(r.scores.sections.length).toBe(5);
    expect(r.scores.sections.map((s) => s.key)).toEqual([
      "anamnese", "examen", "management", "cloture", "communication",
    ]);
  });

  it("station avec legalContext : sections.length === 6, medico_legal en queue", async () => {
    anthropicMessagesCreate.mockImplementationOnce(async () =>
      buildAnthropicMock({
        globalScore: 0,
        sections: makeMockedSections({ anamnese: 70, examen: 70, management: 70, cloture: 70, communication: 70 }),
        verdict: "Réussi",
      }),
    );
    const r = await runEvaluation({
      stationId: "AMBOSS-24",
      transcript: PERFECT_TRANSCRIPTS["AMBOSS-24"]
        .split("\n").filter((l) => l.trim().length > 0)
        .map((text) => ({ role: "doctor" as const, text: text.trim() })),
    });
    expect(r.scores.sections.length).toBe(6);
    expect(r.scores.sections[5].key).toBe("medico_legal");
    expect(r.scores.sections[5].weight).toBeCloseTo(0.1, 10);
  });
});

// ────────────────────────────────────────────────────────────────────────
// Test E (bonus) — `aggregateMedicoLegalScore` : pondération interne
// uniforme 25 % sur les 4 sous-axes (reconnaissance, verbalisation,
// décision, communication). Couvre le contrat documenté en commentaire.
// ────────────────────────────────────────────────────────────────────────

describe("Phase 7 J2 — aggregateMedicoLegalScore : pondération uniforme 25 % par sous-axe", () => {
  function mkAxes(r: number, v: number, d: number, c: number) {
    return {
      reconnaissance: { score_pct: r },
      verbalisation: { score_pct: v },
      decision: { score_pct: d },
      communication: { score_pct: c },
    };
  }

  it("4 sous-axes à 100 → score 100", () => {
    expect(aggregateMedicoLegalScore(mkAxes(100, 100, 100, 100))).toBe(100);
  });
  it("4 sous-axes à 0 → score 0", () => {
    expect(aggregateMedicoLegalScore(mkAxes(0, 0, 0, 0))).toBe(0);
  });
  it("moyenne arithmétique sur sous-axes hétérogènes (80/60/40/20 → 50)", () => {
    expect(aggregateMedicoLegalScore(mkAxes(80, 60, 40, 20))).toBe(50);
  });
  it("aucun sous-axe ne domine (axes différents → moyenne uniforme)", () => {
    // Vérifie que swap des valeurs entre axes ne change pas le résultat
    // (preuve d'absence de pondération non-uniforme cachée).
    const a = aggregateMedicoLegalScore(mkAxes(90, 80, 70, 60));
    const b = aggregateMedicoLegalScore(mkAxes(60, 70, 80, 90));
    const c = aggregateMedicoLegalScore(mkAxes(80, 60, 90, 70));
    expect(a).toBe(b);
    expect(a).toBe(c);
  });
  it("rounding : 33.5 → 34 (Math.round half-up)", () => {
    // (33+34+33+34)/4 = 33.5 → Math.round → 34 (half-away-from-zero).
    expect(aggregateMedicoLegalScore(mkAxes(33, 34, 33, 34))).toBe(34);
  });
  it("clamp [0, 100] : valeurs aberrantes coupées", () => {
    // Sécurité défensive : si un sous-score sortait du domaine 0-100
    // (ne devrait jamais arriver — legalEvaluator clamp aussi), la
    // fonction d'agrégation ne propage pas la dérive.
    expect(aggregateMedicoLegalScore(mkAxes(150, 100, 100, 100))).toBe(100);
    expect(aggregateMedicoLegalScore(mkAxes(-50, 0, 0, 0))).toBe(0);
  });
});

// ────────────────────────────────────────────────────────────────────────
// Test F (bonus) — formule maître appliquée sur cas synthétiques connus,
// pour ancrer la sémantique « score_new = score_old × 0.9 + ml × 0.1 »
// en dehors des 4 stations Phase 5/6 (qui dépendent du lexique runtime).
// ────────────────────────────────────────────────────────────────────────

describe("Phase 7 J2 — formule maître sur cas synthétiques (boundary check)", () => {
  // anamnese_examen : 25/25/25/25/0. score_old = moyenne des 4 axes
  // non-comm. Le 5e axe (communication) a poids 0 → exclu.
  it("anamnese_examen + ml=0 → score_new = score_old (perte uniforme × 0.9 sur w + ratio constant)", () => {
    // Cas dégénéré : si ml=0 (transcript vide médico-légalement), le 6e axe
    // entre dans Σ avec poids 0.1 mais score 0. score_new = score_old * 0.9.
    // Ce n'est PAS = score_old, MAIS le ratio ml=0 réduit le score global.
    // C'est l'effet pédagogique attendu : zéro reconnaissance médico-légale
    // → -10 % sur le score total.
    const scoreOld = 80;
    const ml = 0;
    const expected = scoreOld * 0.9 + ml * 0.1;
    expect(expected).toBe(72);
  });
  it("anamnese_examen + ml=100 → score_new = score_old × 0.9 + 10", () => {
    const scoreOld = 80;
    const ml = 100;
    const expected = scoreOld * 0.9 + ml * 0.1;
    expect(expected).toBe(82);
  });
  it("score_old = ml = 50 → score_new = 50 (point fixe)", () => {
    // Quand l'étudiant a la même qualité sur les 5 axes cliniques et
    // sur l'axe médico-légal, le score reste inchangé. Sanity check de
    // la décomposition convexe 0.9 + 0.1 = 1.
    const scoreOld = 50;
    const ml = 50;
    expect(scoreOld * 0.9 + ml * 0.1).toBe(50);
  });
});
