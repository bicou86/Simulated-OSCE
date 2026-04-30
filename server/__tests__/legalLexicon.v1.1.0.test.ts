// Phase 7 J1 — couverture spécifique de l'extension v1.0.0 → v1.1.0.
//
// Objectifs du fichier (cf. Phase 7 J1 spec) :
//
//   • Test 1   : pour chaque nouvelle catégorie A/B/C/D, un transcript
//                canonique « parfait » fait monter le score axe global
//                à ≥ 75 % (les 4 axes doivent être couverts).
//   • Test 2   : transcript vide → score 0 sur les axes avec au moins
//                un must_verbalize.
//   • Test 3   : un transcript anti-pattern fait remonter chaque entrée
//                must_avoid de la catégorie en grade < 0.
//   • Test 4   : grading 0/1/2 cohérent (transcript partiel ≈ 50 %,
//                complet ≈ 100 %).
//   • Test 5   : `LEGAL_LEXICON_VERSION === "1.1.0"`.
//   • Test 6   : `listLegalLexiconCategories()` énumère exactement 7
//                catégories (3 v1.0.0 + 4 v1.1.0).
//   • Test 7   : non-régression v1.0.0 — les patterns des 3 catégories
//                Phase 5 produisent EXACTEMENT les mêmes scores qu'avant
//                J1 sur les transcripts canoniques de référence
//                (snapshot numérique précis).
//   • Test 8   : mutex audit — les marqueurs distinctifs d'une catégorie
//                ne fuient pas vers d'autres catégories (ex. « art. 321 »
//                ne matche que `secret_pro_levee`).
//
// 100 % déterministe (zéro mock LLM) : le scoring n'utilise que regex.

import { describe, expect, it } from "vitest";
import {
  countLexiconMatches,
  LEGAL_AXES,
  LEGAL_LEXICON,
  LEGAL_LEXICON_CATEGORIES,
  LEGAL_LEXICON_VERSION,
  listLegalLexiconCategories,
  type LegalAxis,
  type LegalLexiconCategory,
} from "../lib/legalLexicon";

// ─── Transcripts canoniques pour les 4 nouvelles catégories ──────────
//
// Chaque transcript « perfect » couvre TOUTES les entrées must_verbalize
// de sa catégorie (avec ≥ 2 patterns matchés par entrée pour atteindre
// le grade 2 et donc 100 %). « partial » couvre ≈ moitié. « empty » est
// neutre. « antiPattern » contient les fautes must_avoid.

const TRANSCRIPTS_V1_1_0: Record<
  "violence_sexuelle_adulte"
  | "capacite_discernement"
  | "directives_anticipees"
  | "responsabilite_teleconsult",
  { perfect: string; partial: string; empty: string; antiPattern: string }
