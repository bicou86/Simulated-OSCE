// Phase 5 J2 — évaluateur médico-légal heuristique (zéro LLM).
//
// Pour une station portant un `legalContext` et une transcription donnée,
// produit un score gradé par item, agrégé en pourcentage par axe :
//   reconnaissance / verbalisation / décision / communication.
//
// CONTRAT DE STRICTE ISOLATION (cf. invariants Phase 5 J2)
//   • Aucun appel LLM, aucune dépendance OpenAI/Anthropic.
//   • Endpoint isolé /api/evaluation/legal — ne touche pas
//     /api/evaluator/evaluate (Phase 2/3) ni ses tests.
//   • L'évaluateur consomme `legalContext` via getLegalContext()
//     (server-only, jamais exposé côté client).
//   • Lexique tabulé statique : legalLexicon.ts.

import {
  countLexiconMatches,
  LEGAL_AXES,
  LEGAL_LEXICON,
  LEGAL_LEXICON_VERSION,
  type LegalAxis,
} from "../lib/legalLexicon";
import { getLegalContext } from "./patientService";
import { getStationMeta } from "./stationsService";

export class LegalEvaluatorStationNotFoundError extends Error {
  constructor(public readonly stationId: string) {
    super(`Station ${stationId} introuvable dans le catalogue.`);
    this.name = "LegalEvaluatorStationNotFoundError";
  }
}

export class LegalEvaluatorNoLegalContextError extends Error {
  constructor(public readonly stationId: string) {
    super(
      `Station ${stationId} ne déclare pas de legalContext — pas d'évaluation médico-légale possible.`,
    );
    this.name = "LegalEvaluatorNoLegalContextError";
  }
}

export interface LegalAxisItemReport {
  // Texte littéral de l'item dans la fixture station (= clé de lexique).
  text: string;
  // Concept canonique = ici identique au texte. Champ exposé pour
  // permettre une indirection future (mapping concept stable même si
  // la formulation pédagogique évolue).
  concept: string;
  // Provient de candidate_must_avoid (anti-pattern) ?
  isAntiPattern: boolean;
  // Nombre de patterns DISTINCTS du concept matchés dans la transcription.
  matchedPatterns: number;
  // Note gradée :
  //   • must_verbalize : 0 (rien) / 1 (1 pattern) / 2 (≥ 2 patterns)
  //   • must_avoid     : 0 (rien) / -1 / -2 (pénalités)
  grade: -2 | -1 | 0 | 1 | 2;
}

export interface LegalAxisReport {
  axis: LegalAxis;
  items: LegalAxisItemReport[];
  // Score 0–100 agrégé sur l'axe, cf. règle d'agrégation ci-dessous.
  score_pct: number;
}

export interface LegalEvaluation {
  stationId: string;
  category: string;
  expected_decision: string;
  mandatory_reporting: boolean;
  axes: Record<LegalAxis, LegalAxisReport>;
  // Items must_verbalize qui n'ont pas atteint le grade 1 (au moins
  // 1 pattern matché). Fournit au candidat la liste pédagogique.
  missing: string[];
  // Items must_avoid détectés (grade < 0). Anti-pattern hits.
  avoided: string[];
  // Items dont la clé n'a pas d'entrée correspondante dans le lexique.
  // Devrait toujours être vide en prod (assertion forte côté tests).
  unmapped: string[];
  lexiconVersion: string;
}

export interface EvaluateLegalArgs {
  stationId: string;
  // Transcription concaténée. Peut contenir tour/role markers, ils sont
  // ignorés — la détection est purement keyword/regex.
  transcript: string;
}

// Pénalité par grade négatif sur le score d'axe (en points de pourcentage).
// 1 hit anti-pattern coûte 25 pp ; 2 hits coûtent 50 pp. Cap bas à 0.
const ANTI_PATTERN_PENALTY_PP = 25;

function gradeForMatches(matches: number): -2 | -1 | 0 | 1 | 2 {
  if (matches >= 2) return 2;
  if (matches === 1) return 1;
  return 0;
}

function antiGradeForMatches(matches: number): -2 | -1 | 0 {
  if (matches >= 2) return -2;
  if (matches === 1) return -1;
  return 0;
}

