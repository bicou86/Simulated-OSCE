// Phase 10 J1 — dette 2 : matching scoringRule token-based.
//
// Couvre :
//   • Helper `tokenize(text)` (normalize + split whitespace + filter vide).
//     Tests unitaires : whitespace, ponctuation, casse, accents, chiffres,
//     vide, idempotence.
//   • `detectMention` refactor token-based (égalité dans Set<token>) :
//     match exact, fuzzy keywords ≥ 60 %, items courts (fallback all-tokens),
//     stopwords filtrés, faux positifs morphologiques substring corrigés.
//   • Non-régression Phase 8 J3 : score `evaluatePresentation` inchangé sur
//     transcript témoin (idempotence + parité avec scénarios fixtures réels).

import { describe, expect, it, beforeAll } from "vitest";
import {
  evaluatePresentation,
  __test__ as presTest,
} from "../services/presentationEvaluator";
import { initCatalog } from "../services/stationsService";

beforeAll(async () => {
  await initCatalog();
});

// ────────────────────────────────────────────────────────────────────────
// 1. Helper tokenize (déterministe, pur)
// ────────────────────────────────────────────────────────────────────────

describe("Phase 10 J1 — tokenize (déterministe, pur)", () => {
  const t = presTest.tokenize;

  it("whitespace simple : split sur espaces", () => {
    expect(t("toux dyspnée fièvre")).toEqual(["toux", "dyspnee", "fievre"]);
  });

  it("ponctuation strippée par normalizeText : virgules, points, parenthèses, slash", () => {
    // (Aggravation de) toux, dyspnée; douleur! 4 kg/quelques mois
    expect(t("(Aggravation de) toux, dyspnée; douleur! 4 kg/quelques mois")).toEqual([
      "aggravation", "de", "toux", "dyspnee", "douleur", "4", "kg", "quelques", "mois",
    ]);
  });

  it("casse : lowercase systématique", () => {
    expect(t("BPCO Tabagisme UPA")).toEqual(["bpco", "tabagisme", "upa"]);
  });

  it("accents : NFD strip diacritics (é→e, è→e, à→a, ô→o)", () => {
    expect(t("Hémoptysie afébrile pondérale élevée")).toEqual([
      "hemoptysie", "afebrile", "ponderale", "elevee",
    ]);
  });

  it("chiffres conservés dans les tokens (35, 4)", () => {
    expect(t("Tabagisme actif à 35 UPA pendant 4 ans")).toEqual([
      "tabagisme", "actif", "a", "35", "upa", "pendant", "4", "ans",
    ]);
  });

  it("chaîne vide / whitespace pur → tableau vide", () => {
    expect(t("")).toEqual([]);
    expect(t("   \t  \n ")).toEqual([]);
    expect(t("!!!,,,...")).toEqual([]);
  });

  it("idempotence : tokenize(join(tokenize(x))) === tokenize(x)", () => {
    const inputs = [
      "Tabagisme actif à 35 UPA",
      "(Aggravation de) toux, dyspnée",
      "Pas de fièvre, pas de TBC",
      "Douleur thoracique respiro-dépendante et augmentée à la toux",
    ];
    for (const x of inputs) {
      const once = t(x);
      const twice = t(once.join(" "));
      expect(twice, `idempotence sur "${x}"`).toEqual(once);
    }
  });
});

// ────────────────────────────────────────────────────────────────────────
// 2. detectMention token-based (sémantique 60 % + fallback items courts)
// ────────────────────────────────────────────────────────────────────────

