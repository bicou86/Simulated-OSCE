// Phase 9 J2 — helpers de découpage chronométré pour les stations doubles
// partie 2 (Bug 3a). Extrait de Simulation.tsx pour permettre des tests
// unitaires purs (sans monter le composant React).
//
// CONVENTION
//   • Stations classiques (sans `phases[]`) : durée legacy 13 min unique.
//   • Stations multi-phases (RESCOS-64-P2) : timer démarre sur la durée
//     de la première phase ; transitions automatiques de phase en phase
//     (voir Simulation.tsx useEffect timer pour la logique runtime).

export const TOTAL_DURATION_LEGACY_SEC = 13 * 60;

export interface PhaseLike {
  id: string;
  label: string;
  minutes: number;
  kind: "silent" | "examiner";
}

// Durée initiale (en secondes) du timer pour une station :
//   • si `phases[]` est défini et non vide → durée de phases[0]
//   • sinon → 13 min (legacy 287 stations classiques)
export function computeInitialPhaseDuration(
  brief: { phases?: PhaseLike[] } | null | undefined,
): number {
  if (brief?.phases && brief.phases.length > 0) {
    return brief.phases[0].minutes * 60;
  }
  return TOTAL_DURATION_LEGACY_SEC;
}

// Somme des durées (minutes) des phases déclarées. Pour RESCOS-64-P2 :
// 4 + 9 = 13 (conforme arbitrage utilisateur Phase 9 cadrage B). Retourne
// 0 quand `phases` est absent (pas de durée déclarée par phases).
export function sumPhaseMinutes(brief: { phases?: PhaseLike[] } | null | undefined): number {
  if (!brief?.phases || brief.phases.length === 0) return 0;
  return brief.phases.reduce((acc, p) => acc + p.minutes, 0);
}

// Vrai si la station expose un découpage multi-phases. Sert à conditionner
// la désactivation de l'annonce T-2 min sur les stations multi-phases (la
// transition prep→présent est l'événement notable principal).
export function hasMultiplePhases(brief: { phases?: PhaseLike[] } | null | undefined): boolean {
  return !!brief?.phases && brief.phases.length > 0;
}
