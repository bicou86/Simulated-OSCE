// Service Examinateur — déterministe, pas de LLM.
// Lit `examen_resultats` de la station patient et renvoie le finding
// correspondant à la demande du candidat. Si aucun finding ne matche, renvoie
// un fallback neutre plutôt que laisser le LLM patient improviser.

import { getPatientStation, StationNotFoundError } from "./patientService";

export { StationNotFoundError };

// ─────────── Shape interne : un finding aplati ───────────
// `examen_resultats` accepte deux formes par catégorie :
//   { examen: "Examen abdominal", details: [{ item: "...", resultat: "..." }, ...] }
//   { examen: "Signe de Murphy", resultat: "..." }
// On aplatit en une liste de findings uniforme pour le matching.

interface FlatFinding {
  categoryKey: string;     // "e5", "e6", ...
  categoryName: string;    // "Examen abdominal", "Signe de Murphy"
  maneuver: string;        // "Palpation de l'abdomen" ou categoryName si pas de détail
  resultat: string | null; // texte du finding, ou null si non renseigné (hygiène…)
  // Phase 3 — un finding peut porter une image médicale (ECG, radio, photo,
  // fond d'œil, écho, …) en complément du texte. L'URL pointe vers un fichier
  // sous `public/medical-images/<station-id>/`, licence CC-BY ou CC0
  // uniquement, attribution dans ATTRIBUTIONS.md par station. Pas de
  // génération LLM — images figées dans le repo.
  resultatType?: "text" | "image";
  resultatUrl?: string;
  resultatCaption?: string;
}

function extractImageFields(
  source: { resultat_type?: unknown; resultat_url?: unknown; resultat_caption?: unknown },
): Pick<FlatFinding, "resultatType" | "resultatUrl" | "resultatCaption"> {
  const out: Pick<FlatFinding, "resultatType" | "resultatUrl" | "resultatCaption"> = {};
  if (source.resultat_type === "image") out.resultatType = "image";
  if (typeof source.resultat_url === "string" && source.resultat_url.length > 0) {
    out.resultatUrl = source.resultat_url;
  }
  if (typeof source.resultat_caption === "string" && source.resultat_caption.length > 0) {
    out.resultatCaption = source.resultat_caption;
  }
  // Promouvoir resultatType à "image" si URL présente sans type explicite —
  // commodité pour les stations qui ne porteraient que `resultat_url`.
  if (out.resultatUrl && !out.resultatType) out.resultatType = "image";
  return out;
}

export function flattenExamenResultats(block: unknown): FlatFinding[] {
  if (!block || typeof block !== "object") return [];
  const out: FlatFinding[] = [];
  for (const [key, rawCat] of Object.entries(block as Record<string, unknown>)) {
    if (!rawCat || typeof rawCat !== "object") continue;
    const cat = rawCat as {
      examen?: string;
      resultat?: string | null;
      resultat_type?: unknown;
      resultat_url?: unknown;
      resultat_caption?: unknown;
      details?: unknown;
    };
    const categoryName = typeof cat.examen === "string" ? cat.examen : key;
    const hasDetails = Array.isArray(cat.details) && cat.details.length > 0;
    const catImageFields = extractImageFields(cat);
    // Une catégorie peut porter à la fois un résumé (resultat) ET des items
    // détaillés (details). Ex. German-2 e3 = "Otoscopie bilatérale" avec
    // resultat="Normale des deux côtés" + 4 détails à resultat null.
    // On émet alors le résumé comme finding catégorie-niveau en plus des
    // détails — sans quoi une requête générique ("otoscopie") ne matcherait
    // qu'un item à null et retomberait sur no_resultat.
    if (typeof cat.resultat === "string") {
      out.push({
        categoryKey: key,
        categoryName,
        maneuver: categoryName,
        resultat: cat.resultat,
        ...catImageFields,
      });
    }
    if (hasDetails) {
      for (const d of cat.details as unknown[]) {
        if (!d || typeof d !== "object") continue;
        const detail = d as {
          item?: string;
          resultat?: string | null;
          resultat_type?: unknown;
          resultat_url?: unknown;
          resultat_caption?: unknown;
        };
        out.push({
          categoryKey: key,
          categoryName,
          maneuver: typeof detail.item === "string" ? detail.item : categoryName,
          resultat: typeof detail.resultat === "string" ? detail.resultat : null,
          ...extractImageFields(detail),
        });
      }
    } else if (typeof cat.resultat !== "string") {
      // Ni détails ni résumé texte → on émet un finding "manœuvre reconnue,
      // pas de finding" pour que la requête soit au moins matchable. On garde
      // les champs image éventuels (ex. photo sans texte associé).
      out.push({
        categoryKey: key,
        categoryName,
        maneuver: categoryName,
        resultat: null,
        ...catImageFields,
      });
    }
  }
  return out;
}

