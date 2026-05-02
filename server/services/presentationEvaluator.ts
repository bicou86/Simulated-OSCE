// Phase 8 J3 — évaluateur de la partie 2 d'une station double (présentation
// orale au spécialiste). Heuristique pure, ZÉRO LLM dans la décision.
//
// CONTRAT
//   • Endpoint isolé /api/evaluation/presentation — ne touche pas
//     /api/evaluator/evaluate (Phase 2/3) ni /api/evaluation/legal (Phase 5).
//   • Scoring 4 axes 25% chacun, isolé du scoring 6-axes (arbitrage
//     utilisateur Phase 8 #4 : grille séparée, jamais agrégée).
//   • Source de vérité = `grille` + `weights` du fichier Examinateur
//     correspondant à la station partie 2 (ex. Examinateur_RESCOS_4.json
//     pour RESCOS-64-P2). Le bloc `presentation` côté patient
//     (Patient_RESCOS_4.json:3320-3447) est DORMANT et NON consommé ici
//     (cf. dette Phase 9 : audit historique format object 14 entrées).
//
// SCORING — décisions issues des arbitrages Phase A J3 :
//
//   1) binaryOnly:true + items_attendus      → token-based keyword match
//                                                 (Phase 10 J1 dette 2), 1/0
//   2) binaryOnly:true sans items_attendus   → extraction diagnostic du `text`
//      (5 diagnostics axe raisonnement)         via regex /Diagnostic[^:]+: (.+)/,
//                                               puis match transcript, 1/0
//                                               (Ambiguïté B → option B1)
//   3) binaryOnly:false + scoringRule        → 3 modes selon format :
//        • count-based  ("4-6 = 3 pts, …")        + recalibration max si
//                                                   nbExpected (split CSV) <
//                                                   ruleMax (Q(a) recalibration)
//        • token-based  ("Toux = 1 pt, …")         score=Σ matched, max=Σ points
//                                                   (cas p3, Q(a) token-based)
//        • alias-binaire ("Fait / ± / Pas fait")  cas r16, p15
//   4) binaryOnly:false sans scoringRule    → β fractional :
//                                              score = nbMatched / nbExpected,
//                                              max = 1 (Ambiguïté A → option β)
//   5) Cas spécial items_attendus = ["Aucun"] → SKIP SILENT (item r14,
//                                                Ambiguïté C → option C3)
//
// LIMITES CONNUES (dette Phase 9, documentées et acceptées) :
//   • Heuristique ne distingue pas affirmation/négation. Un transcript
//     « pas de tuberculose » matche « Tuberculose » comme positif.
//     Acceptable car invariant zéro-LLM ; raffinement futur si LLM autorisé.
//   • Recalibration max scoringRule : quand items_attendus split CSV <
//     ruleMax, le max est cappé sur la clause correspondante (ex. p4/p5/p7
//     max=1 au lieu de 2). À raffiner si (i) cleanup fixture ajoutant les
//     2e éléments explicites avec validation médicale experte, ou (ii)
//     LLM-assist autorisé pour détection sémantique fine du 2e élément.
//   • Format scoringRule token-based détecté par fallback heuristique
//     (clause ni-Fait-ni-numérique → mode token). À normaliser si Phase 9+
//     étend le format (discriminant explicite, format DSL structuré).

import { getStationMeta } from "./stationsService";
import { getEvaluatorStation } from "./evaluatorService";

export const PRESENTATION_AXES = [
  "presentation",
  "raisonnement",
  "examens",
  "management",
] as const;
export type PresentationAxis = (typeof PRESENTATION_AXES)[number];

export const PRESENTATION_WEIGHTS: Record<PresentationAxis, number> = {
  presentation: 0.25,
  raisonnement: 0.25,
  examens: 0.25,
  management: 0.25,
};

export class PresentationEvaluatorStationNotFoundError extends Error {
  constructor(public readonly stationId: string) {
    super(`Station ${stationId} introuvable dans le catalogue.`);
    this.name = "PresentationEvaluatorStationNotFoundError";
  }
}

export class PresentationEvaluatorNotPart2Error extends Error {
  constructor(public readonly stationId: string) {
    super(
      `Station ${stationId} n'est pas une partie 2 (parentStationId absent). Endpoint /api/evaluation/presentation réservé aux stations partie 2.`,
    );
    this.name = "PresentationEvaluatorNotPart2Error";
  }
}

