// Table statique de pondération des axes d'évaluation par station_type.
//
// Source de vérité unique — éditable dans un seul fichier, pas dispersée.
// Poids exprimés en points sur un total de 100 par ligne. La somme est
// vérifiée au chargement (throw si ≠ 100), garantissant la reproductibilité
// des scores par type de station.
//
// ECOS invariant n°2 : pondérations statiques, pas de recalcul dynamique,
// pas de LLM impliqué dans la décision des poids.
//
// NB : le fichier vit sous `shared/` (et non `config/`) pour être importable
// des deux côtés (client évaluation panel, serveur évaluateur) via l'alias
// `@shared/*` configuré dans tsconfig — tsc n'indexe pas `/config/` à la
// racine aujourd'hui.
//
// ─── Phase 7 J2 — 6e axe `medico_legal` (additif, conditionnel) ───
// La table EVALUATION_WEIGHTS reste inchangée (5 axes, somme = 100). C'est
// le backbone canonique des stations sans qualification médico-légale.
// Quand une station porte un `legalContext` non-null (Phase 5/6), le
// service évaluateur consomme `getEffectiveAxisWeights(type, true)` qui
// rééquilibre proportionnellement (cf. règle ci-dessous). Les stations
// SANS legalContext continuent de consommer `getAxisWeights(type)` à
// l'identique, garantissant la non-régression byte-à-byte du score
// global.

export type StationType =
  | "teleconsultation"
  | "pediatrie_accompagnant"
  | "bbn"
  | "psy"
  | "triage"
  | "anamnese_examen";

// Phase 5/6 — 5 axes canoniques (mode statique, sans qualification médico-légale).
export type EvaluationAxis =
  | "anamnese"
  | "examen"
  | "management"
  | "cloture"
  | "communication";

// Phase 7 J2 — 6e axe additif. `medico_legal` est UNIQUEMENT actif sur
// les stations qui portent un `legalContext` (cf. invariant additif).
export type EvaluationAxis6 = EvaluationAxis | "medico_legal";

export interface AxisWeights {
  anamnese: number;
  examen: number;
  management: number;
  cloture: number;
  communication: number;
}

// Phase 7 J2 — Forme effective des poids quand le 6e axe est actif.
// Reste compatible avec AxisWeights (mêmes 5 clés) + le 6e axe additif.
// Les valeurs peuvent être flottantes (ex. 25 × 0.9 = 22.5) — l'unité
// reste « points sur 100 ».
export interface AxisWeights6 extends AxisWeights {
  medico_legal: number;
}

// Table fournie par le user 2026-04-23. Calibration initiale, ajustable après
// test d'au moins une station par type en Phase 2. Justification clinique
// par ligne pour audit humain futur.
export const EVALUATION_WEIGHTS = {
  // Station clinique classique : 4 axes en équilibre, pas de valeur
  // pédagogique supplémentaire pour la communication au-delà du baseline.
  // Poids Communication = 0 → garantit la non-régression score-à-score sur
  // toutes les stations déjà validées pré-Phase 2.
  anamnese_examen: {
    anamnese: 25,
    examen: 25,
    management: 25,
    cloture: 25,
    communication: 0,
  },
  // Annonce de mauvaise nouvelle : le geste communicationnel (protocole
  // SPIKES, silence, empathie, respect du rythme) domine l'évaluation.
  // Examen minimal car le patient est déjà diagnostiqué.
  bbn: {
    anamnese: 15,
    examen: 5,
    management: 15,
    cloture: 25,
    communication: 40,
  },
  // Entretien psychiatrique : anamnèse approfondie + alliance thérapeutique,
  // examen physique réduit mais communication cruciale (écoute active,
  // évaluation risque suicidaire, reformulation).
  psy: {
    anamnese: 25,
    examen: 5,
    management: 20,
    cloture: 20,
    communication: 30,
  },
  // Pédiatrie avec accompagnant : examen reste nécessaire (enfant physique),
  // mais la communication avec le parent (rassurance, clarté, reformulation
  // en registre familier) prend 20% du poids.
  pediatrie_accompagnant: {
    anamnese: 25,
    examen: 20,
    management: 20,
    cloture: 15,
    communication: 20,
  },
  // Téléconsultation : examen physique impossible (5 pts pour les signes
  // visuels / auditifs), anamnèse prime (35), management critique (30 —
  // orienter vers présentiel si besoin), communication adaptée au canal (15).
  teleconsultation: {
    anamnese: 35,
    examen: 5,
    management: 30,
    cloture: 15,
    communication: 15,
  },
  // Triage (USMLE_Triage) : priorisation rapide multi-patients, management
  // et décision clinique dominent, examen ciblé, communication minimale.
  triage: {
    anamnese: 30,
    examen: 20,
    management: 35,
    cloture: 10,
    communication: 5,
  },
} as const satisfies Record<StationType, AxisWeights>;

// ─── Runtime guard : somme = 100 par ligne ───
// Exécuté au chargement du module. Une entrée qui ne somme pas à 100 jette
// immédiatement — évite qu'un score pondéré silencieusement erroné parte en
// prod. Intentionnellement placé au top-level pour que l'erreur soit levée
// dès le premier import, pas à l'usage.
(function assertWeightsSumTo100(): void {
  for (const [type, axes] of Object.entries(EVALUATION_WEIGHTS)) {
    const sum = axes.anamnese + axes.examen + axes.management + axes.cloture + axes.communication;
    if (sum !== 100) {
      throw new Error(
        `[evaluation-weights] ligne "${type}" somme à ${sum} (attendu 100). ` +
        `Ajuste shared/evaluation-weights.ts avant de booter.`,
      );
    }
  }
})();

