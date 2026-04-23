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

export type StationType =
  | "teleconsultation"
  | "pediatrie_accompagnant"
  | "bbn"
  | "psy"
  | "triage"
  | "anamnese_examen";

export type EvaluationAxis =
  | "anamnese"
  | "examen"
  | "management"
  | "cloture"
  | "communication";

export interface AxisWeights {
  anamnese: number;
  examen: number;
  management: number;
  cloture: number;
  communication: number;
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
