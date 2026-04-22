// Regroupement canonique des "cadres" (setting) des 285 stations.
// Les données brutes comportent 64 variantes différentes avec beaucoup de doublons
// sémantiques (« Urgences d'un hôpital régional », « Service des urgences », « Urgences » …).
//
// On expose :
//   - CANONICAL_GROUPS : liste ordonnée des étiquettes canoniques pour affichage stable
//   - canonicalSetting(raw) : mappe une chaîne brute vers l'étiquette canonique
//   - availableCanonicalSettings(rawList) : liste des groupes présents dans les données,
//     triée selon CANONICAL_GROUPS (pour alimenter le combobox Library)
//
// Approche : normalisation légère (casse) + liste de règles regex ordonnée par priorité
// (first-match-wins). Les spécialités "urgences pédiatriques/psychiatriques" et
// "téléphonique" passent AVANT la règle large "urgences" pour ne pas être capturées à tort.

export const CANONICAL_GROUPS = [
  "Service d'urgences",
  "Urgences pédiatriques",
  "Urgences psychiatriques",
  "Consultation téléphonique",
  "Cabinet de médecine générale",
  "Cabinet de gynécologie",
  "Cabinet ORL",
  "Cabinet de pédiatrie",
  "Cabinet de psychiatrie",
  "Cabinet de cardiologie",
  "Cabinet de gastro-entérologie",
  "Cabinet de pneumologie",
  "Cabinet d'hématologie",
  "Service de médecine interne",
  "Service de neurologie",
  "Service de neurochirurgie",
  "Clinique",
] as const;

export type CanonicalGroup = typeof CANONICAL_GROUPS[number];

// Ordre important : les règles plus spécifiques en haut, les fourre-tout en bas.
// Chaque entrée = [pattern testé sur la version lowercase, canonical].
const RULES: Array<[RegExp, CanonicalGroup]> = [
  // Spécialités d'urgence : DOIVENT passer avant la règle générique "urgences".
  [/urgences?\s+pédiatriques|hôpital\s+pédiatrique/i, "Urgences pédiatriques"],
  [/urgences?\s+psychiatriques/i, "Urgences psychiatriques"],

  // Consultation téléphonique avant urgences : les "Consultation téléphonique - Service
  // d'urgence" doivent être catégorisées comme téléphoniques, pas comme urgences.
  [/téléphonique/i, "Consultation téléphonique"],

  // Spécialités "cabinet" — doivent passer avant la règle "urgences" générique pour que
  // « Consultation ORL d'urgence » reste en cabinet ORL.
  [/\borl\b/i, "Cabinet ORL"],
  [/gynécolog|obstétri/i, "Cabinet de gynécologie"],
  [/pneumolog/i, "Cabinet de pneumologie"],
  [/hématolog/i, "Cabinet d'hématologie"],
  [/neurochirurg/i, "Service de neurochirurgie"],
  [/neurolog/i, "Service de neurologie"],
  [/cardiolog/i, "Cabinet de cardiologie"],
  [/gastro/i, "Cabinet de gastro-entérologie"],
  [/psychiatri/i, "Cabinet de psychiatrie"],
  [/pédiatri/i, "Cabinet de pédiatrie"],

  // Service de médecine interne (y compris SMIG = Service médecine interne générale).
  [/médecine\s+interne|smig/i, "Service de médecine interne"],

  // Urgences (générique, après spécialités) : capture toutes les variantes restantes.
  [/urgences?|déchocage/i, "Service d'urgences"],

  // Médecine générale — fourre-tout pour les cabinets et cliniques de généraliste.
  [
    /médecine\s+générale|médecine\s+de\s+famille|généraliste|cabinet\s+médical|clinique\s+médicale|clinique\s+de\s+médecine|consultation\s+médicale|service\s+médical/i,
    "Cabinet de médecine générale",
  ],

  // Policlinique / permanence / soins urgents / santé étudiante → Clinique.
  [/policlinique|permanence|santé\s+étudiante|soins\s+urgents|ambulatoire|clinique/i, "Clinique"],
];

// Mappe une chaîne brute vers sa forme canonique.
// Si aucune règle ne matche, renvoie la chaîne trimée telle quelle (rare — fallback).
export function canonicalSetting(raw: string | undefined | null): string {
  if (!raw) return "";
  const input = raw.trim();
  if (!input) return "";
  for (const [pattern, canonical] of RULES) {
    if (pattern.test(input)) return canonical;
  }
  return input;
}

// Liste des groupes canoniques effectivement présents dans le jeu de données fourni,
// triée selon CANONICAL_GROUPS (ordre sémantique) pour alimenter le combobox.
export function availableCanonicalSettings(rawList: Array<string | undefined | null>): string[] {
  const present = new Set<string>();
  for (const raw of rawList) {
    const canon = canonicalSetting(raw);
    if (canon) present.add(canon);
  }
  const ordered: string[] = [];
  for (const g of CANONICAL_GROUPS) {
    if (present.has(g)) {
      ordered.push(g);
      present.delete(g);
    }
  }
  // Éventuels fallbacks non mappés : ajoutés en fin, triés alphabétiquement.
  ordered.push(...Array.from(present).sort((a, b) => a.localeCompare(b, "fr")));
  return ordered;
}
