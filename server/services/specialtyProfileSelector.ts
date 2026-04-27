// Phase 3 J3 — sélecteur de profil de spécialité pour l'injection dans le
// system prompt. Pure fonction déterministe : pas de LLM, pas d'I/O.
//
// Règle de priorité (la plus spécifique gagne) :
//   1. register === "palliatif"  → profil "palliatif"
//   2. register === "gyneco"     → profil "gyneco"
//   3. age ∈ [14, 17]            → profil "adolescent"
//   (aucun trigger) → null → aucune injection, rétrocompat Phase 1/2/J1/J2
//
// Age parsing : on réutilise la même logique que labsService — priorité au
// champ explicite `patient_age_years` (numérique), fallback sur extraction
// regex depuis `patient_description` ("Homme de 45 ans", "Fillette de 2 ans").
//
// Les 279 stations Phase 2 sans `register` ni âge dans la plage 14-17 ne sont
// PAS impactées (rétrocompatibilité tolérance 0 non-régression).

export type SpecialtyProfile = "gyneco" | "adolescent" | "palliatif";

interface StationSpecialtyInput {
  register?: unknown;
  patient_age_years?: unknown;
  patient_description?: unknown;
  age?: unknown;
  tags?: unknown;
}

const ADOLESCENT_MIN_AGE = 14;
const ADOLESCENT_MAX_AGE = 17;

const AGE_RE = /\b(\d{1,3})\s*(ans|an|mois)\b/i;

export function parseStationAgeYears(station: StationSpecialtyInput): number | null {
  // Champ explicite numérique — gagne toujours.
  if (typeof station.patient_age_years === "number" && station.patient_age_years >= 0) {
    return station.patient_age_years;
  }
  // `age` legacy peut être "45 ans" (string) ou 45 (number dans certains tests).
  if (typeof station.age === "number" && station.age >= 0) return station.age;
  if (typeof station.age === "string") {
    const m = AGE_RE.exec(station.age);
    if (m) {
      const val = parseInt(m[1], 10);
      if (m[2].toLowerCase() === "mois") return val / 12;
      return val;
    }
  }
  // Fallback : extraction depuis patient_description.
  if (typeof station.patient_description === "string") {
    const m = AGE_RE.exec(station.patient_description);
    if (m) {
      const val = parseInt(m[1], 10);
      if (m[2].toLowerCase() === "mois") return val / 12;
      return val;
    }
  }
  return null;
}

export function selectSpecialtyProfile(
  station: StationSpecialtyInput,
): SpecialtyProfile | null {
  const reg = typeof station.register === "string" ? station.register.toLowerCase() : null;
  if (reg === "palliatif") return "palliatif";
  if (reg === "gyneco") return "gyneco";
  const age = parseStationAgeYears(station);
  if (age !== null && age >= ADOLESCENT_MIN_AGE && age <= ADOLESCENT_MAX_AGE) {
    return "adolescent";
  }
  return null;
}

// ─────────── Directive d'injection ───────────
// Format : bloc markdown court qui pointe vers le profil actif dans le prompt
// (patient.md : Profil A/B/C ; caregiver.md : Profil P1/P2). Le texte complet
// des profils reste dans les fichiers .md — cette directive ne fait qu'activer
// la prioritisation. L'LLM a déjà tout le contenu profil en contexte ; la
// directive lève l'ambiguïté en désignant l'entrée canonique.
//
// Le mapping dépend du template chargé :
//   - patient.md   + gyneco      → "Profil A" + few-shot A1-A4
//   - patient.md   + adolescent  → "Profil B" + few-shot B1-B3
//   - patient.md   + palliatif   → "Profil C" + few-shot C1-C3
//   - caregiver.md + adolescent  → "Profil P1 (parent d'ado)" + few-shot E,F,G
//   - caregiver.md + palliatif   → "Profil P2 (proche palliatif)" + few-shot H,I,J
//   - caregiver.md + gyneco      → null (inapplicable, pas d'accompagnant gyneco dédié)

export type PromptTemplateKind = "patient" | "caregiver";

export function buildSpecialtyDirective(
  profile: SpecialtyProfile | null,
  template: PromptTemplateKind,
): string {
  if (!profile) return "";
  const mapping = getProfileBlockName(profile, template);
  if (!mapping) return "";
  return `

## PROFIL ACTIF — SPÉCIALITÉ
Cette station active le **${mapping.name}** décrit ci-dessus. Applique prioritairement les règles de ce profil et ses exemples few-shot (${mapping.examples}). Les règles générales (pas de findings cliniques, pas de diagnostic, reformulation naïve pour l'accompagnant·e) restent actives en parallèle.`;
}

function getProfileBlockName(
  profile: SpecialtyProfile,
  template: PromptTemplateKind,
): { name: string; examples: string } | null {
  if (template === "patient") {
    if (profile === "gyneco") {
      return {
        name: "Profil A — Patient·e en consultation gynéco-obstétricale",
        examples: "A1, A2, A3, A4",
      };
    }
    if (profile === "adolescent") {
      return {
        name: "Profil B — Patient·e adolescent·e (14-17 ans)",
        examples: "B1, B2, B3",
      };
    }
    if (profile === "palliatif") {
      return {
        name: "Profil C — Patient·e en soins palliatifs / fin de vie",
        examples: "C1, C2, C3",
      };
    }
    return null;
  }
  // template === "caregiver"
  if (profile === "adolescent") {
    return {
      name: "Profil P1 — Parent d'un·e adolescent·e (14-17 ans)",
      examples: "E, F, G",
    };
  }
  if (profile === "palliatif") {
    return {
      name: "Profil P2 — Proche d'un·e patient·e en soins palliatifs",
      examples: "H, I, J",
    };
  }
  // caregiver + gyneco : pas d'équivalent accompagnant dédié.
  return null;
}