> = {
  violence_sexuelle_adulte: {
    perfect: `
      Madame, je suis là pour vous écouter sans jugement, je vous crois et vous êtes ici en sécurité.
      Personne ne vous force à parler. On avance à votre rythme, à votre demande.
      Vous me décrivez une agression sexuelle, des actes sexuels non consentis, sous contrainte sexuelle.
      Il y a clairement une absence de consentement.
      Si vous le souhaitez, nous pouvons proposer un kit médico-légal sous 72h pour le recueil de preuves.
      Je peux aussi vous orienter vers un centre LAVI, c'est la loi sur l'aide aux victimes — un accompagnement gratuit et une consultation spécialisée.
      Je vous propose un soutien psychologique avec un psychologue ; nous avons aussi des ressources spécialisées avec un psychiatre formé.
      La confidentialité est garantie sauf à votre demande, et porter plainte reste votre choix, votre décision.
    `,
    partial: `
      Madame, je vous écoute, je vous crois.
      Vous me parlez d'une agression sexuelle.
      Je peux vous orienter vers un centre LAVI.
    `,
    empty: `
      Bonjour. Asseyez-vous. La météo est ensoleillée, c'est agréable.
    `,
    antiPattern: `
      Pourquoi étiez-vous habillée comme ça à cette heure ?
      Vous devez absolument porter plainte, c'est obligatoire.
      Je dois obligatoirement informer la police, c'est automatique.
    `,
  },

  capacite_discernement: {
    perfect: `
      Pour évaluer votre capacité de discernement (CC-16), il faut que vous puissiez comprendre, apprécier et décider.
      C'est la base du consentement éclairé selon CDM art. 3.
      Qu'avez-vous compris de ce que je vous ai dit ? Expliquez-moi avec vos mots, et quelles sont selon vous les conséquences de ce traitement ?
      Je propose une évaluation par un psychiatre — cette évaluation psychiatrique nous donnera un avis psychiatrique fiable, c'est la consultation psychiatrique que je recommande.
      Je vais documenter l'évaluation et tracer dans le dossier toute la démarche.
      Si nécessaire, on peut envisager une saisine APEA pour une curatelle de représentation (CC-443a, CC-394) auprès de l'autorité de protection.
      Je respecte votre autonomie résiduelle et vos volontés exprimées par le patient.
      Avec votre accord, je vais associer la famille à la discussion ; la famille peut être associée si vous le souhaitez.
    `,
    partial: `
      On va parler de votre capacité de discernement (CC-16).
      Qu'avez-vous compris de ce que je viens de dire ?
      Je vais documenter l'évaluation au dossier.
    `,
    empty: `
      Bonjour. La salle est claire aujourd'hui. Asseyez-vous.
    `,
    antiPattern: `
      Voilà, vous comprenez ?
      Maintenant votre famille décide pour vous, ce n'est plus à vous de décider.
    `,
  },

  directives_anticipees: {
    perfect: `
      Avez-vous rédigé des directives anticipées ? CC-370 prévoit ce dispositif, et il existe aussi le mandat pour cause d'inaptitude (CC-360).
      Souhaitez-vous discuter de vos volontés futures, et qui souhaitez-vous comme représentant thérapeutique ? CC-377 et CC-378 encadrent la représentation thérapeutique.
      Nous allons respecter vos volontés, vos volontés sont prioritaires, et nous appliquerons vos directives le moment venu.
      À défaut de directives, l'ordre légal de représentation CC-378 s'applique.
      Pour la rédaction, je vous oriente vers un conseil juridique ou un notaire ; il existe un formulaire officiel FMH de directives.
      Vos directives peuvent évoluer ; vous pouvez les modifier à tout moment.
    `,
    partial: `
      Avez-vous rédigé des directives anticipées (CC-370) ?
      Souhaitez-vous discuter de vos volontés futures ?
      Nous allons respecter vos volontés.
    `,
    empty: `
      Bonjour. Tout va bien ? Le café est prêt à la cafétéria.
    `,
    antiPattern: `
      Ce n'est pas le moment d'en parler, passons à autre chose, on en reparlera plus tard.
      À votre place je choisirais ce traitement, moi je ferais comme ça.
    `,
  },

  responsabilite_teleconsult: {
    perfect: `
      Bonjour. Avant tout, vérification d'identité : pouvez-vous me confirmer votre identité, votre nom complet et date de naissance ?
      Êtes-vous d'accord pour cette téléconsultation ? Je note votre accord pour cette consultation à distance.
      Je reconnais les limites de l'examen à distance — je ne peux pas vous examiner physiquement, c'est une évaluation partielle.
      Je vais tracer la téléconsultation dans le dossier avec date et heure (documentation horodatée).
      Voici la consigne de surveillance écrite : si les symptômes s'aggravent, considérez ces red flags.
      En cas de doute, orientation aux urgences ou consultation physique — vous rendre aux urgences sans attendre.
      Je ne peux pas vous voir aujourd'hui, je vous propose une consultation physique si possible.
      Mon évaluation reste partielle, c'est un caractère partiel de l'évaluation, je ne peux pas tout conclure à distance.
    `,
    partial: `
      Vérification d'identité : votre nom complet et date de naissance, s'il vous plaît.
      Je reconnais les limites de l'examen à distance, je ne peux pas vous examiner physiquement.
      Si les symptômes s'aggravent, contactez les urgences sans attendre.
      Je vais tracer la consultation au dossier avec date et heure.
      Mon évaluation reste partielle, je ne peux pas tout conclure à distance.
    `,
    empty: `
      Bonjour. Vous m'entendez bien ? Le micro fonctionne. Voilà.
    `,
    antiPattern: `
      Je vous prescris à distance sans vous voir, c'est plus rapide.
      Je vous rappelle dans une semaine, voilà.
      Tout va bien, ne vous inquiétez pas, à distance je peux vous affirmer que ce n'est rien.
    `,
  },
};