// ─────────── Tokenisation / scoring ───────────

const STOPWORDS = new Set([
  "le", "la", "les", "l", "un", "une", "des", "de", "du", "d", "au", "aux",
  "a", "et", "ou", "en", "sur", "sous", "dans", "par", "pour", "avec",
  "je", "j", "tu", "il", "elle", "on", "nous", "vous", "me", "te", "se",
  "son", "sa", "ses", "mon", "ma", "mes", "ton", "ta", "tes",
  "ce", "cet", "cette", "ces", "qui", "que", "quel", "quelle", "quels", "quelles",
  "est", "etait", "etaient",
  "examen", "examine", "recherche", "realise", "effectue", "fais", "faire",
]);

function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/œ/g, "oe")
    .replace(/æ/g, "ae")
    .normalize("NFD")
    // Combining diacritics block U+0300–U+036F (équivalent \p{Diacritic} sans /u).
    .replace(/[̀-ͯ]/g, "");
}

export function tokenize(s: string): string[] {
  return normalize(s)
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 3 && !STOPWORDS.has(t));
}

// Score un finding vs la requête : nombre de tokens de la requête présents dans
// le nom de catégorie + la manœuvre (matching exact de substring pour tolérer
// les variantes morphologiques minimales — "palpe" ↔ "palpation").
function scoreFinding(queryTokens: string[], finding: FlatFinding): number {
  const haystack = normalize(`${finding.categoryName} ${finding.maneuver}`);
  let score = 0;
  for (const tok of queryTokens) {
    // Racine courte : "palp" match "palpe" et "palpation". "ausc" match
    // "auscultation". On prend les 4 premiers caractères comme racine quand
    // le token est long, sinon le token complet.
    const root = tok.length >= 5 ? tok.slice(0, 4) : tok;
    if (haystack.includes(root)) score += 1;
  }
  return score;
}

// ─────────── Détection cadre téléconsultation (Bug #3) ───────────
// Les stations dont le `setting` (ou la description) mentionne un cadre distant
// ne permettent aucun examen physique — on renvoie un fallback dédié plutôt
// qu'un generic no_match qui laisserait penser au candidat que le geste est
// défaillant côté service.
const TELECONSULT_RE = /\b(?:telephoniques?|teleconsultations?|telemedecines?|appel|visio)\b/;

export function isTeleconsultStation(station: {
  setting?: unknown;
  patient_description?: unknown;
}): boolean {
  const setting = typeof station.setting === "string" ? normalize(station.setting) : "";
  const desc = typeof station.patient_description === "string"
    ? normalize(station.patient_description)
    : "";
  return TELECONSULT_RE.test(setting) || TELECONSULT_RE.test(desc);
}

// ─────────── Titre-comme-résultat (Bug #1) ───────────
// Quand l'item de la grille a `resultat: null` mais que le *titre* contient un
// verbe ou adjectif clinique objectivable, le titre est le finding. On renvoie
// alors le titre comme texte plutôt que de tomber sur no_resultat.
// La liste reste volontairement restreinte pour éviter qu'un label neutre
// ("Auscultation cardiaque", "Palpation mastoïdienne") soit traité comme un
// finding : seuls les mots qui décrivent un état clinique observable comptent.
const CLINICAL_VERB_RE =
  /\b(?:limit(?:e|ee|es|ees|ation|ations)?|positifs?|positives?|negatifs?|negatives?|presente?s?|absente?s?|douloureux|douloureuse|douloureuses|reduits?|reduites?|augmentes?|augmentees?|normale?s?|anormale?s?|diminuee?s?|pas\s+de|douleurs?|rougeurs?|chaleur|oedemes?|eruptions?|saignements?)\b/;

export function titleLooksLikeFinding(title: string): boolean {
  return CLINICAL_VERB_RE.test(normalize(title));
}

