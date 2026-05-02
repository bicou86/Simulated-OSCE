// Phase 9 J3 — Bug 2 transition automatique P1 → P2 stations doubles.
//
// Helper qui déclenche l'évaluation de la partie 1 (consultation patient)
// à la transition vers la partie 2, sans bloquer l'expérience candidat.
//
// CONVENTION ENDPOINTS (cf. arbitrage Q-A2bis Phase A) :
//   • Fin de P1 (consultation patient) :
//       - POST /api/evaluator/evaluate (6-axes Phase 2/3) — principal
//       - POST /api/evaluation/legal (4 axes Phase 7) — toujours appelé,
//         le serveur répond 400 silencieusement si la station n'a pas
//         de legalContext (l'UI absorbe l'erreur ; cf. Option Q-A4 b)
//   • Fin de P2 (présentation orale) : POST /api/evaluation/presentation
//     (4 axes Phase 8 J3) — pas géré par ce module (déclenché ailleurs).
//
// COMPORTEMENT ÉCHEC (Q-A4 Option b validée utilisateur) :
//   • Toast d'erreur visible candidat
//   • Stocker { error: "..." } en sessionStorage `osce.eval.${stationId}`
//   • Continuer la transition vers P2 (ne pas bloquer)
//   • Le bilan final affichera « évaluation P1 indisponible » si error présent

import { evaluate, evaluateLegal, type EvaluationResult, type LegalEvaluation } from "@/lib/api";

// Forme du payload sessionStorage pour l'évaluation P1.
// La clé est `osce.eval.${stationId}` (P1.stationId, distinct du transcript
// `osce.session.${stationId}` utilisé par la page /evaluation).
export interface Part1EvaluationRecord {
  stationId: string;
  evaluatorResult: EvaluationResult | null;
  legalEvaluation: LegalEvaluation | null;
  timestamp: number;
  error: string | null;
}

export const PART1_EVAL_STORAGE_PREFIX = "osce.eval.";

export function part1EvalStorageKey(stationId: string): string {
  return `${PART1_EVAL_STORAGE_PREFIX}${stationId}`;
}

// Sérialise et stocke en sessionStorage. Aucun lance d'erreur si
// sessionStorage est désactivé (cas test ou navigation privée stricte) :
// on log et on continue.
export function writePart1EvaluationRecord(record: Part1EvaluationRecord): void {
  try {
    sessionStorage.setItem(
      part1EvalStorageKey(record.stationId),
      JSON.stringify(record),
    );
  } catch {
    // sessionStorage indisponible — ignoré silencieusement.
  }
}

// Lit le record depuis sessionStorage. Retourne null si clé absente ou JSON
// malformé. Utilisé par la future combinaison UI P1+P2 (dette Phase 9 #7,
// non implémentée en J3 — cf. arbitrage Q-A6).
export function readPart1EvaluationRecord(stationId: string): Part1EvaluationRecord | null {
  try {
    const raw = sessionStorage.getItem(part1EvalStorageKey(stationId));
    if (!raw) return null;
    return JSON.parse(raw) as Part1EvaluationRecord;
  } catch {
    return null;
  }
}

// Déclenche l'évaluation P1 en parallèle (evaluator + legal) et stocke le
// résultat dans sessionStorage. Ne lance jamais d'erreur côté caller : si
// les deux endpoints échouent, le record contient `error` non vide et les
// deux résultats sont null. L'UI peut afficher un toast à la lecture du
// retour.
//
// Note : `transcript` doit être au format consommé par /evaluator/evaluate
// (`[{role: "doctor"|"patient", text}]`). La conversion examiner→patient
// est faite côté Simulation.tsx avant appel (cf. handleDebrief existant).
export async function runPart1Evaluation(
  stationId: string,
  transcript: Array<{ role: "doctor" | "patient"; text: string }>,
): Promise<Part1EvaluationRecord> {
  const startedAt = Date.now();
  // Sérialisation du transcript pour l'endpoint legal (qui attend un
  // string concaténé, cf. EvaluateLegalInput dans api.ts).
  const transcriptString = transcript
    .map((t) => `[${t.role}] ${t.text}`)
    .join("\n");

  const [evaluatorOutcome, legalOutcome] = await Promise.allSettled([
    evaluate({ stationId, transcript }),
    evaluateLegal({ stationId, transcript: transcriptString }),
  ]);

  const evaluatorResult =
    evaluatorOutcome.status === "fulfilled" ? evaluatorOutcome.value : null;
  // /api/evaluation/legal répond 400 sur stations sans legalContext (cas
  // normal pour la majorité des stations historiques). On considère ce
  // 400 comme "non applicable" plutôt que comme erreur. Pour l'évaluateur
  // principal, en revanche, un échec est une erreur réelle.
  const legalEvaluation =
    legalOutcome.status === "fulfilled" ? legalOutcome.value : null;

  // Erreur globale uniquement si l'évaluateur principal a échoué (legal
  // indisponible = pas applicable, pas une erreur bloquante).
  const error =
    evaluatorOutcome.status === "rejected"
      ? `evaluator: ${(evaluatorOutcome.reason as Error)?.message ?? "erreur inconnue"}`
      : null;

  const record: Part1EvaluationRecord = {
    stationId,
    evaluatorResult,
    legalEvaluation,
    timestamp: startedAt,
    error,
  };
  writePart1EvaluationRecord(record);
  return record;
}