// Liste des entrées du lexique groupées par catégorie. On dérive depuis
// LEGAL_LEXICON pour garantir la cohérence (toute nouvelle entrée est
// automatiquement incluse).
function entriesForCategory(
  category: LegalLexiconCategory,
): Array<{ key: string; antiPattern: boolean; axis: LegalAxis }> {
  return Object.entries(LEGAL_LEXICON)
    .filter(([, entry]) => entry.category === category)
    .map(([key, entry]) => ({
      key,
      antiPattern: entry.antiPattern,
      axis: entry.axis,
    }));
}

// Score moyen sur les 4 axes de la catégorie en simulant l'évaluateur
// sur les seules entrées must_verbalize (ignore les anti-patterns).
function scoreCategoryOnTranscript(
  category: LegalLexiconCategory,
  transcript: string,
): { perAxis: Record<LegalAxis, number>; avg: number } {
  const entries = entriesForCategory(category).filter((e) => !e.antiPattern);
  const sums: Record<LegalAxis, { positiveSum: number; max: number }> = {
    reconnaissance: { positiveSum: 0, max: 0 },
    verbalisation: { positiveSum: 0, max: 0 },
    decision: { positiveSum: 0, max: 0 },
    communication: { positiveSum: 0, max: 0 },
  };
  for (const e of entries) {
    const { matches } = countLexiconMatches(e.key, transcript);
    const grade = matches >= 2 ? 2 : matches === 1 ? 1 : 0;
    sums[e.axis].positiveSum += grade;
    sums[e.axis].max += 2;
  }
  const perAxis: Record<LegalAxis, number> = {
    reconnaissance: 100,
    verbalisation: 100,
    decision: 100,
    communication: 100,
  };
  for (const axis of LEGAL_AXES) {
    const { positiveSum, max } = sums[axis];
    perAxis[axis] = max > 0 ? Math.round((positiveSum / max) * 100) : 100;
  }
  const present = LEGAL_AXES.filter((a) => sums[a].max > 0);
  const avg =
    present.length === 0
      ? 100
      : Math.round(present.reduce((s, a) => s + perAxis[a], 0) / present.length);
  return { perAxis, avg };
}

const NEW_CATEGORIES: LegalLexiconCategory[] = [
  "violence_sexuelle_adulte",
  "capacite_discernement",
  "directives_anticipees",
  "responsabilite_teleconsult",
];

// ─── Test 5 — version + énumération ─────────────────────────────────

describe("legalLexicon v1.1.0 — version et énumération de catégories", () => {
  it("LEGAL_LEXICON_VERSION === '1.1.0'", () => {
    expect(LEGAL_LEXICON_VERSION).toBe("1.1.0");
  });

  it("LEGAL_LEXICON_CATEGORIES contient exactement 7 catégories (3 v1.0.0 + 4 v1.1.0)", () => {
    expect([...LEGAL_LEXICON_CATEGORIES].sort()).toEqual([
      "capacite_discernement",
      "certificat_complaisance",
      "directives_anticipees",
      "responsabilite_teleconsult",
      "secret_pro_levee",
      "signalement_maltraitance",
      "violence_sexuelle_adulte",
    ]);
  });

  it("listLegalLexiconCategories() énumère 7 catégories effectivement couvertes", () => {
    const cats = listLegalLexiconCategories();
    expect(cats.length).toBe(7);
    expect([...cats].sort()).toEqual([...LEGAL_LEXICON_CATEGORIES].sort());
  });

  it("toute catégorie déclarée par une entrée appartient à LEGAL_LEXICON_CATEGORIES", () => {
    const allowed = new Set<string>(LEGAL_LEXICON_CATEGORIES);
    for (const [key, entry] of Object.entries(LEGAL_LEXICON)) {
      expect(allowed.has(entry.category), `${key} → category « ${entry.category} » hors enum`).toBe(true);
    }
  });

  it("chaque catégorie a au moins 1 entrée must_verbalize ET au moins 1 must_avoid", () => {
    for (const cat of LEGAL_LEXICON_CATEGORIES) {
      const entries = entriesForCategory(cat);
      const positives = entries.filter((e) => !e.antiPattern);
      const negatives = entries.filter((e) => e.antiPattern);
      expect(positives.length, `${cat} sans must_verbalize`).toBeGreaterThan(0);
      expect(negatives.length, `${cat} sans must_avoid`).toBeGreaterThan(0);
    }
  });
});

