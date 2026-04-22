// Extraction du sexe du patient à partir de `patient_description`.
// Les JSON sources n'exposent pas de champ structuré → on déduit depuis le texte libre,
// qui suit un pattern régulier ("Marcia Billings, femme de 47 ans, consultante …",
// "Leo Morris, garçon de 6 ans, présenté par son père pour …").
//
// Résolution : male | female | unknown. Cache en mémoire par description (très bon taux
// de hit : mêmes descriptions répétées dans les tests, et le coût de résolution reste O(1)
// pour une description déjà vue).

export type PatientSex = "male" | "female" | "unknown";

// Patterns — Damien's spec. Ordre d'évaluation : female d'abord (car "patiente"
// contient "patient" en littéral mais les \b l'isolent correctement).
const FEMALE_RE = /\b(femme|patiente|madame|mme|fille|fillette|nourrisson\s+f|bébé\s+fille|consultante|présentée)\b/i;
const MALE_RE = /\b(homme|patient|monsieur|m\.?|garçon|nourrisson\s+m|bébé\s+garçon|consultant|présenté)\b/i;

const cache = new Map<string, PatientSex>();

export function extractSex(patientDescription: string | undefined | null): PatientSex {
  if (!patientDescription) return "unknown";
  const key = patientDescription;
  const cached = cache.get(key);
  if (cached) return cached;

  let resolved: PatientSex;
  if (FEMALE_RE.test(patientDescription)) {
    resolved = "female";
  } else if (MALE_RE.test(patientDescription)) {
    resolved = "male";
  } else {
    resolved = "unknown";
  }
  cache.set(key, resolved);
  return resolved;
}

// Utilitaire test/debug — vide le cache si besoin.
export function resetSexCache(): void {
  cache.clear();
}

// ─────────── Extraction de l'âge ───────────
//
// Le champ `age` des JSON source est toujours une chaîne — soit "47 ans" (~172/194),
// soit du texte libre où l'âge est noyé ("Virginia a 2 ans", "Père d'un garçon de 6 ans",
// "Mère d'un nouveau-né de 4 jours"). Les unités non-"ans" (mois/jours/semaines) sont
// arrondies à 0 pour les besoins du sélecteur de voix (qui ne s'intéresse qu'à "pédiatrique
// ou non").

const AGE_YEARS_RE = /(\d+)\s*an(?:s|née)?s?\b/i;
const AGE_SUB_YEAR_RE = /(\d+)\s*(mois|semaines?|jours?)\b/i;
const NEWBORN_RE = /nouveau[- ]?né/i;

// Accepte n'importe quelle source : le champ JSON `age` ou la description libre.
// Retourne un nombre d'années entier, ou undefined si rien d'exploitable.
export function extractAge(...sources: Array<string | number | undefined | null>): number | undefined {
  for (const src of sources) {
    if (typeof src === "number" && Number.isFinite(src)) return Math.max(0, Math.floor(src));
    if (typeof src !== "string" || !src) continue;
    const yrs = src.match(AGE_YEARS_RE);
    if (yrs) return parseInt(yrs[1], 10);
    if (AGE_SUB_YEAR_RE.test(src)) return 0; // mois/semaines/jours → <1 an
    if (NEWBORN_RE.test(src)) return 0;
  }
  return undefined;
}
