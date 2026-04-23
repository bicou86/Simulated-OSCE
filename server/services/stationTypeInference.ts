// Inférence déterministe du `station_type` à partir des métadonnées d'une
// station. Aucune passe LLM — ni à runtime, ni offline. 6 règles appliquées
// dans l'ordre, première match gagne. Voir `project_phase2_scope.md` en
// mémoire persistante pour l'ordre et la motivation.

import type { StationMeta, StationSource } from "./stationsService";

export type StationType =
  | "teleconsultation"
  | "pediatrie_accompagnant"
  | "bbn"
  | "psy"
  | "triage"
  | "anamnese_examen";

export interface StationTypeInference {
  type: StationType;
  matchedRule: string;
}

function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/œ/g, "oe")
    .replace(/æ/g, "ae")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

// Les regex utilisent un `\b` d'ancrage à gauche. L'ancrage droit dépend du
// terme : les stems médicaux qui admettent des suffixes ("psychiatrique",
// "dépressif", "urgence(s)", "pronostique") sont en prefix-match (pas de
// `\b` final) ; les mots courts qui ont des collisions avec du français
// usuel ("visio" vs "**visio**n", "appel" vs "**appel**é") exigent un
// word-boundary droit.
const TELECONSULT_RE = /\b(?:telephon|teleconsult|telemedecin|appel\b|visio\b|visioconf)/;
const BBN_SETTING_RE = /\b(?:annonce|mauvaise\s+nouvelle|diagnostic\s+grave|deces|pronostic|deuil)/;
const PSY_RE = /\b(?:psychiatr|depress|anxi|suicid|humeur|psychos|addict|phobi|boulimi|anorexi|bipolair)/;
const TRIAGE_SETTING_RE = /\b(?:urgence|triage|\bsau\b|smur)/;
const CAREGIVER_MENTION_RE = /\b(?:mere|pere|parent|accompagnant)/;

// Entrée logique minimale pour l'inférence. On découple de la shape réelle
// pour que les tests puissent fabriquer des entrées sans passer par le
// catalogue complet. `patientDescription` et `age` sont extraits ailleurs.
export interface StationTypeInput {
  id: string;        // shortId + titre concaténé si dispo — matché pour "BBN"
  fullId?: string;   // "RESCOS-7 - BBN - Anévrisme" ; matché prioritairement
  title?: string;
  source: StationSource;
  setting: string;
  patientDescription: string;
  age?: number;
  interlocutorType?: "self" | "parent";
  specialite?: string; // champ optionnel du JSON station si présent
}

export function inferStationType(input: StationTypeInput): StationTypeInference {
  const settingN = normalize(input.setting ?? "");
  const descN = normalize(input.patientDescription ?? "");
  const idN = normalize([input.fullId, input.id, input.title].filter(Boolean).join(" "));
  const specN = normalize(input.specialite ?? "");

  // Règle 1 — téléconsultation (ordre : elle prime sur pédiatrie, car une
  // téléconsult pédiatrique reste pédagogiquement une téléconsult).
  if (TELECONSULT_RE.test(settingN) || TELECONSULT_RE.test(descN)) {
    return { type: "teleconsultation", matchedRule: "rule_1_teleconsult_keywords" };
  }

  // Règle 2 — pédiatrie + accompagnant.
  const age = typeof input.age === "number" ? input.age : undefined;
  const hasParentMention = CAREGIVER_MENTION_RE.test(descN);
  if (
    (age !== undefined && age < 12) &&
    (input.interlocutorType === "parent" || hasParentMention)
  ) {
    return { type: "pediatrie_accompagnant", matchedRule: "rule_2_child_with_caregiver" };
  }

  // Règle 3 — BBN : priorité à l'ID (marqueur explicite "BBN"), fallback sur
  // mots-clés de cadre (annonce / mauvaise nouvelle / diagnostic grave).
  if (/\bbbn\b/.test(idN)) {
    return { type: "bbn", matchedRule: "rule_3a_bbn_in_id" };
  }
  if (BBN_SETTING_RE.test(settingN) || BBN_SETTING_RE.test(descN)) {
    return { type: "bbn", matchedRule: "rule_3b_bbn_setting_keywords" };
  }

  // Règle 4 — psychiatrie : cadre ou spécialité explicite.
  if (PSY_RE.test(settingN) || PSY_RE.test(descN) || PSY_RE.test(specN)) {
    return { type: "psy", matchedRule: "rule_4_psy_keywords" };
  }

  // Règle 5 — triage : source USMLE_Triage ou cadre urgences/SAU.
  if (input.source === "USMLE_Triage") {
    return { type: "triage", matchedRule: "rule_5a_triage_source" };
  }
  if (TRIAGE_SETTING_RE.test(settingN)) {
    return { type: "triage", matchedRule: "rule_5b_triage_setting" };
  }

  // Règle 6 — défaut.
  return { type: "anamnese_examen", matchedRule: "rule_6_default" };
}

// Variante helper qui nourrit l'inférence depuis le StationMeta catalogué.
// Les champs `patientDescription`, `age`, `interlocutorType`, `specialite`
// peuvent manquer du meta (pas tous chargés en mémoire) — le caller enrichit
// via le service patient s'il en a besoin.
export function inferFromMeta(
  meta: StationMeta,
  extras: Pick<StationTypeInput, "patientDescription" | "age" | "interlocutorType" | "specialite">,
): StationTypeInference {
  return inferStationType({
    id: meta.id,
    fullId: meta.fullId,
    title: meta.title,
    source: meta.source,
    setting: meta.setting,
    patientDescription: extras.patientDescription,
    age: extras.age,
    interlocutorType: extras.interlocutorType,
    specialite: extras.specialite,
  });
}