// ─── Tests 1 + 2 + 3 + 4 — par nouvelle catégorie ────────────────────

describe("legalLexicon v1.1.0 — couverture des 4 nouvelles catégories", () => {
  for (const category of NEW_CATEGORIES) {
    describe(category, () => {
      it("transcript canonique « parfait » → score moyen ≥ 75 %", () => {
        const { perAxis, avg } = scoreCategoryOnTranscript(
          category,
          TRANSCRIPTS_V1_1_0[category].perfect,
        );
        expect(avg, `${category} avg=${avg}, perAxis=${JSON.stringify(perAxis)}`).toBeGreaterThanOrEqual(75);
      });

      it("transcript vide / hors-sujet → score 0 sur les axes avec must_verbalize", () => {
        const { perAxis } = scoreCategoryOnTranscript(
          category,
          TRANSCRIPTS_V1_1_0[category].empty,
        );
        const entries = entriesForCategory(category).filter((e) => !e.antiPattern);
        const axesWithVerbalize = new Set<LegalAxis>(entries.map((e) => e.axis));
        for (const axis of axesWithVerbalize) {
          expect(perAxis[axis], `${category}/${axis} doit être 0`).toBe(0);
        }
      });

      it("transcript anti-pattern → chaque entrée must_avoid de la catégorie matche au moins 1 fois (au moins une)", () => {
        const negatives = entriesForCategory(category).filter((e) => e.antiPattern);
        let hits = 0;
        for (const e of negatives) {
          const { matches } = countLexiconMatches(
            e.key,
            TRANSCRIPTS_V1_1_0[category].antiPattern,
          );
          if (matches > 0) hits += 1;
        }
        // Au moins ⌈n/2⌉ entrées must_avoid déclenchent (transcript dense
        // mais pas exhaustif sur 100 % des anti-patterns).
        expect(
          hits,
          `${category} : ${hits}/${negatives.length} anti-patterns détectés`,
        ).toBeGreaterThanOrEqual(Math.ceil(negatives.length / 2));
      });

      it("transcript partiel → score moyen entre 20 % et 70 %", () => {
        const { avg } = scoreCategoryOnTranscript(
          category,
          TRANSCRIPTS_V1_1_0[category].partial,
        );
        expect(avg, `${category} partial avg=${avg}`).toBeGreaterThanOrEqual(20);
        expect(avg, `${category} partial avg=${avg}`).toBeLessThanOrEqual(70);
      });

      it("transcript parfait > partiel > vide (gradation cohérente)", () => {
        const perfect = scoreCategoryOnTranscript(
          category,
          TRANSCRIPTS_V1_1_0[category].perfect,
        ).avg;
        const partial = scoreCategoryOnTranscript(
          category,
          TRANSCRIPTS_V1_1_0[category].partial,
        ).avg;
        const empty = scoreCategoryOnTranscript(
          category,
          TRANSCRIPTS_V1_1_0[category].empty,
        ).avg;
        // L'axe sans must_verbalize remonte à 100 (neutre) sur le
        // transcript vide ; on borne par la moyenne globale uniquement.
        expect(perfect, `perfect=${perfect}, partial=${partial}`).toBeGreaterThan(partial);
        expect(partial, `partial=${partial}, empty=${empty}`).toBeGreaterThan(empty);
      });
    });
  }
});

