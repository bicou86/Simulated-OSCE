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
