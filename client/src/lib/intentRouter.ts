// Routeur d'intention côté candidat (pure, sans I/O) : décide si un message du
// médecin est un geste d'examen physique ou une interaction verbale avec le
// patient/accompagnant.
//
// Règle pédagogique : un faux positif (on route vers l'examinateur alors que le
// candidat verbalise sans geste) est BIEN moins grave qu'un faux négatif (le
// patient invente un signe de Murphy). On est donc généreux.

export type DoctorIntent = "examiner" | "patient";

// Stripping d'accents + mise en minuscules pour permettre un matching robuste.
// "J'ausculte" / "j'ausculté" / "Jausculté" collapsent tous vers "j'ausculte".
// Les ligatures œ/æ ne sont pas décomposées par NFD — on les déplie manuellement
// pour que "fond d'œil" et "manœuvre" matchent leurs regex ASCII.
function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/œ/g, "oe")
    .replace(/æ/g, "ae")
    .normalize("NFD")
    // Combining diacritics block (U+0300–U+036F) — équivalent à \p{Diacritic}
    // sans avoir besoin du flag /u.
    .replace(/[̀-ͯ]/g, "")
    .replace(/['']/g, "'");
}

// Préfixe 1re personne du singulier : accepte "j'" (verbe commençant par voyelle
// ou h) OU "je " (verbe commençant par consonne).
const J1 = "(?:\\bj'|\\bje\\s+)";

