// Phase 10 J2 — dette 3 : détection négation transcript (sémantique A-strict
// symétrique).
//
// Couvre :
//   • Constantes : NEGATION_MARKERS (Set immuable, Q-N1 = 19 marqueurs),
//     NEGATION_WINDOW_SIZE = 4 (Q-N2).
//   • Helpers : findKeywordPositions (séquence ordonnée d'indices),
//     isNegated (asymétrique avant uniquement Q-N3, all-occurrences-negated
//     A-strict Q-N5).
//   • detectMention symétrique : un keyword matche SSI son état de négation
//     est identique côté item et côté transcript.
//   • Bénéfices Q-N5 : faux positifs Phase 8 J3 historiques corrigés
//     (« pas de tuberculose », « aucune hémoptysie », « pas de fièvre »).
//   • Limite Q-N3 préservée : « tuberculose absente » match encore positif
//     (marqueur APRÈS le keyword, ignoré par construction asymétrique).
//   • Cas r6 préservé : items à négation pédagogique (« Pas de fièvre »)
//     matchent encore le transcript équivalent (« pas de fièvre »).

import { describe, expect, it, beforeAll } from "vitest";
import {
  __test__ as presTest,
  evaluatePresentation,
} from "../services/presentationEvaluator";
import { initCatalog } from "../services/stationsService";

beforeAll(async () => {
  await initCatalog();
});

// ────────────────────────────────────────────────────────────────────────
// 1. Constantes NEGATION_MARKERS + NEGATION_WINDOW_SIZE
// ────────────────────────────────────────────────────────────────────────

describe("Phase 10 J2 — NEGATION_MARKERS (Q-N1 liste élargie médicale)", () => {
  const M = presTest.NEGATION_MARKERS;

  it("contient les 5 négations grammaticales standard", () => {
    for (const m of ["pas", "non", "ni", "sans", "jamais"]) {
      expect(M.has(m), `marker "${m}" attendu`).toBe(true);
    }
  });

  it("contient les 4 formes morphologiques d'« aucun »", () => {
    for (const m of ["aucun", "aucune", "aucuns", "aucunes"]) {
      expect(M.has(m), `marker "${m}" attendu`).toBe(true);
    }
  });

  it("contient les 5 formes morphologiques d'« absent/absence »", () => {
    for (const m of ["absence", "absent", "absente", "absents", "absentes"]) {
      expect(M.has(m), `marker "${m}" attendu`).toBe(true);
    }
  });

  it("contient les marqueurs médicaux d'exclusion (négatif/exclu/nie)", () => {
    for (const m of [
      "negatif", "negative", "negatifs", "negatives",
      "exclu", "exclue", "exclus", "exclues",
      "nie", "nient",
    ]) {
      expect(M.has(m), `marker "${m}" attendu`).toBe(true);
    }
  });

  it("liste post-normalizeText (lowercase + sans diacritiques)", () => {
    // Vérifie qu'aucun marqueur ne contient d'accent (cohérent avec
    // tokenize qui strip diacritics via NFD).
    for (const m of M) {
      expect(m, `marker "${m}" doit être lowercase sans diacritiques`).toBe(m.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase());
    }
  });

  it("NEGATION_WINDOW_SIZE = 4 (Q-N2 validée)", () => {
    expect(presTest.NEGATION_WINDOW_SIZE).toBe(4);
  });
});

// ────────────────────────────────────────────────────────────────────────
// 2. findKeywordPositions
// ────────────────────────────────────────────────────────────────────────

describe("Phase 10 J2 — findKeywordPositions (séquence ordonnée d'indices)", () => {
  const f = presTest.findKeywordPositions;

  it("keyword absent → tableau vide", () => {
    expect(f("toux", ["pas", "de", "fievre"])).toEqual([]);
  });

  it("keyword présent 1× → 1 position", () => {
    expect(f("fievre", ["pas", "de", "fievre"])).toEqual([2]);
  });

  it("keyword présent 3× → 3 positions ordonnées croissant", () => {
    expect(f("toux", ["toux", "et", "toux", "puis", "toux"])).toEqual([0, 2, 4]);
  });

  it("transcript vide → tableau vide", () => {
    expect(f("toux", [])).toEqual([]);
  });
});

// ────────────────────────────────────────────────────────────────────────
// 3. isNegated (asymétrique avant uniquement Q-N3, A-strict Q-N5)
// ────────────────────────────────────────────────────────────────────────

