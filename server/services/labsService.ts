// Service Laboratoire — déterministe, pas de LLM.
// Phase 3 J2 : lit `examens_complementaires[lab_key]` de la station patient,
// fusionne avec la définition statique du lab (shared/lab-definitions.ts),
// et renvoie un résultat structuré (paramètres + flags + interprétation).
//
// Symétrique à `examinerService.ts` pour les images, avec deux différences :
//  - les normes et métadonnées des paramètres sont figées dans LAB_DEFINITIONS
//    (pas dans la station) ; la station ne fournit que les valeurs ;
//  - plusieurs labs peuvent être demandés dans la même phrase ("NFS + CRP"),
//    on splitte et on agrège comme pour les multi-gestes.
//
// Priorité des fallbacks : no_teleconsult > no_labs > no_match.

import {
  LAB_DEFINITIONS,
  LAB_KEYS,
  computeFlag,
  getLabDefinition,
  pickRangeForAge,
  type LabDefinition,
  type LabFlag,
  type LabParameterDefinition,
} from "@shared/lab-definitions";

import {
  getPatientStation,
  StationNotFoundError,
} from "./patientService";
import { isTeleconsultStation } from "./examinerService";

export { StationNotFoundError };

// ─────────── Types de retour (shape d'API) ───────────

export interface LabResolvedParameter {
  key: string;
  label: string;
  value: number | string;
  unit: string;
  flag: LabFlag;
  // Range effectif utilisé pour calculer le flag. `source` indique si on a
  // pioché dans normalRange (adult) ou dans pediatricRange (pédiatrique).
  normalRange: { min: number; max: number; source: "adult" | "pediatric" };
  criticalLow?: number;
  criticalHigh?: number;
  sourceRef?: string;   // référence clinique (Harrison, AMBOSS, etc.)
  note?: string;
}

export interface LabResolvedResult {
  key: string;
  label: string;
  parameters: LabResolvedParameter[];
  interpretation?: string;
}

export type LabsLookupKind =
  | "labs"            // 1+ labs résolus
  | "no_match"        // aucun lab dans LAB_DEFINITIONS n'a matché la requête
  | "no_labs"         // lab reconnu mais station n'a pas d'`examens_complementaires`
  | "no_teleconsult"; // cadre téléconsultation — labs non disponibles

export interface LabsLookupResult {
  match: boolean;
  kind: LabsLookupKind;
  stationId: string;
  query: string;
  results?: LabResolvedResult[];
  fallback?: string;
  // Pour debug / traçabilité : les clés de labs détectées dans la requête,
  // même si aucune n'était présente sur la station.
  requestedLabKeys?: string[];
}

// ─────────── Fallbacks ───────────

const FALLBACK_TELECONSULT =
  "Examens complémentaires non réalisables en téléconsultation. " +
  "Demandez au patient d'apporter ses dernières analyses ou orientez en présentiel pour bilan.";

const FALLBACK_NO_LABS =
  "Analyses non disponibles sur cette station. Reformulez ou orientez autrement.";

const FALLBACK_NO_MATCH =
  "Aucun examen de laboratoire reconnu dans la requête. Reformulez avec le nom du bilan (ex. NFS, CRP, ionogramme).";

// ─────────── Normalisation + matching ───────────

// Normalisation locale : on supprime les accents, on lowercase, on déplie les
// ligatures œ/æ, et on remplace la lettre grecque β (U+03B2) par "beta " (avec
// espace) pour que "βhcg" / "bhcg" / "beta hcg" se résolvent tous à la clé
// `bhcg`. L'espace post-β est ensuite normalisé (les multiples espaces sont
// collapsés par le regex \s+ des keywords).
function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/β\s*/g, "beta ")
    .replace(/œ/g, "oe")
    .replace(/æ/g, "ae")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/['']/g, "'")
    .replace(/\s+/g, " ");
}

// Détection "requête labs" : utilisée pour décider si le front doit router
// vers `/api/examiner/labs` plutôt que `/api/examiner/lookup`. Combinaison de
// verbes actifs + mots-clés lab issus du catalogue.
//
// ECOS invariant : faux-positifs acceptables (on tombera sur no_match si la
// station n'a pas le lab), faux-négatifs inacceptables (on ne doit pas
// re-router vers le LLM patient qui inventerait).