describe("Phase 10 J1 — detectMention (token-based, seuil 60 % conservé)", () => {
  const m = presTest.detectMention;

  it("match exact token unique : Hémoptysie présent dans transcript", () => {
    expect(m("Hémoptysie", "le patient présente une hémoptysie franche")).toBe(true);
  });

  it("match keywords ≥ 60 % sur item multi-tokens (r2 paraphrasé)", () => {
    // r2 items_attendus[0] = "Tabagisme, toux, dyspnée, douleur thoracique, perte pondérale"
    // Une fois splitCsvItems → 5 sous-éléments matchés indépendamment.
    // Ici on teste le matching d'un sous-élément multi-tokens : "douleur thoracique"
    // → keywords ≥4 = ["douleur","thoracique"], threshold ceil(2*0.6)=2.
    expect(m("douleur thoracique", "Le patient se plaint d'une douleur thoracique")).toBe(true);
    // Un seul keyword présent → 1/2 = 50 % < 60 % → false.
    expect(m("douleur thoracique", "Le patient se plaint d'une douleur abdominale")).toBe(false);
  });

  it("FAUX POSITIF MORPHOLOGIQUE CORRIGÉ : « fievre » ne matche plus « fievreux » (gain dette 2)", () => {
    // Pré-J1 (substring) : "fievre" ⊂ "fievreux" → true (faux positif).
    // Post-J1 (token-based) : tokens transcript = {"le","patient","est","fievreux"},
    //   "fievre" pas dans le set → false. Bug morphologique corrigé.
    expect(m("fièvre", "le patient est fievreux")).toBe(false);
  });

  it("FAUX POSITIF MORPHOLOGIQUE CORRIGÉ : « cancer » ne matche plus « cancereuse »", () => {
    expect(m("cancer", "lésion cancereuse au lobe supérieur")).toBe(false);
  });

  it("vrai positif préservé : « cancer » matche « le diagnostic est un cancer »", () => {
    expect(m("cancer", "le diagnostic est un cancer pulmonaire")).toBe(true);
  });

  it("items courts (tokens < MIN_KEYWORD_LEN, ex. UPA 3 chars) : fallback égalité tokens", () => {
    // Item "UPA" (3 chars) : aucun keyword ≥4 → fallback every-token-in-set.
    expect(m("UPA", "tabagisme actif à 35 upa")).toBe(true);
    expect(m("UPA", "consommation de tabac quotidienne")).toBe(false);
  });

  it("stopwords filtrés des keywords : « le patient » ne génère pas de faux match", () => {
    // tokens = ["le","patient"], "le" et "patient" sont dans STOPWORDS
    // (patient ajouté Phase A ajustement 1) → keywords vide → fallback every-token.
    // Transcript vide narrativement : "le" et "patient" PRÉSENTS → fallback match true.
    // Cas réel : on teste qu'un item KEYWORD-only ne dégénère pas.
    expect(m("le patient", "le patient")).toBe(true);
    // Mais sur un item plus discriminant ("examen normal"), les stopwords ne
    // doivent pas faire baisser le seuil sous 60 %.
    expect(m("examen normal du patient", "examen normal sans particularité")).toBe(true);
  });

  it("CORRIGÉ Phase 10 J2 (dette 3) : « pas de tuberculose » NE matche PLUS « Tuberculose » (marqueur AVANT, asymétrie respectée)", () => {
    // Phase 8 J3 (pré-J2) : faux positif documenté (substring match).
    // Phase 10 J1 (token-based brut) : encore faux positif (négation
    //   pas détectée, fondations posées pour J2).
    // Phase 10 J2 (A-strict symétrique) : `pas` détecté dans la fenêtre 4
    //   tokens AVANT `tuberculose` côté transcript ; côté item « Tuberculose »
    //   pas de marqueur → mismatch → false. Faux positif corrigé.
    expect(m("Tuberculose", "pas de tuberculose")).toBe(false);
  });

  it("LIMITE Q-N3 (asymétrique avant) PRÉSERVÉE : « tuberculose absente » matche encore « Tuberculose » (marqueur APRÈS keyword)", () => {
    // Q-N3 validée user : `isNegated` est asymétrique avant uniquement
    // (la négation précède le mot nié dans la quasi-totalité des cas en
    // français). Le marqueur APRÈS keyword (« tuberculose absente ») est
    // ignoré par construction. Limite acceptée et testée pour éviter
    // toute régression future qui voudrait passer en symétrique
    // bilatéral.
    expect(m("Tuberculose", "tuberculose absente")).toBe(true);
  });
});

// ────────────────────────────────────────────────────────────────────────
// 3. Non-régression : evaluatePresentation idempotent + transcript témoin
// ────────────────────────────────────────────────────────────────────────