export async function evaluateLegal(
  args: EvaluateLegalArgs,
): Promise<LegalEvaluation> {
  const meta = getStationMeta(args.stationId);
  if (!meta) throw new LegalEvaluatorStationNotFoundError(args.stationId);
  const ctx = await getLegalContext(args.stationId);
  if (!ctx) throw new LegalEvaluatorNoLegalContextError(args.stationId);

  const transcript = args.transcript ?? "";

  // Bucket par axe + collecte des items non mappés dans le lexique.
  const grouped: Record<LegalAxis, LegalAxisItemReport[]> = {
    reconnaissance: [],
    verbalisation: [],
    decision: [],
    communication: [],
  };
  const missing: string[] = [];
  const avoided: string[] = [];
  const unmapped: string[] = [];

  for (const item of ctx.candidate_must_verbalize) {
    const { matches, entry } = countLexiconMatches(item, transcript);
    if (!entry) {
      unmapped.push(item);
      continue;
    }
    if (entry.antiPattern) {
      // Sécurité : un item must_verbalize ne doit JAMAIS pointer sur
      // une entrée flaggée antiPattern. Si ça arrive, on classe en
      // unmapped pour visibilité, sans crasher l'évaluation.
      unmapped.push(item);
      continue;
    }
    const grade = gradeForMatches(matches);
    if (grade === 0) missing.push(item);
    grouped[entry.axis].push({
      text: item,
      concept: item,
      isAntiPattern: false,
      matchedPatterns: matches,
      grade,
    });
  }

  for (const item of ctx.candidate_must_avoid) {
    const { matches, entry } = countLexiconMatches(item, transcript);
    if (!entry) {
      unmapped.push(item);
      continue;
    }
    if (!entry.antiPattern) {
      // Inverse de ci-dessus : un item must_avoid doit pointer sur une
      // entrée flaggée antiPattern.
      unmapped.push(item);
      continue;
    }
    const grade = antiGradeForMatches(matches);
    if (grade < 0) avoided.push(item);
    grouped[entry.axis].push({
      text: item,
      concept: item,
      isAntiPattern: true,
      matchedPatterns: matches,
      grade,
    });
  }

  // Agrégation par axe.
  //   positiveSum / maxPositive  → ratio 0–1 du capital must_verbalize.
  //   pénalité = nb_hits × 25 pp, soustraite du score.
  // Si l'axe n'a AUCUN item must_verbalize ET aucun anti-pattern hit,
  // on retourne 100 (axe non-évaluable, neutre). Dès qu'il y a un hit
  // négatif, on retombe à 100 - pénalité (cohérent avec la sémantique
  // « ne fais pas X »).
  const axes: Record<LegalAxis, LegalAxisReport> = {
    reconnaissance: { axis: "reconnaissance", items: [], score_pct: 100 },
    verbalisation: { axis: "verbalisation", items: [], score_pct: 100 },
    decision: { axis: "decision", items: [], score_pct: 100 },
    communication: { axis: "communication", items: [], score_pct: 100 },
  };
  for (const axis of LEGAL_AXES) {
    const items = grouped[axis];
    let positiveSum = 0;
    let maxPositive = 0;
    let antiHits = 0;
    for (const it of items) {
      if (!it.isAntiPattern) {
        positiveSum += it.grade;
        maxPositive += 2;
      } else if (it.grade < 0) {
        antiHits += Math.abs(it.grade);
      }
    }
    const positivePct = maxPositive > 0 ? (positiveSum / maxPositive) * 100 : 100;
    const penalty = antiHits * ANTI_PATTERN_PENALTY_PP;
    const score = Math.max(0, Math.min(100, Math.round(positivePct - penalty)));
    axes[axis] = { axis, items, score_pct: score };
  }

  return {
    stationId: args.stationId,
    category: ctx.category,
    expected_decision: ctx.expected_decision,
    mandatory_reporting: ctx.mandatory_reporting,
    axes,
    missing,
    avoided,
    unmapped,
    lexiconVersion: LEGAL_LEXICON_VERSION,
  };
}

// Réexports utiles aux tests / au front (typage uniquement).
export { LEGAL_AXES, LEGAL_LEXICON, LEGAL_LEXICON_VERSION };
export type { LegalAxis };
