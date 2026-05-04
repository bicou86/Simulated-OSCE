// Phase 11 J2 — slugifier déterministe pour les noms d'images pédagogiques.
//
// Convertit un nom de fichier source (souvent en français avec accents,
// espaces, ponctuation et/ou majuscules) en un slug ASCII-safe stable
// utilisable comme nom de fichier disque ET comme URL servie par Vite
// publicDir sous `/pedagogical-images/`.
//
// Algorithme (ordre strict) :
//   0. Substitution explicite des ligatures non décomposables par NFD
//      (Œ→OE, œ→oe, Æ→AE, æ→ae, ß→ss). Le bloc Combining Diacritical
//      Marks ne couvre pas ces caractères composés ; sans ce pré-pass,
//      "Œdème" perdrait le radical "OE" en silence (« deme »).
//   1. Décomposition Unicode NFD + suppression des diacritiques [̀-ͯ]
//      → "Échographie" → "Echographie"
//   2. Lowercase ASCII strict → "Echographie" → "echographie"
//   3. Substitution de tout caractère non `[a-z0-9]` par `-`
//      → "naevus_atypique" → "naevus-atypique"
//      → "thorax PA" → "thorax-pa"
//   4. Compactage des séries `--+` en un seul `-`
//      → "lesion--cutanee" → "lesion-cutanee"
//   5. Trim des `-` aux extrémités
//      → "-foo-" → "foo"
//   6. Force l'extension `.jpg` lowercase (peu importe l'extension d'origine)
//
// Garanties :
//   • Idempotence : `slugify(slugify(x)) === slugify(x)` pour tout x non-vide.
//   • Déterminisme : zéro LLM, zéro aléatoire, zéro dépendance externe.
//   • Le résultat valide systématiquement la regex
//     `pedagogicalImagePathSchema` du schéma Zod (cf.
//     pedagogical-content-schema.ts).
//
// Aucune tolérance pour un slug vide en sortie : si l'entrée ne contient
// aucun caractère ASCII alphanumérique après normalisation, la fonction
// retourne un slug fallback "image" (cas pathologique uniquement).

export interface SlugifyResult {
  slug: string;     // ex. "echographie-abdominale"
  basename: string; // ex. "echographie-abdominale.jpg"
  url: string;      // ex. "/pedagogical-images/echographie-abdominale.jpg"
}

const FALLBACK_SLUG = "image";

export function slugifyPedagogicalImageName(originalFilename: string): SlugifyResult {
  // On retire l'extension d'entrée (peu importe laquelle) avant de slugifier
  // le radical seul. L'extension finale est forcée à .jpg en sortie (étape 6).
  const dotIdx = originalFilename.lastIndexOf(".");
  const stem = dotIdx > 0 ? originalFilename.slice(0, dotIdx) : originalFilename;

  // Étape 0 — substitution des ligatures non décomposables par NFD.
  // Sans cette passe préalable, "Œdème" donnerait "deme" car NFD ne
  // décompose pas Œ/œ/Æ/æ/ß en leurs équivalents ASCII.
  const ligaturesExpanded = stem
    .replace(/Œ/g, "OE").replace(/œ/g, "oe")
    .replace(/Æ/g, "AE").replace(/æ/g, "ae")
    .replace(/ß/g, "ss");

  // Étape 1 — NFD + suppression diacritiques (bloc Unicode
  // U+0300..U+036F « Combining Diacritical Marks »).
  const decomposed = ligaturesExpanded.normalize("NFD").replace(/[̀-ͯ]/g, "");

  // Étape 2 — lowercase ASCII.
  const lowered = decomposed.toLowerCase();

  // Étape 3 — non-alphanum → "-".
  const dashed = lowered.replace(/[^a-z0-9]/g, "-");

  // Étape 4 — compactage des "--+".
  const compacted = dashed.replace(/-+/g, "-");

  // Étape 5 — trim des "-".
  const trimmed = compacted.replace(/^-+|-+$/g, "");

  // Fallback si l'entrée ne contenait aucun caractère exploitable.
  const slug = trimmed.length > 0 ? trimmed : FALLBACK_SLUG;

  const basename = `${slug}.jpg`;
  const url = `/pedagogical-images/${basename}`;
  return { slug, basename, url };
}