export class PresentationEvaluatorMissingGrilleError extends Error {
  constructor(public readonly stationId: string) {
    super(
      `Station ${stationId} (partie 2) n'a pas de grille de scoring. Vérifier le fichier Examinateur_*.json.`,
    );
    this.name = "PresentationEvaluatorMissingGrilleError";
  }
}

interface RawGrilleItem {
  id: string;
  text: string;
  binaryOnly?: boolean;
  scoringRule?: string;
  items_attendus?: string[];
}

interface RawGrille {
  presentation?: RawGrilleItem[];
  raisonnement?: RawGrilleItem[];
  examens?: RawGrilleItem[];
  management?: RawGrilleItem[];
}

export interface PresentationItemReport {
  id: string;
  text: string;
  binaryOnly: boolean;
  scoringRule: string | null;
  matched: string[];
  expected: number;
  score: number;
  max: number;
  // True si l'item est skip silent (cas "Aucun" → ne compte ni au score
  // ni au max de l'axe). expected/score/max=0.
  skipped: boolean;
}

export interface PresentationAxisReport {
  axis: PresentationAxis;
  items: PresentationItemReport[];
  score: number;
  max: number;
  // score / max, 0 si max=0. Borné [0,1].
  normalized: number;
}

export interface PresentationEvaluation {
  stationId: string;
  parentStationId: string;
  axes: Record<PresentationAxis, PresentationAxisReport>;
  weights: Record<PresentationAxis, number>;
  // Score pondéré global 0–100, somme(axe.normalized × weight) × 100.
  weightedScore: number;
}

// ─────────────────────────────────────────────────────────────────────────
// Helpers heuristiques (exposés via __test__ pour tests unitaires fins)

const STOPWORDS = new Set<string>([
  "le", "la", "les", "un", "une", "des", "du", "de", "au", "aux",
  "pour", "contre", "avec", "sans", "dans", "sur", "ou", "et", "est",
  "pas", "ne", "ni", "par", "cette", "ces", "son", "sa", "ses",
  // Phase A ajustement 1 (utilisateur) : mots trop génériques.
  "diagnostic", "patient", "argument", "elements", "element",
]);

const KEYWORD_THRESHOLD = 0.6; // Phase A ajustement 2 (utilisateur) : 50% → 60%
const MIN_KEYWORD_LEN = 4;