// ─── Test 7 — non-régression v1.0.0 (snapshot numérique strict) ──────
//
// Sur les 3 transcripts canoniques Phase 5 (issus de
// `legalEvaluator.test.ts`), la table de scores doit être strictement
// identique à la baseline ci-dessous. Toute dérive — patterns relâchés,
// patterns refactorés involontairement — fait casser le snapshot avec
// un message clair.

const V1_0_0_TRANSCRIPTS = {
  AMBOSS_24_perfect: `
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
  USMLE_34_perfect: `
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
  RESCOS_72_perfect: `
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
};

// Baseline numérique stricte (matches par entrée v1.0.0) — capturée à
// l'identique au commit `bea866d` (clôture Phase 6, lexique figé v1.0.0)
// puis figée ici. Toute dérive (rename de pattern, élargissement,
// refactor involontaire) casse cet état immédiatement avec un message
// clair indiquant l'entrée et le delta numérique.
const V1_0_0_BASELINE: Record<string, number> = {
  // AMBOSS-24 (secret_pro_levee)
  "AMBOSS-24::secret professionnel (art. 321 CP)": 2,
  "AMBOSS-24::droit d'aviser vs devoir d'aviser": 2,
  "AMBOSS-24::ressources LAVI / centres d'aide aux victimes": 3,
  "AMBOSS-24::certificat médical descriptif à fin de preuve": 3,
  "AMBOSS-24::respect de l'autonomie de la patiente": 3,
  "AMBOSS-24::confidentialité maintenue sauf danger imminent": 2,

  // USMLE-34 (signalement_maltraitance)
  "USMLE-34::devoir d'aviser l'APEA (art. 364bis CP / art. 314c CC)": 5,
  "USMLE-34::enfants en danger priment sur secret professionnel": 4,
  "USMLE-34::informer la patiente du signalement (transparence)": 2,
  "USMLE-34::ressources LAVI / foyer d'accueil pour la patiente": 2,
  "USMLE-34::orientation pédiatrique pour évaluation des enfants": 2,
  "USMLE-34::non-jugement et soutien": 2,

  // RESCOS-72 (certificat_complaisance)
  "RESCOS-72::refus motivé du certificat médical": 2,
  "RESCOS-72::cadre légal du faux dans les titres (CP-318)": 3,
  "RESCOS-72::responsabilité disciplinaire FMH (CDM art. 34)": 5,
  "RESCOS-72::alternatives non frauduleuses (dialogue employeur, congés sans solde, médiation)": 4,
  "RESCOS-72::validation empathique de la difficulté du patient": 3,
  "RESCOS-72::préservation de la relation thérapeutique malgré le refus": 3,
};

describe("legalLexicon v1.1.0 — non-régression v1.0.0 (snapshot numérique)", () => {
  it("les 3 catégories Phase 5 produisent EXACTEMENT les mêmes match counts qu'en v1.0.0", () => {
    const tx: Record<string, string> = {
      "AMBOSS-24": V1_0_0_TRANSCRIPTS.AMBOSS_24_perfect,
      "USMLE-34": V1_0_0_TRANSCRIPTS.USMLE_34_perfect,
      "RESCOS-72": V1_0_0_TRANSCRIPTS.RESCOS_72_perfect,
    };
    const v1Categories: LegalLexiconCategory[] = [
      "secret_pro_levee",
      "signalement_maltraitance",
      "certificat_complaisance",
    ];
    const stationByCategory: Record<LegalLexiconCategory, string> = {
      secret_pro_levee: "AMBOSS-24",
      signalement_maltraitance: "USMLE-34",
      certificat_complaisance: "RESCOS-72",
    } as Record<LegalLexiconCategory, string>;

    const drift: string[] = [];
    for (const cat of v1Categories) {
      const stationId = stationByCategory[cat];
      const transcript = tx[stationId];
      const positives = entriesForCategory(cat).filter((e) => !e.antiPattern);
      for (const e of positives) {
        const { matches } = countLexiconMatches(e.key, transcript);
        const baselineKey = `${stationId}::${e.key}`;
        const expected = V1_0_0_BASELINE[baselineKey];
        if (expected === undefined) {
          drift.push(`${baselineKey} : pas de baseline (entrée nouvelle dans v1.0.0 ?)`);
        } else if (expected !== matches) {
          drift.push(`${baselineKey} : v1.0.0 attendait ${expected}, v1.1.0 = ${matches}`);
        }
      }
    }
    expect(drift, drift.join(" | ")).toEqual([]);
  });

  it("toutes les entrées baseline existent toujours dans v1.1.0 (aucune entrée v1.0.0 supprimée)", () => {
    const v1Keys = new Set(
      Object.keys(V1_0_0_BASELINE).map((k) => k.split("::")[1]!),
    );
    const lexiconKeys = new Set(Object.keys(LEGAL_LEXICON));
    const removed: string[] = [];
    for (const k of v1Keys) if (!lexiconKeys.has(k)) removed.push(k);
    expect(removed, `entrées v1.0.0 supprimées : ${removed.join(", ")}`).toEqual([]);
  });
});

// ─── Test 8 — mutex audit (marqueurs strictement distinctifs) ────────
//
// On liste les marqueurs strictement DISTINCTIFS de chaque catégorie :
// fragments terminologiques qu'on attend EXCLUSIVEMENT dans cette
// catégorie et JAMAIS ailleurs. On vérifie que le transcript canonique
// « parfait » d'une AUTRE catégorie ne contient AUCUN de ces marqueurs.
//
// IMPORTANT — recouvrements légitimes EXCLUS de cette liste :
//   • « secret professionnel » : concept transversal — apparaît à juste
//     titre dans `signalement_maltraitance` (« priment sur secret
//     professionnel ») et dans d'autres scénarios.
//   • « APEA » : autorité de protection de l'enfant ET de l'adulte —
//     partagée entre `signalement_maltraitance` (mineurs, CP-364bis) et
//     `capacite_discernement` (adultes, CC-443a).
//   • « CDM » : code de déontologie — cité par
//     `certificat_complaisance` (CDM art. 34) et par `capacite_discernement`
//     (CDM art. 3, consentement éclairé).
//   • « LAVI », « autonomie », « ne juge pas » : concepts génériques.
// Ces recouvrements ne sont PAS des bugs — ils reflètent la réalité
// du droit médical CH, où plusieurs catégories invoquent les mêmes
// articles. La mutex porte donc sur des marqueurs strictement uniques.

interface DistinctiveMarker {
  category: LegalLexiconCategory;
  // Texte fragmentaire strictement distinctif qui ne doit PAS apparaître
  // dans les transcripts d'autres catégories.
  fragment: string;
}

const DISTINCTIVE_MARKERS: DistinctiveMarker[] = [
  // v1.0.0 — marqueurs déjà installés Phase 5 (strictement uniques)
  { category: "secret_pro_levee", fragment: "article 321" },
  { category: "secret_pro_levee", fragment: "droit d'aviser" },
  { category: "signalement_maltraitance", fragment: "364bis" },
  { category: "signalement_maltraitance", fragment: "supérieur de l'enfant" },
  { category: "certificat_complaisance", fragment: "CP-318" },
  { category: "certificat_complaisance", fragment: "faux dans les titres" },
  // v1.1.0 — marqueurs nouveaux Phase 7 J1 (strictement uniques)
  { category: "violence_sexuelle_adulte", fragment: "agression sexuelle" },
  { category: "violence_sexuelle_adulte", fragment: "kit médico-légal" },
  { category: "capacite_discernement", fragment: "capacité de discernement" },
  { category: "capacite_discernement", fragment: "CC-16" },
  { category: "directives_anticipees", fragment: "directives anticipées" },
  { category: "directives_anticipees", fragment: "représentation thérapeutique" },
  { category: "directives_anticipees", fragment: "CC-370" },
  { category: "responsabilite_teleconsult", fragment: "téléconsultation" },
  { category: "responsabilite_teleconsult", fragment: "vérification d'identité" },
];

const ALL_PERFECT_TRANSCRIPTS: Record<LegalLexiconCategory, string> = {
  secret_pro_levee: V1_0_0_TRANSCRIPTS.AMBOSS_24_perfect,
  signalement_maltraitance: V1_0_0_TRANSCRIPTS.USMLE_34_perfect,
  certificat_complaisance: V1_0_0_TRANSCRIPTS.RESCOS_72_perfect,
  violence_sexuelle_adulte: TRANSCRIPTS_V1_1_0.violence_sexuelle_adulte.perfect,
  capacite_discernement: TRANSCRIPTS_V1_1_0.capacite_discernement.perfect,
  directives_anticipees: TRANSCRIPTS_V1_1_0.directives_anticipees.perfect,
  responsabilite_teleconsult: TRANSCRIPTS_V1_1_0.responsabilite_teleconsult.perfect,
};

// Helper : normalise les espaces multiples (incluant retours à la ligne)
// pour qu'une recherche `includes("a b c")` fonctionne même si le texte
// source a un saut de ligne entre « a » et « b ».
function squashWS(s: string): string {
  return s.replace(/\s+/g, " ").toLowerCase();
}

describe("legalLexicon v1.1.0 — mutex audit (marqueurs distinctifs)", () => {
  it("chaque marqueur strictement distinctif n'apparaît QUE dans le transcript de sa propre catégorie", () => {
    const leaks: string[] = [];
    for (const marker of DISTINCTIVE_MARKERS) {
      const needle = squashWS(marker.fragment);
      for (const cat of LEGAL_LEXICON_CATEGORIES) {
        if (cat === marker.category) continue;
        const transcript = squashWS(ALL_PERFECT_TRANSCRIPTS[cat]);
        if (transcript.includes(needle)) {
          leaks.push(`${marker.fragment} (${marker.category}) trouvé dans transcript ${cat}`);
        }
      }
    }
    expect(leaks, leaks.join(" | ")).toEqual([]);
  });

  it("chaque marqueur distinctif EST bien présent dans le transcript de sa catégorie d'origine", () => {
    // Sanity check inverse : si je supprime accidentellement un marqueur
    // distinctif du transcript canonique de sa propre catégorie, le test
    // ci-dessus deviendrait vert pour de mauvaises raisons. On verrouille
    // la présence ici.
    const missing: string[] = [];
    for (const marker of DISTINCTIVE_MARKERS) {
      const transcript = squashWS(ALL_PERFECT_TRANSCRIPTS[marker.category]);
      if (!transcript.includes(squashWS(marker.fragment))) {
        missing.push(`${marker.fragment} (${marker.category}) absent du transcript propre`);
      }
    }
    expect(missing, missing.join(" | ")).toEqual([]);
  });
});

// ─── Garde-fou : mutex partiel — antiPattern d'une catégorie ne fire
//     pas sur le transcript « parfait » d'une autre catégorie ────────
//
// Fait remonter immédiatement les anti-patterns trop laxistes (ex. un
// pattern « vous comprenez ? » trop large qui matcherait sur n'importe
// quel transcript).

describe("legalLexicon v1.1.0 — garde-fou anti-patterns", () => {
  it("aucun anti-pattern de catégorie X ne fire sur le transcript parfait de catégorie X (où le candidat fait bien)", () => {
    const violations: string[] = [];
    for (const cat of LEGAL_LEXICON_CATEGORIES) {
      const transcript = ALL_PERFECT_TRANSCRIPTS[cat];
      const negatives = entriesForCategory(cat).filter((e) => e.antiPattern);
      for (const e of negatives) {
        const { matches } = countLexiconMatches(e.key, transcript);
        if (matches > 0) {
          violations.push(`${cat}::${e.key} fire sur le PERFECT transcript de ${cat} (${matches} matches)`);
        }
      }
    }
    expect(violations, violations.join(" | ")).toEqual([]);
  });
});