describe("Phase 10 J2 — isNegated (asymétrique avant, fenêtre 4, all-occurrences A-strict)", () => {
  const isNeg = presTest.isNegated;

  it("marqueur immédiat avant keyword (window 1 → dans fenêtre 4) → nié", () => {
    expect(isNeg("tuberculose", ["pas", "de", "tuberculose"])).toBe(true);
  });

  it("marqueur exactement à 4 tokens avant keyword (limite incluse) → nié", () => {
    // window = 4 tokens AVANT keyword pos N : tokens [N-4..N-1]
    // Position 4 : tokens [0..3] dont position 0 = "pas" → nié
    expect(isNeg("tuberculose", ["pas", "a", "b", "c", "tuberculose"])).toBe(true);
  });

  it("marqueur à 5 tokens avant keyword (HORS fenêtre) → NON nié", () => {
    // Position 5 : tokens [1..4] (ne contient pas position 0) → pas de marqueur
    expect(isNeg("tuberculose", ["pas", "a", "b", "c", "d", "tuberculose"])).toBe(false);
  });

  it("marqueur APRÈS keyword (asymétrie Q-N3) → NON nié", () => {
    // « tuberculose absente » : marqueur après, ignoré par construction
    expect(isNeg("tuberculose", ["tuberculose", "absente"])).toBe(false);
  });

  it("keyword absent du transcript → false (pas de négation possible)", () => {
    expect(isNeg("hemoptysie", ["pas", "de", "fievre"])).toBe(false);
  });

  it("A-strict : 2 occurrences toutes deux niées → globalement nié", () => {
    expect(isNeg("fievre", ["pas", "de", "fievre", "puis", "pas", "de", "fievre"])).toBe(true);
  });

  it("A-strict : 2 occurrences dont 1 non-niée → globalement NON nié (clé Q-N5)", () => {
    // Cas réel observé : tvp dans r9 (négé) + tvp dans e9 (positif) →
    // transNeg=false, candidat fait du bon raisonnement clinique.
    expect(isNeg("tvp", ["pas", "de", "tvp", "puis", "bilan", "veineux", "tvp"])).toBe(false);
  });

  it("différents marqueurs dans la fenêtre comptent (« absence », « jamais ») → nié", () => {
    expect(isNeg("fatigue", ["absence", "de", "fatigue"])).toBe(true);
    expect(isNeg("tuberculose", ["jamais", "eu", "de", "tuberculose"])).toBe(true);
    expect(isNeg("douleur", ["aucune", "douleur"])).toBe(true);
  });

  it("windowSize custom respectée (ex. windowSize=1 → marqueur à 2 tokens hors fenêtre)", () => {
    expect(isNeg("tuberculose", ["pas", "de", "tuberculose"], 1)).toBe(false);
    expect(isNeg("tuberculose", ["pas", "tuberculose"], 1)).toBe(true);
  });
});

// ────────────────────────────────────────────────────────────────────────
// 4. detectMention symétrique : faux positifs corrigés + cas r6 préservé
// ────────────────────────────────────────────────────────────────────────