// Trigger patterns : chacun capture un indice fort d'un geste d'examen. On reste
// en expressions "à 1 token près" (pas de regex trop greedy) pour éviter de
// détourner des phrases comme "j'ai eu mal à la palpation du docteur d'hier",
// mais on couvre les flexions courantes (présent 1re personne, impératif de
// soignant, forme nominale du geste).
const GESTURE_PATTERNS: RegExp[] = [
  // Verbes d'examen à la 1re personne
  new RegExp(`${J1}(?:palpe|palpais?|palperai|palpant)\\b`),
  new RegExp(`${J1}(?:ausculte|auscultais?|ausculto[ne]s?|auscultant)\\b`),
  new RegExp(`${J1}(?:percute|percutais?|percutant)\\b`),
  new RegExp(`${J1}(?:inspecte|regarde|observe|examine|inspecte(?:rai|nt)?)\\b`),
  new RegExp(`${J1}(?:teste|cherche|demande)\\b[^.]{0,40}\\b(?:signe|manoeuvre|reflexe|murmure|souffle|examen|auscultation|palpation|percussion|test|constantes?|ta|tension|pouls|glycemie|spo2|saturation|otoscopie|fond)`),
  new RegExp(`${J1}(?:realise|effectue|fais|pratique)\\b[^.]{0,20}\\b(?:examen|manoeuvre|auscultation|palpation|percussion|inspection|otoscopie|fond\\s+d'?oeil|test|reflexe|bandelette|glycemie\\s+capillaire)\\b`),
  new RegExp(`${J1}mesure\\b[^.]{0,30}\\b(?:ta|tension|fc|fr|temperature|saturation|spo2|glasgow|glycemie|reflexe)\\b`),
  new RegExp(`${J1}prends\\b[^.]{0,20}\\b(?:les?\\s+constantes?|la\\s+ta|la\\s+tension|le\\s+pouls|la\\s+temperature|la\\s+glycemie)\\b`),

  // Formes nominales / prépositionnelles
  /\b(?:a|au)\s+l'auscultation\b/,
  /\b(?:a|au)\s+la\s+palpation\b/,
  /\b(?:a|au)\s+la\s+percussion\b/,
  /\b(?:a|au)\s+l'inspection\b/,
  /\b(?:a|au)\s+l'otoscopie\b/,
  /\b(?:au|dans\s+le|en|du)\s+fond\s+d'?oeil\b/,
  /\bfond\s+d'?oeil\b/,
  /\b(?:au|lors\s+du)\s+toucher\s+(?:rectal|vaginal)\b/,

  // Signes / manœuvres éponymes — toujours un examen
  /\bsigne\s+de\s+(?:murphy|mcburney|laseg(?:ue|ne)|babinski|kernig|brudzinski|rinne|weber|blumberg|rovsing|homans|chvostek|trousseau|tinel|phalen|giordano)\b/,
  /\b(?:manoeuvre|manouvre|epreuve|test)\s+de\s+[a-z-]+/,
  /\b(?:rinne|weber)\b/,

  // Demandes directes de findings objectifs
  /\b(?:que\s+(?:trouvez|donne|donnent|montre)|qu[e']\s*est[-\s]ce\s+que\s+vous\s+(?:trouvez|voyez|entendez))\b/,
  /\b(?:y\s*a[-\s]?t[-\s]?il|il\s+y\s+a)\s+un?\s+(?:souffle|rale|sibilant|crepitant|nystagmus|mydriase|myosis|defense|contracture|matite|tympanisme)\b/,

  // Examens ciblés (noms d'examen autonomes)
  /\b(?:otoscopie|bandelette\s+urinaire|glasgow|reflexes?\s+osteotendineux|glycemie\s+capillaire)\b/,
];

// Liste noire côté PATIENT : tokens que le patient ne doit JAMAIS produire
// comme findings objectifs. Utilisée en double-emploi :
// 1) Côté client, si on détecte ces tokens dans une demande du candidat, on
//    route vers l'examinateur (encore plus généreux que les patterns gestes).
// 2) Côté test/non-régression, on vérifie que la réponse du LLM patient n'en
//    contient jamais.
export const PATIENT_FINDING_BLACKLIST: string[] = [
  "auscultation",
  "palpation",
  "percussion",
  "rinne",
  "weber",
  "murphy",
  "mcburney",
  "lasegue",
  "babinski",
  "kernig",
  "brudzinski",
  "blumberg",
  "rovsing",
  "souffle cardiaque",
  "souffle systolique",
  "souffle diastolique",
  "rale",
  "sibilant",
  "crepitant",
  "defense abdominale",
  "contracture abdominale",
  "matite",
  "tympanisme",
  "mydriase",
  "myosis",
  "nystagmus",
  "conduction aerienne",
  "conduction osseuse",
  "abduction",
  "rotation interne",
  "rotation externe",
  "glasgow",
];

// Liste noire ADDITIONNELLE pour un accompagnant·e (caregiver) : en plus des
// termes patient, un parent ne doit pas produire les verbes de mesure
// instrumentale ni le jargon soignant qu'un vrai parent n'utiliserait pas.
// Ces termes sont OK pour le patient adulte qui rapporte un finding objectif
// qu'il a entendu d'un autre médecin — mais jamais pour un parent qui décrit
// ce qu'il observe chez son enfant.
export const CAREGIVER_EXTRA_BLACKLIST: string[] = [
  // Mesures instrumentales qu'un parent n'a pas
  "saturation",
  "spo2",
  "tachypnee",
  "tachypneique",
  "tachycardie",
  "tachycarde",
  "bradycardie",
  "dyspnee",
  "dyspneique",
  "cyanose",
  "cyanosee",
  "cyanose peripherique",
  "hyperthermie",
  "febrile",
  // Verbes de soignant
  "j'ai mesure",
  "j ai mesure",
  "pouls est regulier",
  "pouls est irregulier",
  "pouls filant",
  "a l'auscultation",
  "a la palpation",
  "elle presente une",
  "il presente une",
  "on objective",
  // Jargon additionnel
  "murmure vesiculaire",
  "pale cutanee",
  "palure cutanee",
];

export const CAREGIVER_FINDING_BLACKLIST: string[] = [
  ...PATIENT_FINDING_BLACKLIST,
  ...CAREGIVER_EXTRA_BLACKLIST,
];

const BLACKLIST_RE = new RegExp(
  "\\b(?:" + PATIENT_FINDING_BLACKLIST.map((t) => t.replace(/\s+/g, "\\s+")).join("|") + ")\\b",
);

// ─────────── Guards : questions qui NE SONT PAS des gestes ───────────
// Priorité absolue sur les patterns de gestes : un terme d'examen dans une
// question d'antécédents ("avez-vous déjà eu une auscultation anormale ?") ou
// dans une question sur les sensations du patient ("a-t-elle mal quand on lui
// touche la jambe ?") doit rester chez le patient/accompagnant.

// Questions d'anamnèse au passé / conditionnel : le candidat sonde un historique,
// il ne réalise pas le geste.
const ANAMNESIS_PATTERNS: RegExp[] = [
  /\bauriez-?\s*vous\b/,
  /\bavez-?\s*vous\s+(?:deja|un\s+jour|par\s+le\s+passe|d[eé]j[aà])\b/,
  /\bavez-?\s*vous\s+eu\b/,
  /\bavez-?\s*vous\s+(?:subi|passe|eu|d[eé]j[aà]\s+passe)\b/,
  /\bas-?\s*tu\s+(?:deja|d[eé]j[aà])\b/,
  /\best-?\s*ce\s+qu['e]?\s*(?:un\s+m[eé]decin|vous|tu|on)\s+(?:vous\s+|t['e]?\s+)?a\s+d[eé]j[aà]\b/,
  /\bun\s+m[eé]decin\s+(?:vous|t['e]?)\s+a\s+(?:deja|d[eé]j[aà])\b/,
  /\bon\s+vous\s+a\s+d[eé]j[aà]\b/,
  /\b(?:votre|vos)\s+(?:dernier|derniere|derniers|dernieres|precedent|precedente)\s+\w+/,
];

// Questions à la 3e personne sur les sensations/douleurs : on interroge le
// patient / l'accompagnant, on ne pose PAS un geste. Ces formulations sont
// courantes en pédiatrie où le parent décrit ce qu'il observe.
const THIRD_PERSON_SYMPTOM_PATTERNS: RegExp[] = [
  /\ba-?\s*t-?\s*(?:il|elle|on)\s+(?:mal|des?\s+douleurs?|une\s+douleur|de\s+la\s+peine)/,
  /\b(?:a|est)-?\s*t-?\s*(?:il|elle)\s+(?:fievre|nausees?|vomi)/,
  /\best-?\s*(?:il|elle)\s+(?:douloureux|douloureuse|gene|genee|inconfortable|fatigue|fatiguee|irritable)/,
  /\best-?\s*ce\s+(?:douloureux|douloureuse|genant|penible)/,
  /\best-?\s*ce\s+qu['e]?\s*(?:il|elle|ca|[çc]a)\s+(?:lui\s+)?(?:fait\s+)?(?:mal|souffrir|pleurer|saigner)/,
  /\b(?:pleure|crie|hurle|grimace|se\s+tient)-?\s*t-?\s*(?:il|elle)\s+(?:quand|lorsque|au\s+moment|en)/,
  /\ba-?\s*t-?\s*(?:il|elle)\s+(?:dej|deja|d[eé]j[aà])\s+(?:eu|vomi|fait)/,
];

export function classifyDoctorIntent(raw: string): DoctorIntent {
  const text = normalize(raw);
  // Guards d'abord — un match ici renvoie patient immédiatement, même si des
  // mots-clés d'examen apparaissent plus loin dans la phrase.
  for (const re of ANAMNESIS_PATTERNS) {
    if (re.test(text)) return "patient";
  }
  for (const re of THIRD_PERSON_SYMPTOM_PATTERNS) {
    if (re.test(text)) return "patient";
  }
  for (const re of GESTURE_PATTERNS) {
    if (re.test(text)) return "examiner";
  }
  if (BLACKLIST_RE.test(text)) return "examiner";
  return "patient";
}

// Test si une réponse attribuée au patient contient un terme de la liste noire
// des findings objectifs. Utilisé par le test de non-régression et par le
// "judge" futur (point 17). Retourne la liste des termes détectés (vide si OK).
export function detectPatientFindingLeaks(reply: string): string[] {
  return detectLeaks(reply, PATIENT_FINDING_BLACKLIST);
}

// Variante caregiver : même mécanisme sur la blacklist étendue. À utiliser
// quand le LLM a été routé sur le prompt Accompagnant — les verbes de mesure
// instrumentale et le jargon soignant sont en plus interdits.
export function detectCaregiverFindingLeaks(reply: string): string[] {
  return detectLeaks(reply, CAREGIVER_FINDING_BLACKLIST);
}

function detectLeaks(reply: string, blacklist: string[]): string[] {
  const text = normalize(reply);
  const hits: string[] = [];
  for (const term of blacklist) {
    const re = new RegExp("\\b" + term.replace(/\s+/g, "\\s+") + "\\b");
    if (re.test(text)) hits.push(term);
  }
  return hits;
}
