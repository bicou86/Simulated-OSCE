// Détection des marqueurs pédagogiques pour la mise en relief visuelle du rapport.
// Pure / sans dépendance UI → utilisé à la fois par l'affichage web (<AccentedMarkdown>)
// et par l'export PDF (<ReportPdf>).

export type AccentKind =
  | "problem"       // "Problème :"
  | "action"        // "Action concrète :" / "Action :"
  | "benefit"       // "Bénéfice :"
  | "covered"       // "Éléments couverts :"
  | "missing"       // "Manquants :" / "Manquant :"
  | "mnemonic"      // SOCRATES, OPQRST, AMPLE, SAMPLE, MONA, ABCDE
  | "percent"       // 42%
  | "fraction";     // 6/12

export interface AccentToken {
  text: string;
  accent: AccentKind | null;
}

// Les labels pédagogiques sont en majuscule ou capitalisés, suivis d'un deux-points
// (fin-de-mot :), éventuellement avec un espace ou un espace insécable. Le
// tokenizer ne consomme QUE le label — le contenu qui suit reste en texte brut.
// Ordre important : les variantes longues passent avant les courtes.
// Les deux-points supportés : ASCII `:` et fullwidth `：`.
const LABEL_PATTERNS: Array<{ re: RegExp; accent: AccentKind }> = [
  // Problèmes / critiques / à améliorer → rouge
  { re: /Probl[èe]mes?\s*[:：]/gi, accent: "problem" },
  { re: /Critical\s+miss\s*[:：]/gi, accent: "problem" },
  { re: /[ÉE]l[ée]ments?\s+critiques?\s+manqu[ée]s?\s*[:：]/gi, accent: "problem" },
  // "Points à améliorer :" et variantes : on match le label tel qu'il est produit
  // par le prompt evaluator (éventuellement avec un mot intercalaire court).
  { re: /Points?\s+(?:à|a)\s+am[ée]liorer(?:[^:\n]{0,60})?\s*[:：]/gi, accent: "problem" },
  { re: /Axes?\s+d['’]am[ée]lioration\s*[:：]/gi, accent: "problem" },

  // Actions / recommandations / techniques → bleu
  // Spécifique avant générique pour que "Action concrète :" consomme le label entier.
  { re: /Actions?\s+concr[èe]tes?\s*[:：]/gi, accent: "action" },
  { re: /Actions?\s*[:：]/gi, accent: "action" },
  { re: /Technique\s*[:：]/gi, accent: "action" },
  { re: /Recommandation\s*[:：]/gi, accent: "action" },

  // Bénéfices / forces / couvert → vert
  { re: /B[ée]n[ée]fices?(?:\s+attendus?)?\s*[:：]/gi, accent: "benefit" },
  { re: /Points?\s+forts?\s*[:：]/gi, accent: "benefit" },
  { re: /[ÉE]l[ée]ments?\s+couverts?\s*[:：]/gi, accent: "covered" },

  // Manquants (legacy / tableaux de détail)
  { re: /Manquants?\s*[:：]/gi, accent: "missing" },
];

// Mnémoniques cliniques reconnus : tokenisés en span indigo monospace.
const MNEMONIC_WORDS = ["SOCRATES", "OPQRST", "AMPLE", "SAMPLE", "MONA", "ABCDE"];
const MNEMONIC_RE = new RegExp(`\\b(${MNEMONIC_WORDS.join("|")})\\b`, "g");

// Pourcentages et fractions : mis en gras monospace pour ressortir dans le corps
// du texte (ex. "6%" ou "6/12").
const PERCENT_RE = /\b\d{1,3}\s?%/g;
const FRACTION_RE = /\b\d+\/\d+\b/g;

interface Match {
  start: number;
  end: number;
  accent: AccentKind;
}

// Collecte tous les matches, résout les chevauchements en gardant le plus à gauche
// puis le plus long — évite qu'un pattern plus étroit (ex. "Action :") consomme
// un pattern plus large ("Action concrète :") qui a déjà matché avant.
function collectMatches(input: string): Match[] {
  const matches: Match[] = [];
  for (const { re, accent } of LABEL_PATTERNS) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(input)) !== null) {
      matches.push({ start: m.index, end: m.index + m[0].length, accent });
    }
  }
  {
    MNEMONIC_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = MNEMONIC_RE.exec(input)) !== null) {
      matches.push({ start: m.index, end: m.index + m[0].length, accent: "mnemonic" });
    }
  }
  {
    PERCENT_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = PERCENT_RE.exec(input)) !== null) {
      matches.push({ start: m.index, end: m.index + m[0].length, accent: "percent" });
    }
  }
  {
    FRACTION_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = FRACTION_RE.exec(input)) !== null) {
      matches.push({ start: m.index, end: m.index + m[0].length, accent: "fraction" });
    }
  }

  matches.sort((a, b) => (a.start - b.start) || (b.end - a.end));
  const resolved: Match[] = [];
  let cursor = 0;
  for (const m of matches) {
    if (m.start < cursor) continue; // chevauchement : on garde le premier.
    resolved.push(m);
    cursor = m.end;
  }
  return resolved;
}

export function tokenizeAccents(input: string): AccentToken[] {
  if (!input) return [{ text: "", accent: null }];
  const matches = collectMatches(input);
  if (matches.length === 0) return [{ text: input, accent: null }];

  const tokens: AccentToken[] = [];
  let cursor = 0;
  for (const m of matches) {
    if (m.start > cursor) {
      tokens.push({ text: input.slice(cursor, m.start), accent: null });
    }
    tokens.push({ text: input.slice(m.start, m.end), accent: m.accent });
    cursor = m.end;
  }
  if (cursor < input.length) {
    tokens.push({ text: input.slice(cursor), accent: null });
  }
  return tokens;
}
