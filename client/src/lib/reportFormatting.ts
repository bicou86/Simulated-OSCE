// Helpers de post-traitement du Markdown renvoyé par Claude Sonnet pour le rapport
// d'évaluation. La synthèse visuelle (score global, verdict, barres par axe, légende
// des statuts) est désormais rendue côté client, il n'est donc plus nécessaire
// d'afficher ces sections du Markdown brut à l'étudiant.

const REDUNDANT_HEADING_PATTERNS: RegExp[] = [
  // Score global + variantes (avec ou sans emoji, 2 ou 3 niveaux de titre).
  /score\s*global/i,
  // Légende des statuts / Légende statuts.
  /l[ée]gende\s+des?\s+statuts?/i,
  /l[ée]gende\s+statuts?/i,
];

// Les emojis en tête de titres (📊, 📋, 💡, ✅…) passent mal :
// - côté web, on préfixe déjà le titre par une icône Lucide → l'emoji fait doublon.
// - côté PDF, Helvetica n'embarque aucun glyphe emoji → carrés tofu.
// Cette fonction retire UNIQUEMENT les emojis placés en tête d'un titre Markdown
// (#, ##, ###). Les emojis du corps de texte et les symboles de statut dans les
// cellules de tableau (✅ ⚠️ ❌) sont préservés.
//
// Construit sans la classe \p{} ni le flag /u pour rester compatible avec la
// cible TS par défaut. On couvre :
// - les surrogate pairs \uD83C..\uD83E + \uDC00..\uDFFF (📊 💡 📋 📝…)
// - les symboles dingbats / miscellaneous (U+2600–U+27BF : ☀ ✅ ✨ ✖)
// - les symboles & arrows (U+2B00–U+2BFF)
// - les modificateurs Variation Selector-16 (U+FE0F) et ZWJ (U+200D).
const HEADING_EMOJI_UNIT =
  "(?:[\\uD83C-\\uD83E][\\uDC00-\\uDFFF]|[\\u2600-\\u27BF\\u2B00-\\u2BFF]|\\uFE0F|\\u200D)";
const HEADING_EMOJI_RE = new RegExp(
  `^(\\s*#{1,3}\\s+)(?:${HEADING_EMOJI_UNIT}\\s*)+`,
);

export function stripLeadingHeadingEmojis(md: string): string {
  return md
    .split("\n")
    .map((line) => line.replace(HEADING_EMOJI_RE, "$1"))
    .join("\n");
}

function headingLevel(line: string): number | null {
  const m = line.match(/^(#{1,6})\s+/);
  return m ? m[1].length : null;
}

function headingMatchesAny(line: string, patterns: RegExp[]): boolean {
  const text = line.replace(/^#{1,6}\s+/, "").trim();
  return patterns.some((p) => p.test(text));
}

// Retire certaines sections connues pour être des doublons visuels du composant
// "Performance Globale". On coupe du titre jusqu'au prochain titre de même niveau
// (ou supérieur), et on supprime aussi tout encart `SCORE GLOBAL : …` éventuel.
export function stripRedundantSections(markdown: string): string {
  const lines = markdown.split("\n");
  const out: string[] = [];
  let skipUntilLevel: number | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lvl = headingLevel(line);

    if (skipUntilLevel !== null) {
      // On saute jusqu'au prochain titre de niveau <= skipUntilLevel.
      if (lvl !== null && lvl <= skipUntilLevel) {
        skipUntilLevel = null;
        // Ne pas `continue` — on retraite ce titre comme n'importe quelle ligne.
      } else {
        continue;
      }
    }

    if (lvl !== null && headingMatchesAny(line, REDUNDANT_HEADING_PATTERNS)) {
      skipUntilLevel = lvl;
      continue;
    }

    // Ligne "SCORE GLOBAL : 6% — Verdict …" hors titre : on la retire aussi.
    if (/^\s*SCORE\s+GLOBAL\s*[:：]/i.test(line)) {
      continue;
    }

    out.push(line);
  }

  // Compresse les blocs de lignes vides consécutives en un seul, puis nettoie
  // les emojis décoratifs en tête de titres (doublon avec les icônes Lucide /
  // puces PDF).
  const collapsed = out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  return stripLeadingHeadingEmojis(collapsed);
}

// Libellés complets des statuts — utilisés dans les tooltips des badges et dans la
// coloration des cellules de statut des tableaux rendus en Markdown.
export const STATUS_LABELS: Record<string, string> = {
  "✅": "OK — item complètement couvert",
  "⚠️": "Partiel — item partiellement couvert",
  "❌": "Manquant — non fait",
  "[N/A]": "Non applicable — contexte ne permettait pas l'évaluation",
  "[?]": "Non observé — impossible de juger",
};

export function classifyStatusCell(raw: string): {
  icon: "ok" | "partial" | "missing" | "na" | "unknown" | null;
  label: string | null;
} {
  const trimmed = raw.trim();
  if (/✅/.test(trimmed)) return { icon: "ok", label: STATUS_LABELS["✅"] };
  if (/⚠️?/.test(trimmed)) return { icon: "partial", label: STATUS_LABELS["⚠️"] };
  if (/❌/.test(trimmed)) return { icon: "missing", label: STATUS_LABELS["❌"] };
  if (/\bN\/A\b|\[N\/A\]/i.test(trimmed)) return { icon: "na", label: STATUS_LABELS["[N/A]"] };
  if (/\[\?\]/.test(trimmed)) return { icon: "unknown", label: STATUS_LABELS["[?]"] };
  return { icon: null, label: null };
}