const LABS_REQUEST_VERBS_RE =
  /\b(?:je\s+demande|j'?\s*ai\s+demande|je\s+prescris|je\s+fais|je\s+realise|je\s+commande|je\s+propose|demander|prescrire|realiser|faire|commander|faites|prescrivez|realisez|commandez)\b/;

// Garde anti-faux-positif : les mentions passives "avez-vous déjà fait une
// NFS ?" ou "vos dernières analyses" sont des questions d'anamnèse, pas des
// demandes actives. On garde la même logique que le router intent côté client
// pour rester cohérent.
const LABS_PASSIVE_ANAMNESIS_RE =
  /\b(?:avez-?\s*vous\s+(?:deja|eu|d[eé]j[aà])|as-?\s*tu\s+(?:deja|d[eé]j[aà])|vos\s+(?:dernier|derniere|derniers|dernieres)|quand\s+avez-?\s*vous|a-?\s*t[-\s]?(?:il|elle)\s+eu)\b/;

// Reconstruit le regex à partir des keywords de la table — si on ajoute un lab
// dans LAB_DEFINITIONS, le regex se met à jour automatiquement. On trie par
// longueur décroissante pour que "bilan hepatique" gagne sur "bilan" si on
// ajoutait un jour une entrée "bilan" seule.
function buildLabsKeywordRegex(): RegExp {
  const all: string[] = [];
  for (const def of Object.values(LAB_DEFINITIONS)) {
    for (const kw of def.keywords) {
      const norm = normalize(kw);
      all.push(norm.replace(/\s+/g, "\\s+"));
    }
  }
  all.sort((a, b) => b.length - a.length);
  return new RegExp("\\b(?:" + all.join("|") + ")\\b");
}
const LABS_KEYWORD_RE = buildLabsKeywordRegex();

export function queryAsksForLabs(query: string): boolean {
  const text = normalize(query);
  if (LABS_PASSIVE_ANAMNESIS_RE.test(text)) return false;
  if (!LABS_KEYWORD_RE.test(text)) return false;
  return LABS_REQUEST_VERBS_RE.test(text) || /\b(?:un|une|des)\s+/.test(text);
}

// Retourne les clés de labs mentionnées dans la requête (ordre d'apparition).
// Duplicats supprimés.
export function matchLabKeys(query: string): string[] {
  const text = normalize(query);
  const hits: Array<{ key: string; index: number }> = [];
  for (const def of Object.values(LAB_DEFINITIONS)) {
    for (const kw of def.keywords) {
      const norm = normalize(kw);
      const rx = new RegExp("\\b" + norm.replace(/\s+/g, "\\s+") + "\\b");
      const m = rx.exec(text);
      if (m && m.index >= 0) {
        hits.push({ key: def.key, index: m.index });
        break; // un seul hit par lab suffit
      }
    }
  }
  hits.sort((a, b) => a.index - b.index);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const h of hits) {
    if (seen.has(h.key)) continue;
    seen.add(h.key);
    out.push(h.key);
  }
  return out;
}

// ─────────── Age parsing ───────────
// Parse l'âge du patient depuis la station. Deux sources :
//  1. champ explicite `patient_age_years` (numérique, optionnel, ajouté J2) ;
//  2. extraction depuis `patient_description` via regex pragmatique
//     ("Enfant de 2 ans", "Fillette de 2 ans", "Homme de 45 ans", ...).
// Retourne null si aucune source n'est exploitable — on retombe alors sur
// les normes adulte par défaut.

const AGE_RE = /\b(\d{1,3})\s*(ans|an|mois)\b/;

export function parsePatientAge(station: {
  patient_age_years?: unknown;
  patient_description?: unknown;
}): number | null {
  if (typeof station.patient_age_years === "number" && station.patient_age_years >= 0) {
    return station.patient_age_years;
  }
  if (typeof station.patient_description === "string") {
    const m = AGE_RE.exec(normalize(station.patient_description));
    if (m) {
      const val = parseInt(m[1], 10);
      // Si l'unité est "mois", on convertit en fraction d'année.
      if (m[2] === "mois") return val / 12;
      return val;
    }
  }
  return null;
}

// ─────────── Résolution d'un lab ───────────
// Fusionne la définition statique (LAB_DEFINITIONS[key]) avec les valeurs
// fournies dans `station.examens_complementaires[key]`. Calcule les flags
// en utilisant l'âge du patient pour piocher la bonne plage (adulte/péd).
//
// Station JSON shape attendue :
//   "examens_complementaires": {
//     "nfs": {
//       "parameters": {
//         "hb":         { "value": 12.5 },
//         "gb":         { "value": 18, "flag": "critical" },  // override optionnel
//         "plaquettes": { "value": 250 }
//       },
//       "interpretation": "Formule sanguine..."
//     }
//   }