// ─────────── Détection requête d'imagerie (Phase 3) ───────────
// Si le candidat demande une image (ECG, radio, écho, scanner, IRM, fond
// d'œil, otoscopie, photo dermato), on veut retourner soit l'image si la
// station en contient une (via `resultat_type: "image"`), soit un fallback
// dédié `no_imaging` — symétrique du `no_resultat`/`no_teleconsult` —
// plutôt qu'un `no_match` générique qui laisserait le candidat perplexe.
// Combinaison de 3 groupes :
//  (a) stems longs en prefix-match (radiograph → radiographie/-ier/-ique) ;
//  (b) mots courts ambigus ("radio" seul) matchés UNIQUEMENT quand suivis
//      d'un qualifieur médical, pour éviter "la radio à la maison" ;
//  (c) acronymes exacts avec boundary droite (rx, ecg, irm, tdm, scanner).
const IMAGING_REQUEST_RE = new RegExp([
  // (a) stems longs
  "\\b(?:radiograph|radioscop|cliche|echograph|echocardiogr|retinograph|imagerie|electrocardiogr|photographie|fond\\s+d'?(?:oe|e)il|photo\\s+(?:clinique|dermato|cutan))",
  // (b) "radio" / "echo" isolés + qualifieur médical
  "\\bradio\\s+(?:thorax|thoracique|pulmonaire|abdominale|du\\s+thorax|des\\s+poumons|des\\s+membres)",
  "\\becho\\s+(?:abdominale|abdominopelvien|cardiaque|pelvienne|obstetricale|doppler)",
  // (c) acronymes
  "\\b(?:rx|ecg|ekg|tdm|irm|scanner)\\b",
].join("|"));

export function queryAsksForImage(query: string): boolean {
  return IMAGING_REQUEST_RE.test(normalize(query));
}

// ─────────── Multi-manœuvres dans une seule phrase (Bug #2) ───────────
// Certaines requêtes énumèrent plusieurs gestes ("je fais une otoscopie, puis
// les tests de Rinne et Weber"). On segmente sur les connecteurs usuels et on
// matche chaque segment indépendamment. Flag env `MULTI_GESTURE_LOOKUP=false`
// pour rollback si le splitter s'avère trop agressif en prod.
const MULTI_GESTURE_ENABLED = process.env.MULTI_GESTURE_LOOKUP !== "false";

// Connecteurs : " puis ", " ensuite ", " apres " (accents déjà supprimés par
// normalize), " et ". On exige des espaces autour des mots pour éviter de
// split "etat", "puisque", etc. On normalise tous les connecteurs mot vers
// une virgule avant de splitter, sinon le comma de ", puis " consomme l'espace
// requis par \s+puis\s+ et on manque le second split.
const WORD_CONNECTOR_RE = /\s+(?:puis|ensuite|apres|et)\s+/g;

export function splitMultiGestures(raw: string): string[] {
  return normalize(raw)
    .replace(WORD_CONNECTOR_RE, ",")
    .split(",")
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
}

// ─────────── API ───────────

export type ExaminerLookupKind =
  | "finding"        // finding unique, resultat disponible (text OR image)
  | "findings"       // 2+ findings agrégés dans une même bulle
  | "no_resultat"    // manœuvre reconnue, pas de finding à rapporter
  | "no_match"       // aucune manœuvre reconnue dans la grille
  | "no_teleconsult" // cadre téléconsultation — examen physique impossible
  | "no_imaging";    // Phase 3 — imagerie demandée mais absente de la grille

export interface ExaminerLookupItem {
  categoryKey: string;
  categoryName: string;
  maneuver: string;
  resultat: string;
  source?: "title_as_result";
  resultatType?: "text" | "image";
  resultatUrl?: string;
  resultatCaption?: string;
}

export interface ExaminerLookupResult {
  match: boolean;
  kind: ExaminerLookupKind;
  stationId: string;
  query: string;
  categoryKey?: string;
  categoryName?: string;
  maneuver?: string;
  resultat?: string;
  source?: "title_as_result";
  resultatType?: "text" | "image";
  resultatUrl?: string;
  resultatCaption?: string;
  items?: ExaminerLookupItem[];
  fallback?: string;
}

interface SegmentMatch {
  finding: FlatFinding;
  kind: "finding" | "no_resultat";
  text?: string;
  source?: "title_as_result";
}

const FALLBACK_NO_MATCH =
  "Finding non disponible pour cette station — passez à l'examen suivant ou consultez l'examinateur.";
const FALLBACK_NO_RESULTAT =
  "Manœuvre notée, pas de finding clinique spécifique à rapporter.";
const FALLBACK_TELECONSULT =
  "Examen physique impossible en téléconsultation. Reformulez en question au parent/patient ou demandez une consultation en présentiel.";
const FALLBACK_NO_IMAGING =
  "Imagerie non disponible sur cette station. Évaluez la pertinence de l'examen demandé ; orientez en présentiel si nécessaire.";

const MIN_SCORE = 1;
const MAX_FINDINGS = 4;

function matchSegment(
  segment: string,
  findings: FlatFinding[],
): SegmentMatch | null {
  const queryTokens = tokenize(segment);
  if (queryTokens.length === 0) return null;

  let best: { finding: FlatFinding; score: number } | null = null;
  for (const f of findings) {
    const score = scoreFinding(queryTokens, f);
    if (score >= MIN_SCORE && (!best || score > best.score)) {
      best = { finding: f, score };
    }
  }
  if (!best) return null;

  if (best.finding.resultat) {
    return { finding: best.finding, kind: "finding", text: best.finding.resultat };
  }
  if (titleLooksLikeFinding(best.finding.maneuver)) {
    return {
      finding: best.finding,
      kind: "finding",
      text: best.finding.maneuver,
      source: "title_as_result",
    };
  }
  return { finding: best.finding, kind: "no_resultat" };
}