// Accesseur typé. Évite qu'un appelant passe un string arbitraire et
// récupère un `undefined` silencieux — si le station_type n'existe pas dans
// la table, on jette explicitement.
export function getAxisWeights(stationType: StationType): AxisWeights {
  const w = EVALUATION_WEIGHTS[stationType];
  if (!w) {
    throw new Error(`[evaluation-weights] pas d'entrée pour station_type "${stationType}"`);
  }
  return w;
}

// Liste des axes dans l'ordre d'affichage canonique (matché par l'UI
// évaluation pour le display du poids à côté de chaque score).
export const EVALUATION_AXES: readonly EvaluationAxis[] = [
  "anamnese",
  "examen",
  "management",
  "cloture",
  "communication",
] as const;

// ─── Phase 7 J2 — Constantes du 6e axe `medico_legal` ───
//
// Règle de rééquilibrage (option a, proportionnelle, arbitrée user) :
// quand une station porte un `legalContext`, chaque axe v1 est multiplié
// par LEGAL_CONTEXT_RESCALE_FACTOR (0.9), et `medico_legal` reçoit
// MEDICO_LEGAL_WEIGHT_PCT (10). La somme reste 100.
//
//   exemple anamnese_examen :
//     v1 → { anamnese: 25, examen: 25, management: 25, cloture: 25, communication: 0 }
//     v2 → { anamnese: 22.5, examen: 22.5, management: 22.5, cloture: 22.5,
//            communication: 0, medico_legal: 10 }   (somme = 100)
//
//   exemple bbn :
//     v1 → { anamnese: 15, examen: 5, management: 15, cloture: 25, communication: 40 }
//     v2 → { anamnese: 13.5, examen: 4.5, management: 13.5, cloture: 22.5,
//            communication: 36, medico_legal: 10 } (somme = 100)
//
// L'invariance « score global byte-à-byte vs Phase 6 sur stations SANS
// legalContext » est garantie par le fait que `getEffectiveAxisWeights(type, false)`
// retourne EXACTEMENT EVALUATION_WEIGHTS[type] augmenté de medico_legal=0
// (qui est exclu de la formule globalScore = Σ score×weight / Σ weight>0).
export const MEDICO_LEGAL_WEIGHT_PCT = 10;
export const LEGAL_CONTEXT_RESCALE_FACTOR = 0.9;

// Liste des 6 axes dans l'ordre d'affichage canonique étendu (mode 6-axes).
// Le 6e axe est ajouté en queue — JAMAIS rename ni réordonner les 5 premiers
// (invariant additif Phase 7 J2 : tout breakage de cet ordre casserait
// l'UI Evaluation, les fixtures de non-régression, et les tests d'invariant).
export const EVALUATION_AXES_6: readonly EvaluationAxis6[] = [
  "anamnese",
  "examen",
  "management",
  "cloture",
  "communication",
  "medico_legal",
] as const;

// Phase 7 J2 — accesseur des poids effectifs en mode dynamique.
//
// Si `hasLegalContext = false` : retourne les 5 poids v1 inchangés +
//   medico_legal = 0 (axe inactif, exclu du globalScore via Σ w>0).
// Si `hasLegalContext = true`  : retourne les 5 poids v1 × 0.9 +
//   medico_legal = 10 (somme = 100).
//
// Source de vérité UNIQUE pour la pondération dynamique. À ne pas
// dupliquer côté router/middleware/UI : le service évaluateur consomme
// cette fonction et expose les poids résultats dans `sections[].weight`.
export function getEffectiveAxisWeights(
  stationType: StationType,
  hasLegalContext: boolean,
): AxisWeights6 {
  const base = getAxisWeights(stationType);
  if (!hasLegalContext) {
    // Mode 5-axes (statu quo Phase 5/6). medico_legal=0 ⇒ axe inactif,
    // exclu de Σ score×weight / Σ weight>0. Garantit la non-régression
    // byte-à-byte sur les 282+ stations sans qualification médico-légale.
    return { ...base, medico_legal: 0 };
  }
  // Mode 6-axes. Multiplications flottantes ; on garde la précision
  // native JavaScript (IEEE 754) — les arrondis interviennent uniquement
  // au niveau du Math.round(globalScore) côté evaluatorService. Le
  // facteur 0.9 est exact en flottant (= 9/10 binaire approximé) ; les
  // tests Phase 7 J2 tolèrent 1e-2 sur la formule de cohérence.
  return {
    anamnese: base.anamnese * LEGAL_CONTEXT_RESCALE_FACTOR,
    examen: base.examen * LEGAL_CONTEXT_RESCALE_FACTOR,
    management: base.management * LEGAL_CONTEXT_RESCALE_FACTOR,
    cloture: base.cloture * LEGAL_CONTEXT_RESCALE_FACTOR,
    communication: base.communication * LEGAL_CONTEXT_RESCALE_FACTOR,
    medico_legal: MEDICO_LEGAL_WEIGHT_PCT,
  };
}