interface StationLabParameterInput {
  value: number | string;
  // Override explicite du flag (rare — utilisé quand la clinique impose un
  // flag différent du pur calcul sur la valeur, ex. troponine hs à 8 ng/L
  // considérée non significative mais critique en contexte).
  flag?: LabFlag;
}

interface StationLabInput {
  parameters?: Record<string, StationLabParameterInput | number | string>;
  interpretation?: string;
}

function coerceParamInput(
  raw: StationLabParameterInput | number | string | undefined,
): { value: number | string; flag?: LabFlag } | null {
  if (raw == null) return null;
  if (typeof raw === "number" || typeof raw === "string") {
    return { value: raw };
  }
  if (typeof raw === "object" && "value" in raw) {
    return { value: raw.value, flag: raw.flag };
  }
  return null;
}

export function resolveLabResult(
  def: LabDefinition,
  stationLab: StationLabInput | null,
  ageYears: number | null,
): LabResolvedResult {
  const params: LabResolvedParameter[] = [];
  const stationParams = stationLab?.parameters ?? {};
  for (const paramDef of def.parameters) {
    const raw = coerceParamInput(
      stationParams[paramDef.key] as StationLabParameterInput | number | string | undefined,
    );
    if (!raw) continue; // station ne fournit pas ce paramètre → on l'omet
    const range = pickRangeForAge(paramDef, ageYears);
    const flag = raw.flag
      ?? (typeof raw.value === "number" ? computeFlag(paramDef, raw.value, ageYears) : "normal");
    params.push({
      key: paramDef.key,
      label: paramDef.label,
      value: raw.value,
      unit: paramDef.unit,
      flag,
      normalRange: range,
      ...(paramDef.criticalLow !== undefined ? { criticalLow: paramDef.criticalLow } : {}),
      ...(paramDef.criticalHigh !== undefined ? { criticalHigh: paramDef.criticalHigh } : {}),
      ...(paramDef.source ? { sourceRef: paramDef.source } : {}),
      ...(paramDef.note ? { note: paramDef.note } : {}),
    });
  }
  return {
    key: def.key,
    label: def.label,
    parameters: params,
    ...(stationLab?.interpretation ? { interpretation: stationLab.interpretation } : {}),
  };
}

// ─────────── Lookup principal ───────────

const MAX_LABS_PER_QUERY = 6;

export async function lookupLabs(
  stationId: string,
  query: string,
): Promise<LabsLookupResult> {
  const station = await getPatientStation(stationId);

  // Priorité n°1 : téléconsultation → pas de labs réalisables sur place.
  if (isTeleconsultStation(station as { setting?: unknown; patient_description?: unknown })) {
    return {
      match: false,
      kind: "no_teleconsult",
      stationId,
      query,
      fallback: FALLBACK_TELECONSULT,
    };
  }

  const requestedKeys = matchLabKeys(query);

  // Si aucun mot-clé lab n'a été reconnu, on est dans le cas "pas de lookup
  // possible" → no_match.
  if (requestedKeys.length === 0) {
    return {
      match: false,
      kind: "no_match",
      stationId,
      query,
      fallback: FALLBACK_NO_MATCH,
    };
  }

  const stationLabs = (station as {
    examens_complementaires?: Record<string, StationLabInput>;
  }).examens_complementaires ?? null;

  // Priorité n°2 : si la station n'a aucun bloc `examens_complementaires`,
  // ou ne contient aucun des labs demandés, on renvoie no_labs.
  const ageYears = parsePatientAge(station as {
    patient_age_years?: unknown;
    patient_description?: unknown;
  });

  const results: LabResolvedResult[] = [];
  for (const key of requestedKeys.slice(0, MAX_LABS_PER_QUERY)) {
    const def = getLabDefinition(key);
    if (!def) continue;
    const stationLab = stationLabs?.[key] ?? null;
    if (!stationLab) continue; // station n'a pas ce lab → on skip
    results.push(resolveLabResult(def, stationLab, ageYears));
  }

  if (results.length === 0) {
    return {
      match: false,
      kind: "no_labs",
      stationId,
      query,
      requestedLabKeys: requestedKeys,
      fallback: FALLBACK_NO_LABS,
    };
  }

  return {
    match: true,
    kind: "labs",
    stationId,
    query,
    results,
    requestedLabKeys: requestedKeys,
  };
}

// ─────────── Introspection ───────────
// Utilisé par les tests + éventuellement par une future page "catalog" UI.

export function listLabKeys(): readonly string[] {
  return LAB_KEYS;
}