export async function lookupExaminer(
  stationId: string,
  query: string,
): Promise<ExaminerLookupResult> {
  const station = await getPatientStation(stationId);

  // Bug #3 : cadre téléconsultation → examen physique impossible. La route
  // n'est appelée que si le front a classé la requête comme geste ; on peut
  // donc court-circuiter avant même le lookup.
  if (isTeleconsultStation(station)) {
    return {
      match: false,
      kind: "no_teleconsult",
      stationId,
      query,
      fallback: FALLBACK_TELECONSULT,
    };
  }

  const findings = flattenExamenResultats(station.examen_resultats);
  if (findings.length === 0) {
    return {
      match: false,
      kind: "no_match",
      stationId,
      query,
      fallback: FALLBACK_NO_MATCH,
    };
  }

  // Bug #2 : on splitte la requête sur connecteurs. Si le flag est off, on
  // garde la requête brute comme segment unique — comportement pré-1.5.
  const segments = MULTI_GESTURE_ENABLED ? splitMultiGestures(query) : [query];
  const effectiveSegments = segments.length > 0 ? segments : [query];

  const matches: SegmentMatch[] = [];
  const seen = new Set<string>();
  for (const seg of effectiveSegments) {
    const m = matchSegment(seg, findings);
    if (!m) continue;
    const key = `${m.finding.categoryKey}::${m.finding.maneuver}`;
    if (seen.has(key)) continue;
    seen.add(key);
    matches.push(m);
    if (matches.length >= MAX_FINDINGS) break;
  }

  if (matches.length === 0) {
    // Phase 3 amendement 1 : si la requête mentionnait une imagerie et qu'on
    // ne trouve pas d'item correspondant, on renvoie `no_imaging` plutôt que
    // `no_match` générique. Symétrique du futur `no_labs`.
    if (queryAsksForImage(query)) {
      return {
        match: false,
        kind: "no_imaging",
        stationId,
        query,
        fallback: FALLBACK_NO_IMAGING,
      };
    }
    return {
      match: false,
      kind: "no_match",
      stationId,
      query,
      fallback: FALLBACK_NO_MATCH,
    };
  }

  // Si 0 ou 1 matches ont un texte à rapporter, on reste en mode bulle simple
  // (comportement compatible avec la Phase 1.2). On privilégie le premier
  // match texté ; sinon, on tombe sur no_resultat avec la première manœuvre.
  const withText = matches.filter((m) => m.kind === "finding" && m.text);

  if (withText.length <= 1) {
    const m = withText[0] ?? matches[0];
    if (m.kind === "no_resultat") {
      return {
        match: true,
        kind: "no_resultat",
        stationId,
        query,
        categoryKey: m.finding.categoryKey,
        categoryName: m.finding.categoryName,
        maneuver: m.finding.maneuver,
        fallback: FALLBACK_NO_RESULTAT,
      };
    }
    return {
      match: true,
      kind: "finding",
      stationId,
      query,
      categoryKey: m.finding.categoryKey,
      categoryName: m.finding.categoryName,
      maneuver: m.finding.maneuver,
      resultat: m.text,
      source: m.source,
      // Phase 3 — propage les champs image éventuels (ECG, radio, photo, …).
      ...(m.finding.resultatType ? { resultatType: m.finding.resultatType } : {}),
      ...(m.finding.resultatUrl ? { resultatUrl: m.finding.resultatUrl } : {}),
      ...(m.finding.resultatCaption ? { resultatCaption: m.finding.resultatCaption } : {}),
    };
  }

  // ≥ 2 findings texto : on renvoie un payload agrégé ; le front affiche
  // une seule bulle examinateur avec la liste à puces. Chaque item peut
  // porter ses propres champs image (un ECG + un résumé texte côte à côte).
  return {
    match: true,
    kind: "findings",
    stationId,
    query,
    items: withText.map((m) => ({
      categoryKey: m.finding.categoryKey,
      categoryName: m.finding.categoryName,
      maneuver: m.finding.maneuver,
      resultat: m.text!,
      source: m.source,
      ...(m.finding.resultatType ? { resultatType: m.finding.resultatType } : {}),
      ...(m.finding.resultatUrl ? { resultatUrl: m.finding.resultatUrl } : {}),
      ...(m.finding.resultatCaption ? { resultatCaption: m.finding.resultatCaption } : {}),
    })),
  };
}