describe("Phase 10 J2 — detectMention (symétrique A-strict, dette 3)", () => {
  const m = presTest.detectMention;

  // ─── Faux positifs Phase 8 J3 historiques CORRIGÉS ───────────────────
  it("CORRIGÉ : « pas de tuberculose » ne matche plus « Tuberculose »", () => {
    expect(m("Tuberculose", "pas de tuberculose")).toBe(false);
  });

  it("CORRIGÉ : « aucune hémoptysie » ne matche plus « Hémoptysie »", () => {
    expect(m("Hémoptysie", "aucune hémoptysie")).toBe(false);
  });

  it("CORRIGÉ : « pas de fièvre » ne matche plus « fièvre »", () => {
    expect(m("fièvre", "pas de fièvre")).toBe(false);
  });

  it("CORRIGÉ : « absence de fatigue » ne matche plus « Fatigue »", () => {
    expect(m("Fatigue", "absence de fatigue")).toBe(false);
  });

  // ─── Limite Q-N3 préservée (asymétrique avant uniquement) ────────────
  it("LIMITE Q-N3 (asymétrique) : « tuberculose absente » matche encore « Tuberculose » (marqueur APRÈS)", () => {
    expect(m("Tuberculose", "tuberculose absente")).toBe(true);
  });

  // ─── Vrais positifs préservés ────────────────────────────────────────
  it("vrai positif préservé : « le patient présente une tuberculose »", () => {
    expect(m("Tuberculose", "le patient présente une tuberculose")).toBe(true);
  });

  it("vrai positif préservé : « la patiente a une toux importante »", () => {
    expect(m("Toux", "la patiente a une toux importante")).toBe(true);
  });

  // ─── Items à négation pédagogique (r6/r9/r12/r15) ────────────────────
  it("symétrie négation : item « Pas de fièvre » matche transcript « pas de fièvre » (cas r6)", () => {
    // Item : itemNeg(fievre)=true (préfixé par "pas")
    // Transcript : transNeg(fievre)=true (préfixé par "pas")
    // → match symétrique (préserve sémantique pédagogique items « Arguments CONTRE »)
    expect(m("Pas de fièvre", "pas de fièvre")).toBe(true);
  });

  it("asymétrie négation : item « Pas de fièvre » NE matche PAS transcript « il a de la fièvre »", () => {
    // Item : itemNeg(fievre)=true
    // Transcript : transNeg(fievre)=false
    // → mismatch : candidat a dit positif alors que l'item attendait négatif
    expect(m("Pas de fièvre", "il a de la fièvre")).toBe(false);
  });

  it("asymétrie négation : item « Tuberculose » NE matche PAS transcript « pas de tuberculose »", () => {
    // Inverse du test précédent : item positif, transcript négatif → no match
    expect(m("Tuberculose", "pas de tuberculose")).toBe(false);
  });

  // ─── Marqueurs multiples + items courts ──────────────────────────────
  it("multi-marqueurs : « pas de fièvre, pas de toux » sur item « fièvre toux » → 0 match (les deux niés)", () => {
    expect(m("fièvre toux", "pas de fièvre, pas de toux")).toBe(false);
  });

  it("item court (token <MIN_KEYWORD_LEN) avec négation transcript → fallback symétrique", () => {
    // Item "TVP" (3 chars, pas de keyword filtrable) → fallback all-tokens
    // Transcript "pas de tvp" → transNeg(tvp)=true ; itemNeg(tvp)=false → mismatch
    expect(m("TVP", "pas de tvp")).toBe(false);
    // Transcript "bilan veineux tvp" (positif) → match
    expect(m("TVP", "bilan veineux tvp")).toBe(true);
  });
});

// ────────────────────────────────────────────────────────────────────────
// 5. Non-régression evaluatePresentation : cas r6/r12 préservés
// ────────────────────────────────────────────────────────────────────────

describe("Phase 10 J2 — non-régression evaluatePresentation (items à négation pédagogique préservés)", () => {
  it("r6 « Arguments CONTRE tuberculose » sur transcript équivalent → 4/4 sub-items matchés", async () => {
    const transcript =
      "Pas de fièvre. Pas de facteurs de risque comme la cortisone. " +
      "Pas d'antécédent tuberculeux. Pas de TBC dans la famille.";
    const r = await evaluatePresentation({ stationId: "RESCOS-64-P2", transcript });
    const r6 = r.axes.raisonnement.items.find((i) => i.id === "r6");
    expect(r6).toBeDefined();
    // r6 scoringRule "4-2 = 2 pts, 1 = 0.5 pt, 0 = 0 pt", expected=4 (csv)
    // 4 sub-items matchés → score=2 (clause 4>=4 → 2 pts), max=2 (recalibré)
    expect(r6!.score).toBe(2);
    expect(r6!.max).toBe(2);
  });

  it("r12 β fractional « Pas de changement..., pas de fièvre » → 2/2 sub-items matchés", async () => {
    const transcript =
      "Pas de changement de couleur ou quantité des expectorations. Pas de fièvre.";
    const r = await evaluatePresentation({ stationId: "RESCOS-64-P2", transcript });
    const r12 = r.axes.raisonnement.items.find((i) => i.id === "r12");
    expect(r12).toBeDefined();
    expect(r12!.score).toBe(1); // β fractional 2/2 = 1.0
    expect(r12!.max).toBe(1);
  });

  it("transcript narrativement vide → weightedScore = 0 (Phase 8 J3 baseline)", async () => {
    const r = await evaluatePresentation({
      stationId: "RESCOS-64-P2",
      transcript: "Bonjour. Voici ma présentation. Merci.",
    });
    expect(r.weightedScore).toBe(0);
  });

  it("idempotence post-J2 : 2 appels avec même input → résultat identique", async () => {
    const transcript =
      "Toux et dyspnée importantes. Tabagisme actif à 35 UPA. Cancer pulmonaire suspecté.";
    const r1 = await evaluatePresentation({ stationId: "RESCOS-64-P2", transcript });
    const r2 = await evaluatePresentation({ stationId: "RESCOS-64-P2", transcript });
    expect(r1.weightedScore).toBe(r2.weightedScore);
    expect(JSON.stringify(r1.axes)).toBe(JSON.stringify(r2.axes));
  });
});