describe("Phase 10 J1 — non-régression evaluatePresentation (sémantique Phase 8 J3 préservée)", () => {
  it("transcript narrativement vide → weightedScore = 0 (Phase 8 J3 baseline)", async () => {
    const r = await evaluatePresentation({
      stationId: "RESCOS-64-P2",
      transcript: "Bonjour. Voici ma présentation. Merci.",
    });
    expect(r.weightedScore).toBe(0);
  });

  it("transcript artificiel concaténant tous les items → weightedScore plafond 95.61 post-dette 3 J2 (relock historique : J1=100 sans négation, J2=95.61 avec négation A-strict)", async () => {
    // HISTORIQUE :
    //   • Phase 8 J3 (substring) + Phase 10 J1 (token-based brut) :
    //     score = 100 sur ce transcript synthétique (faux positifs négation
    //     toujours présents).
    //   • Phase 10 J2 (A-strict symétrique) : relock à 95.61.
    //     Cf. commentaire historique étendu dans phase8J3PresentationEvaluator.test.ts
    //     pour le détail des 5 sub-items perdus (2 mots-clés partagés
    //     r9.tvp/r15.cardiaque + 3 items « clean » p9/r4/r13 pollués
    //     par marqueurs voisins via parts.join(". ")).
    // Q-N5 validée user : artefact synthétique du test, pas régression
    // algorithmique. Sur transcript candidat réel, A-strict se comporte
    // correctement.
    const { getEvaluatorStation } = await import("../services/evaluatorService");
    const evalStation = await getEvaluatorStation("RESCOS-64-P2");
    type Item = { id: string; text: string; binaryOnly?: boolean; scoringRule?: string; items_attendus?: string[] };
    const grille = (evalStation as { grille: Record<string, Item[]> }).grille;
    const parts: string[] = [];
    for (const axis of ["presentation", "raisonnement", "examens", "management"] as const) {
      for (const item of grille[axis]) {
        const itemsAttendus = item.items_attendus ?? [];
        if (itemsAttendus.length === 1 && /^aucun$/i.test(itemsAttendus[0].trim())) continue;
        if (item.binaryOnly === true && itemsAttendus.length === 0 && axis === "raisonnement") {
          const diag = presTest.extractDiagnostic(item.text);
          if (diag) parts.push(diag);
          continue;
        }
        if (itemsAttendus.length === 0) continue;
        parts.push(itemsAttendus[0]);
        if (item.scoringRule && item.binaryOnly !== true) {
          const parsed = presTest.parseScoringRule(item.scoringRule, item.id);
          if (parsed.mode === "token") {
            for (const step of parsed.steps) {
              if (step.kind === "token") parts.push((step as { token: string }).token);
            }
          }
        }
      }
    }
    const transcript = parts.join(". ") + ".";
    const r = await evaluatePresentation({ stationId: "RESCOS-64-P2", transcript });
    // Q-N5 validée user (Phase 10 J2) : relock 100 → 95.61 (option (i)).
    expect(r.weightedScore).toBeCloseTo(95.61, 2);
  });

  it("idempotence : 2 appels avec même input → résultat identique post-tokenizer", async () => {
    const transcript = "Toux et dyspnée. Tabagisme actif à 35 UPA. Cancer pulmonaire.";
    const r1 = await evaluatePresentation({ stationId: "RESCOS-64-P2", transcript });
    const r2 = await evaluatePresentation({ stationId: "RESCOS-64-P2", transcript });
    expect(r1.weightedScore).toBe(r2.weightedScore);
    expect(JSON.stringify(r1.axes)).toBe(JSON.stringify(r2.axes));
  });

  it("p3 token mode : score=2 sur transcript « Toux et dyspnée » (parité Phase 8 J3 ligne 220)", async () => {
    // Vérifie que le matching token-based préserve la sémantique p3 token mode :
    //   scoringRule "Toux = 1 pt, dyspnée = 1 pt" sur "Toux et dyspnée"
    //   → tokens transcript = {"toux","et","dyspnee"} → matched=2/2 → score=2.
    const r = await evaluatePresentation({
      stationId: "RESCOS-64-P2",
      transcript: "Toux et dyspnée.",
    });
    const p3 = r.axes.presentation.items.find((i) => i.id === "p3");
    expect(p3).toBeDefined();
    expect(p3!.score).toBe(2);
    expect(p3!.max).toBe(2);
  });
});