function normalizeText(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Découpe un items_attendus[0] CSV (séparateur virgule) en sous-éléments.
function splitCsvItems(raw: string): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

// ─── Phase 10 J1 — dette 2 : tokenize (matching token-based) ──────────────
//
// Normalise le texte (lowercase + NFD strip diacritics + alphanum/space)
// puis le découpe sur les espaces en tokens non-vides. Source de vérité
// unique pour le matching scoringRule, déterministe, ZÉRO LLM.
//
// Lié à dette 3 (J2) : un matching token-based connaît la position des
// keywords dans la séquence de tokens du transcript et permettra à la
// dette 3 de chercher des marqueurs de négation ("pas", "aucun", etc.)
// dans le même syntagme. Le matching substring pré-J1 ne le permettait pas.
//
// Exemples :
//   tokenize("Tabagisme actif à 35 UPA")  → ["tabagisme","actif","a","35","upa"]
//   tokenize("Pas de fièvre, pas de TBC") → ["pas","de","fievre","pas","de","tbc"]
//   tokenize("(Aggravation de) toux")     → ["aggravation","de","toux"]
//   tokenize("")                          → []
function tokenize(text: string): string[] {
  return normalizeText(text)
    .split(/\s+/)
    .filter((t) => t.length > 0);
}

// ─── Phase 10 J2 — dette 3 : marqueurs de négation transcript ─────────────
//
// Liste blanche déterministe des marqueurs grammaticaux (« pas », « non »…),
// nominaux d'absence (« absence », « absent »…) et médicaux d'exclusion
// (« négatif », « exclu »…). Stockée en forme post-normalizeText :
// lowercase + sans diacritiques (ex. "negatif" pas "négatif"), cohérent
// avec le tokenizer J1 (NFD strip).
//
// Source de vérité unique côté presentationEvaluator. Aucune mutation
// runtime (Set readonly de fait, vérifié par test J2).
//
// Q-N1 validée utilisateur : 19 marqueurs cliniques élargis.
const NEGATION_MARKERS = new Set<string>([
  // Négations grammaticales standard
  "pas", "non", "ni", "sans", "jamais",
  "aucun", "aucune", "aucuns", "aucunes",
  // Marqueurs nominaux d'absence
  "absence", "absent", "absente", "absents", "absentes",
  // Marqueurs médicaux d'exclusion
  "negatif", "negative", "negatifs", "negatives",
  "exclu", "exclue", "exclus", "exclues",
  "nie", "nient",
]);

// ─── Phase 10 J2 — dette 3 : fenêtre de détection négation ───────────────
//
// Q-N2 validée : taille fenêtre = 4 tokens AVANT le keyword. Compromis :
//   • plus petit (2) : casse « jamais X de Y » (marqueur trop loin)
//   • plus grand (6+) : risque de relier des mots non liés
// Q-N3 validée : asymétrique avant uniquement. La négation précède le
// mot nié dans la quasi-totalité des cas en français (« pas de X »,
// « aucun Y », « absence de Z »). Le cas marqueur APRÈS keyword (ex.
// « tuberculose absente ») est ignoré volontairement par simplicité —
// limite documentée et préservée comme telle dans les tests J2.
const NEGATION_WINDOW_SIZE = 4;

// Retourne tous les indices où `keyword` apparaît dans la séquence de
// tokens du transcript. Un keyword apparaissant N fois retourne N
// positions. Tableau vide si keyword absent. Source de vérité positionnelle
// pour `isNegated` (J2).
function findKeywordPositions(
  keyword: string,
  transcriptTokens: string[],
): number[] {
  const positions: number[] = [];
  for (let i = 0; i < transcriptTokens.length; i++) {
    if (transcriptTokens[i] === keyword) positions.push(i);
  }
  return positions;
}

// Détecte si `keyword` apparaît dans un contexte négatif dans la séquence
// de tokens du transcript. Sémantique A-strict (Q-N5 validée) :
//
//   • Pour chaque occurrence de `keyword`, on regarde la fenêtre des
//     `windowSize` tokens AVANT (asymétrique Q-N3) ; si l'un d'eux est
//     un NEGATION_MARKER, l'occurrence est considérée niée.
//   • Le keyword est globalement « nié » SSI TOUTES ses occurrences le
//     sont. S'il existe au moins une occurrence non-niée ailleurs dans
//     le transcript, le keyword est globalement non-nié.
//   • Keyword absent → `false` (pas négation possible).
//
// Limite assumée (cf. simulation phase B Q-N5) : sur un transcript
// composé artificiellement de tous les items_attendus (cas synthétique
// du test « transcript parfait »), un keyword partagé entre un item
// négatif (ex. r9 « pas de TVP ») et un item positif (ex. e9 « Bilan
// angiologique veineux (TVP) ») a `transNeg=false`, ce qui mène à un
// faux négatif sur l'item négatif. Acceptable car ces cas correspondent
// à un candidat réel cohérent (mention positive dans un contexte +
// argumentation négative dans un autre). Reportée en backlog Phase 11+
// comme dette « Désambiguïsation positionnelle keywords partagés ».
function isNegated(
  keyword: string,
  transcriptTokens: string[],
  windowSize = NEGATION_WINDOW_SIZE,
): boolean {
  const positions = findKeywordPositions(keyword, transcriptTokens);
  if (positions.length === 0) return false;
  return positions.every((pos) => {
    const start = Math.max(0, pos - windowSize);
    for (let i = start; i < pos; i++) {
      if (NEGATION_MARKERS.has(transcriptTokens[i])) return true;
    }
    return false;
  });
}

// ─── Phase 10 J1 — dette 2 + Phase 10 J2 — dette 3 : detectMention ────────
//
// Refactor J1 : matching scoringRule substring → token-based. Sémantique :
//   • Tokenize l'item en keywords filtrés (≥ MIN_KEYWORD_LEN, hors STOPWORDS)
//   • Match si ≥ KEYWORD_THRESHOLD (60%) des keywords sont présents dans
//     le SET des tokens du transcript (égalité stricte, pas substring).
//   • Item court sans keyword : fallback égalité tous tokens ⊆ set.
//
// Refactor J2 (dette 3) : sémantique A-strict SYMÉTRIQUE. Un keyword
// présent dans le set du transcript matche SSI son ÉTAT DE NÉGATION
// est identique côté item et côté transcript :
//   • Item « Tuberculose » + transcript « pas de tuberculose » :
//     itemNeg(tuberculose)=false, transNeg(tuberculose)=true → mismatch
//     → no match (corrigé J2)
//   • Item « pas de fièvre » + transcript « pas de fièvre » :
//     itemNeg(fievre)=true, transNeg(fievre)=true → match symétrique
//     → match (préserve la sémantique pédagogique des items « négatifs »
//     comme r6/r9/r12/r15)
//   • Item « pas de fièvre » + transcript « il a de la fièvre » :
//     itemNeg(fievre)=true, transNeg(fievre)=false → mismatch
//     → no match (faux positif pédagogique évité)
//
// Bénéfices J2 :
//   • « pas de tuberculose » ne matche plus « Tuberculose »
//   • « aucune hémoptysie » ne matche plus « Hémoptysie »
//   • « pas de fièvre » ne matche plus « fièvre »
//
// Limites assumées :
//   • Q-N3 asymétrique avant : « tuberculose absente » matche encore
//     (marqueur APRÈS le keyword, ignoré par construction).
//   • Cas-limite synthétique : sur transcript artificiel concaténant
//     items contradictoires partageant des keywords (ex. r9.tvp +
//     e9.tvp), `isNegatedAny` global voit le keyword comme non-nié
//     côté transcript → faux négatifs documentés (cf. relock test
//     « transcript parfait » à 97.97). Reportée Phase 11+ comme
//     dette « Désambiguïsation positionnelle keywords partagés ».
//
// Constantes MIN_KEYWORD_LEN, STOPWORDS, KEYWORD_THRESHOLD INCHANGÉES
// depuis Phase 8 J3.
function detectMention(subItem: string, transcript: string): boolean {
  const itemTokens = tokenize(subItem);
  if (itemTokens.length === 0) return false;
  const transcriptTokens = tokenize(transcript);
  const transTokens = new Set(transcriptTokens);
  const keywords = itemTokens.filter(
    (t) => t.length >= MIN_KEYWORD_LEN && !STOPWORDS.has(t),
  );
  if (keywords.length === 0) {
    // Item court (ex. "UPA", "BK", "EP") : on exige égalité de TOUS les
    // tokens item dans le set transcript ET états de négation symétriques
    // côté item / côté transcript (A-strict J2).
    return itemTokens.every(
      (t) =>
        transTokens.has(t) &&
        isNegated(t, itemTokens) === isNegated(t, transcriptTokens),
    );
  }
  // J2 A-strict : un keyword matche SSI présent ET états de négation
  // symétriques. `isNegated` côté item travaille sur la séquence
  // itemTokens (typiquement courte) ; côté transcript sur transcriptTokens.
  const matched = keywords.filter(
    (k) =>
      transTokens.has(k) &&
      isNegated(k, itemTokens) === isNegated(k, transcriptTokens),
  );
  return matched.length >= Math.ceil(keywords.length * KEYWORD_THRESHOLD);
}

function extractDiagnostic(text: string): string | null {
  const m = /Diagnostic[^:]+:\s*(.+)$/i.exec(text);
  return m && m[1].trim().length > 0 ? m[1].trim() : null;
}

// ─────────────────────────────────────────────────────────────────────────
// scoringRule parser — 3 modes : count / token / alias-binaire.
//
// Une clause est soit :
//   • count-based  : "3 = 1 pt", "4-6 = 3 pts", "1 = 0.5 pt"
//   • alias-binaire : "Fait = 2 pts", "Pas fait = 0 pt", "± = 1 pt"
//   • token-based  : "Toux = 1 pt" (left ni numérique ni alias)
//
// Si toutes les clauses parsables sont count-based ou alias-binaire →
// mode `count`. Si toutes sont token-based → mode `token`. Si format
// mixte (jamais observé Phase 8), fallback `count` + console.warn.

interface CountStep {
  kind: "count";
  count: number;
  points: number;
}
interface TokenStep {
  kind: "token";
  token: string;
  points: number;
}
type ScoringStep = CountStep | TokenStep;

export interface ParsedScoringRule {
  mode: "count" | "token";
  steps: ScoringStep[];
}

// Set module-level pour dédup des warnings (1 par item).
const warnedItems = new Set<string>();
function warnOnceUnparsable(itemId: string, rule: string): void {
  const key = `${itemId}::${rule}`;
  if (warnedItems.has(key)) return;
  warnedItems.add(key);
  // eslint-disable-next-line no-console
  console.warn(
    `[presentationEvaluator] scoringRule unparsable on item ${itemId}: "${rule}". Clause skipped.`,
  );
}
function warnOnceMixed(itemId: string, rule: string): void {
  const key = `${itemId}::mixed::${rule}`;
  if (warnedItems.has(key)) return;
  warnedItems.add(key);
  // eslint-disable-next-line no-console
  console.warn(
    `[presentationEvaluator] scoringRule mixed mode on item ${itemId}: "${rule}". Token clauses skipped, count kept.`,
  );
}

function parseScoringRule(rule: string, itemId = ""): ParsedScoringRule {
  const clauses = rule
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  const steps: ScoringStep[] = [];
  let unparsable = 0;
  for (const clause of clauses) {
    const m = /^(.+?)\s*=\s*([\d.]+)\s*pt/i.exec(clause);
    if (!m) {
      unparsable++;
      continue;
    }
    const left = m[1].trim();
    const points = Number.parseFloat(m[2]);
    if (!Number.isFinite(points)) {
      unparsable++;
      continue;
    }
    let count: number | null = null;
    if (/^pas fait$/i.test(left)) count = 0;
    else if (/^fait$/i.test(left)) count = 1;
    else if (left === "±") count = 1;
    else {
      const r = /^(\d+)(?:\s*[-–]\s*(\d+))?/.exec(left);
      if (r) {
        const a = Number.parseInt(r[1], 10);
        const b = r[2] !== undefined ? Number.parseInt(r[2], 10) : a;
        count = Math.min(a, b);
      }
    }
    if (count !== null && Number.isFinite(count)) {
      steps.push({ kind: "count", count, points });
    } else {
      // Token-based : `left` est un sous-élément à matcher dans transcript.
      steps.push({ kind: "token", token: left, points });
    }
  }
  if (unparsable > 0 && steps.length === 0 && itemId) {
    warnOnceUnparsable(itemId, rule);
  }
  const countSteps = steps.filter((s) => s.kind === "count").length;
  const tokenSteps = steps.filter((s) => s.kind === "token").length;
  if (tokenSteps > 0 && countSteps === 0) {
    return { mode: "token", steps };
  }
  if (tokenSteps > 0 && countSteps > 0 && itemId) {
    warnOnceMixed(itemId, rule);
  }
  // Mode count : on garde uniquement les count steps (drop tokens si mixte),
  // triés décroissant par count pour appliquer la clause la plus exigeante
  // satisfaite.
  const onlyCount = steps
    .filter((s): s is CountStep => s.kind === "count")
    .sort((a, b) => b.count - a.count);
  return { mode: "count", steps: onlyCount };
}

/**
 * applyScoringRule — calcule (score, max) pour un item binary:F+rule.
 *
 *  Mode `count` :
 *    • Recalibration max : on filtre les clauses dont count > expected
 *      (clauses inatteignables car le candidat ne peut pas mentionner
 *      plus de `expected` sous-éléments listés). Cf. p4/p5/p7
 *      RESCOS-64-P2 : items_attendus=["Tabagisme actif à 35 UPA"]
 *      (1 sous-élément CSV) avec scoringRule "2 éléments = 2 pts,
 *      1 élément = 1 pt" → après filtre, max=1 (clause "1 élément") ;
 *      sinon, max=2 nominal préservé (ex. r2 csv=5 ruleMax=4 → max=3).
 *    • Score = première clause (parmi reachable, triée décroissant) dont
 *      count <= matched.
 *    • Si toutes les clauses sont inatteignables (rare, expected=0) →
 *      max=0, score=0 (item neutre, ne contribue pas à l'axe).
 *
 *  Mode `token` :
 *    • Pas de recalibration ; chaque clause est indépendante.
 *    • Score = somme des points pour chaque token matché dans transcript.
 *    • Max = somme totale des points (ex. p3 "Toux = 1 pt, dyspnée = 1 pt"
 *      → max = 2, atteignable si transcript mentionne les deux tokens).
 *
 * Exemples :
 *   p4 (csv=1 expected=1, rule "2 éléments = 2 pts, 1 élément = 1 pt") :
 *     mode=count, steps=[{count:2,points:2},{count:1,points:1}]
 *     reachable (count<=1) = [{count:1,points:1}]
 *     max=1, matched=1 → score=1
 *
 *   r2 (csv=5 expected=5, rule "4-6 = 3 pts, 2-3 = 1 pt, 0-1 = 0 pt") :
 *     mode=count, steps=[{count:4,points:3},{count:2,points:1},{count:0,points:0}]
 *     reachable (count<=5) = toutes
 *     max=3, matched=5 → score=3
 *
 *   p3 (rule "Toux = 1 pt, dyspnée = 1 pt") :
 *     mode=token, steps=[{token:'Toux',points:1},{token:'dyspnée',points:1}]
 *     transcript "Toux et dyspnée" → matched=[Toux,dyspnée], score=2, max=2
 */
function applyScoringRule(
  parsed: ParsedScoringRule,
  matched: number,
  transcript: string,
  expected: number,
): { score: number; max: number; tokenMatched?: string[] } {
  if (parsed.mode === "token") {
    const tokens = parsed.steps as TokenStep[];
    const max = tokens.reduce((s, t) => s + t.points, 0);
    const tokenMatched: string[] = [];
    let score = 0;
    for (const t of tokens) {
      if (detectMention(t.token, transcript)) {
        score += t.points;
        tokenMatched.push(t.token);
      }
    }
    return { score, max, tokenMatched };
  }
  const counts = parsed.steps as CountStep[];
  const reachable = counts.filter((s) => s.count <= expected);
  if (reachable.length === 0) {
    return { score: 0, max: 0 };
  }
  const max = reachable.reduce((m, s) => Math.max(m, s.points), 0);
  for (const step of reachable) {
    if (matched >= step.count) {
      return { score: step.points, max };
    }
  }
  return { score: 0, max };
}

function isSkipAucun(items: string[]): boolean {
  return items.length === 1 && /^aucun$/i.test(items[0].trim());
}

function scoreItem(
  item: RawGrilleItem,
  transcript: string,
  axis: PresentationAxis,
): PresentationItemReport {
  const baseReport = (
    extra: Partial<PresentationItemReport>,
  ): PresentationItemReport => ({
    id: item.id,
    text: item.text,
    binaryOnly: item.binaryOnly === true,
    scoringRule: item.scoringRule ?? null,
    matched: [],
    expected: 0,
    score: 0,
    max: 0,
    skipped: false,
    ...extra,
  });

  const itemsAttendus = item.items_attendus ?? [];
  const csvSubItems =
    itemsAttendus.length > 0 ? splitCsvItems(itemsAttendus[0]) : [];

  // Cas spécial : "Aucun" → skip silent (Ambiguïté C, option C3).
  if (isSkipAucun(itemsAttendus)) {
    return baseReport({ skipped: true });
  }

  // Cas binaryOnly:true SANS items_attendus (Ambiguïté B, option B1).
  if (item.binaryOnly === true && itemsAttendus.length === 0) {
    if (axis === "raisonnement") {
      const diag = extractDiagnostic(item.text);
      if (diag) {
        const ok = detectMention(diag, transcript);
        return baseReport({
          matched: ok ? [diag] : [],
          expected: 1,
          score: ok ? 1 : 0,
          max: 1,
        });
      }
    }
    // Garde-fou anti-régression future : aucun cas connu Phase 8.
    return baseReport({ skipped: true });
  }

  // Cas binaryOnly:true AVEC items_attendus : token-based match (Phase 10
  // J1 dette 2), 1/0.
  if (item.binaryOnly === true) {
    const target = itemsAttendus[0];
    const ok = detectMention(target, transcript);
    return baseReport({
      matched: ok ? [target] : [],
      expected: 1,
      score: ok ? 1 : 0,
      max: 1,
    });
  }

  // Cas binaryOnly:false AVEC scoringRule : 3 modes.
  if (item.scoringRule) {
    const parsed = parseScoringRule(item.scoringRule, item.id);
    if (parsed.mode === "token") {
      const expected = parsed.steps.length;
      const result = applyScoringRule(parsed, 0, transcript, expected);
      return baseReport({
        matched: result.tokenMatched ?? [],
        expected,
        score: result.score,
        max: result.max,
      });
    }
    // Mode count : split CSV → count → apply rule (avec recalibration max).
    const matchedSubItems = csvSubItems.filter((sub) =>
      detectMention(sub, transcript),
    );
    const result = applyScoringRule(
      parsed,
      matchedSubItems.length,
      transcript,
      csvSubItems.length,
    );
    return baseReport({
      matched: matchedSubItems,
      expected: csvSubItems.length,
      score: result.score,
      max: result.max,
    });
  }

  // Cas binaryOnly:false SANS scoringRule (Ambiguïté A, option β).
  const matchedSubItems = csvSubItems.filter((sub) =>
    detectMention(sub, transcript),
  );
  const expected = csvSubItems.length;
  const score = expected > 0 ? matchedSubItems.length / expected : 0;
  return baseReport({
    matched: matchedSubItems,
    expected,
    score,
    max: 1,
  });
}

function aggregateAxis(
  axisName: PresentationAxis,
  items: PresentationItemReport[],
): PresentationAxisReport {
  const live = items.filter((i) => !i.skipped);
  const score = live.reduce((s, i) => s + i.score, 0);
  const max = live.reduce((s, i) => s + i.max, 0);
  const normalized = max > 0 ? Math.min(1, Math.max(0, score / max)) : 0;
  return { axis: axisName, items, score, max, normalized };
}

// ─────────────────────────────────────────────────────────────────────────
// API publique

export interface EvaluatePresentationArgs {
  stationId: string;
  transcript: string;
}

export async function evaluatePresentation(
  args: EvaluatePresentationArgs,
): Promise<PresentationEvaluation> {
  const meta = getStationMeta(args.stationId);
  if (!meta) throw new PresentationEvaluatorStationNotFoundError(args.stationId);
  if (!meta.parentStationId) {
    throw new PresentationEvaluatorNotPart2Error(args.stationId);
  }
  const evaluatorStation = await getEvaluatorStation(args.stationId);
  const grille = (evaluatorStation as { grille?: RawGrille }).grille;
  if (!grille) {
    throw new PresentationEvaluatorMissingGrilleError(args.stationId);
  }
  const transcript = args.transcript ?? "";

  const axes: Record<PresentationAxis, PresentationAxisReport> = {} as Record<
    PresentationAxis,
    PresentationAxisReport
  >;
  for (const axis of PRESENTATION_AXES) {
    const items = (grille[axis] ?? []).map((item) =>
      scoreItem(item, transcript, axis),
    );
    axes[axis] = aggregateAxis(axis, items);
  }

  let weighted = 0;
  for (const axis of PRESENTATION_AXES) {
    weighted += axes[axis].normalized * PRESENTATION_WEIGHTS[axis];
  }
  const weightedScore = Math.round(weighted * 100 * 100) / 100;

  return {
    stationId: args.stationId,
    parentStationId: meta.parentStationId,
    axes,
    weights: { ...PRESENTATION_WEIGHTS },
    weightedScore,
  };
}

export const __test__ = {
  normalizeText,
  splitCsvItems,
  detectMention,
  extractDiagnostic,
  parseScoringRule,
  applyScoringRule,
  isSkipAucun,
  scoreItem,
  aggregateAxis,
  STOPWORDS,
  KEYWORD_THRESHOLD,
  // Phase 10 J1 — dette 2 : tokenize exposé pour tests unitaires
  // (déterministe, idempotence, ponctuation, accents, chiffres).
  tokenize,
  MIN_KEYWORD_LEN,
  // Phase 10 J2 — dette 3 : helpers détection négation A-strict.
  // Constantes immuables (Set readonly de fait) + helpers positionnels
  // pour tests unitaires + tests de non-régression detectMention.
  NEGATION_MARKERS,
  NEGATION_WINDOW_SIZE,
  findKeywordPositions,
  isNegated,
  // Permet aux tests de re-set le set de dédup warnings entre tests.
  resetWarnings: () => warnedItems.clear(),
};
