// Résolution de l'interlocuteur du médecin pour une station donnée.
//
// Dans un ECOS adulte classique, le patient se représente lui-même ("self").
// Dans un cas pédiatrique ou pré-verbal (nourrisson, bébé, patient inconscient,
// dément…), le candidat parle en réalité à un parent ou un tuteur qui répond
// pour le patient. Le prompt et la voix doivent refléter ce changement.
//
// Règles (ordre de priorité) :
//   1. Marqueur explicite dans la description : "présenté(e) par sa/son {rôle}"
//      → parent avec le rôle détecté.
//   2. Marqueurs de non-coopération (inconscient, comateux, intubé, non-verbal,
//      dément) → parent/caregiver.
//   3. age < 4 (nourrisson / tout-petit) → parent (mère par défaut).
//   4. age ∈ [4, 12[ (enfant en âge scolaire) → self + parentPresent (l'enfant
//      répond lui-même mais le parent peut compléter).
//   5. Sinon → self.

import type { PatientSex } from "./patientSex";

export type InterlocutorType = "self" | "parent";
export type ParentRole = "mother" | "father" | "caregiver";

export interface Interlocutor {
  type: InterlocutorType;
  parentRole?: ParentRole;
  parentPresent?: boolean;
  reason: string;
}

export interface InterlocutorInput {
  patientDescription: string | undefined | null;
  age: number | undefined;
  sex: PatientSex;
}

// Priorité 1 — marqueurs explicites "présenté(e) par sa/son {rôle}".
// On capture aussi "apporté par", "accompagné par", "amené par" qu'on voit parfois.
const PARENT_PRESENTED_RE = /(?:présenté|apporté|amené|accompagné)e?\s+(?:par\s+)?(?:sa|son|la|le|par)\s+(mère|maman|père|papa|parent|tuteur|tutrice|grand[- ]m[eè]re|grand[- ]p[eè]re)/i;

// "Mère d'un garçon…", "Père d'un bébé…" — le patient est l'enfant, la chaîne
// décrit en fait le parent. Cette forme indique aussi parent.
const PARENT_OF_CHILD_RE = /(mère|maman|père|papa|parent|tuteur|tutrice|grand[- ]m[eè]re|grand[- ]p[eè]re)\s+d(?:'|e\s+)un[e]?/i;

function roleFromMatch(raw: string): ParentRole {
  const w = raw.toLowerCase();
  if (w.includes("père") || w.includes("papa")) return "father";
  if (w.includes("mère") || w.includes("maman")) return "mother";
  return "caregiver";
}

// Priorité 2 — patient non-coopérant : on bascule sur un interlocuteur tiers.
const NON_COOPERATIVE_RE = /\b(non[- ]verbal(?:e)?|inconscient(?:e)?|comateux|comateuse|intub[ée]|intub[ée]e|dément(?:e)?|démence|confus(?:e)?|aphasique)\b/i;

export function resolveInterlocutor(input: InterlocutorInput): Interlocutor {
  const desc = (input.patientDescription ?? "").toString();

  // Règle 1 : marqueur "présenté par sa mère", "apporté par son père", etc.
  const presented = desc.match(PARENT_PRESENTED_RE);
  if (presented) {
    return {
      type: "parent",
      parentRole: roleFromMatch(presented[1]),
      reason: `marqueur explicite « ${presented[0]} »`,
    };
  }

  // Règle 1b : forme "Mère d'un garçon de 6 ans" — la description est celle du parent.
  const parentOf = desc.match(PARENT_OF_CHILD_RE);
  if (parentOf) {
    return {
      type: "parent",
      parentRole: roleFromMatch(parentOf[1]),
      reason: `parent désigné comme sujet (« ${parentOf[0]} »)`,
    };
  }

  // Règle 2 : patient non-coopérant (inconscient, comateux, non-verbal, dément…).
  const nonCoop = desc.match(NON_COOPERATIVE_RE);
  if (nonCoop) {
    return {
      type: "parent",
      parentRole: "caregiver",
      reason: `patient non-coopérant (« ${nonCoop[0]} »)`,
    };
  }

  // Règle 3 : nourrisson / tout-petit — parent mère par défaut.
  if (typeof input.age === "number" && input.age < 4) {
    return {
      type: "parent",
      parentRole: "mother",
      reason: `âge < 4 (${input.age}), patient pré-verbal`,
    };
  }

  // Règle 4 : enfant en âge scolaire — self mais parent présent.
  if (typeof input.age === "number" && input.age < 12) {
    return {
      type: "self",
      parentPresent: true,
      reason: `enfant en âge scolaire (${input.age}), parent accompagnant`,
    };
  }

  // Règle 5 : adulte / adolescent — self.
  return {
    type: "self",
    reason: typeof input.age === "number" ? `adulte/adolescent (${input.age})` : "âge inconnu — self par défaut",
  };
}

// Libellé court pour l'UI (feuille de porte, transcript label).
export function interlocutorLabel(it: Interlocutor): string {
  if (it.type === "self") return "Patient";
  switch (it.parentRole) {
    case "mother": return "Mère du patient";
    case "father": return "Père du patient";
    case "caregiver": return "Accompagnant·e";
    default: return "Accompagnant·e";
  }
}

// Article défini pour affichage type « la mère », « le père », « l'accompagnant·e ».
export function interlocutorArticle(it: Interlocutor): string {
  if (it.type === "self") return "le patient";
  switch (it.parentRole) {
    case "mother": return "la mère";
    case "father": return "le père";
    case "caregiver": return "l'accompagnant·e";
    default: return "l'accompagnant·e";
  }
}
