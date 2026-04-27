// Phase 4 J3 — contraintes lexicales pour les participants en registre
// `vocabulary === 'lay'` (grand public).
//
// Quand un patient adolescent, un parent accompagnant, un proche d'une
// personne âgée, etc. répondent au médecin, ils ne doivent PAS utiliser
// le jargon médical du soignant — sinon le candidat ne pratique pas
// vraiment l'écoute du registre patient. Cette table statique liste les
// 30+ termes médicaux les plus fréquents dans les ECOS et leurs équivalents
// grand public ; la directive injectée dans le system prompt en oriente
// le LLM. ZÉRO appel LLM dans cette validation : tout est table statique.
//
// La même table sert aux tests E2E pour ASSERTER l'absence des termes
// bannis dans une réponse réelle (vocabularyConstraints.e2e).

export interface LayConstraint {
  // Forme canonique du terme médical (lowercase, sans accents pour
  // simplifier le matching des tests).
  forbidden: string;
  // Variantes orthographiques acceptables comme "preuve d'utilisation
  // bannie" (ex. accents, pluriels, formes féminines). On utilise une
  // RegExp avec word-boundary pour éviter les faux positifs sur des
  // morphèmes englobants.
  pattern: RegExp;
  // Equivalent grand public à privilégier — cité littéralement dans la
  // directive injectée au prompt.
  layAlternative: string;
}

// Helper : construit un pattern \b<term>\b case-insensitive qui couvre
// les variantes accent / pas-accent et les pluriels en `s`.
function pattern(...forms: string[]): RegExp {
  // (?<![\p{L}]) ... (?![\p{L}]) en mode unicode pour borner sur des
  // caractères non-lettre — \b ne joue pas avec les lettres accentuées.
  const escaped = forms
    .map((f) => f.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("|");
  return new RegExp(`(?<![\\p{L}])(?:${escaped})s?(?![\\p{L}])`, "iu");
}

// Top 30+ termes médicaux à proscrire en registre `lay`. Couverture choisie
// pour les 3 scénarios canoniques J3 (RESCOS-70 ado/mère, RESCOS-71
// gériatrique, RESCOS-9b parent d'enfant) PLUS les marqueurs lexicaux
// récurrents des fixtures Phase 2/3 pour éviter les régressions silencieuses.
export const LAY_CONSTRAINTS: LayConstraint[] = [
  // Respiratoire
  { forbidden: "dyspnée", pattern: pattern("dyspnée", "dyspnee"), layAlternative: "essoufflement / je manque d'air / je m'essouffle" },
  { forbidden: "tachypnée", pattern: pattern("tachypnée", "tachypnee"), layAlternative: "respire vite" },
  { forbidden: "orthopnée", pattern: pattern("orthopnée", "orthopnee"), layAlternative: "essoufflé en position couchée" },
  { forbidden: "apnée", pattern: pattern("apnée", "apnee"), layAlternative: "arrêts de respiration" },
  // Général
  { forbidden: "asthénie", pattern: pattern("asthénie", "asthenie"), layAlternative: "fatigue intense" },
  { forbidden: "anorexie", pattern: pattern("anorexie"), layAlternative: "perte d'appétit / il ne mange plus" },
  { forbidden: "cachexie", pattern: pattern("cachexie", "cachectique"), layAlternative: "amaigrissement / il a beaucoup maigri" },
  { forbidden: "ictère", pattern: pattern("ictère", "ictere", "ictérique", "icterique"), layAlternative: "jaunisse / il est jaune" },
  { forbidden: "œdème", pattern: pattern("œdème", "oedème", "œdeme", "oedeme", "œdèmes périphériques", "œdème des membres inférieurs"), layAlternative: "gonflement / jambes gonflées" },
  { forbidden: "céphalée", pattern: pattern("céphalée", "cephalée", "céphalee", "cephalee"), layAlternative: "mal de tête" },
  { forbidden: "asthénique", pattern: pattern("asthénique", "asthenique"), layAlternative: "très fatigué" },
  // Urinaire
  { forbidden: "dysurie", pattern: pattern("dysurie", "dysurique"), layAlternative: "douleur en urinant / brûlure quand il fait pipi" },
  { forbidden: "hématurie", pattern: pattern("hématurie", "hematurie"), layAlternative: "sang dans les urines" },
  { forbidden: "polyurie", pattern: pattern("polyurie", "polyurique"), layAlternative: "uriner beaucoup / aller souvent aux toilettes" },
  { forbidden: "polydipsie", pattern: pattern("polydipsie"), layAlternative: "boire beaucoup / soif tout le temps" },
  { forbidden: "pollakiurie", pattern: pattern("pollakiurie"), layAlternative: "envie d'uriner souvent par petites quantités" },
  // Neuro
  { forbidden: "paresthésie", pattern: pattern("paresthésie", "paresthesie"), layAlternative: "fourmillements / picotements" },
  { forbidden: "hypoesthésie", pattern: pattern("hypoesthésie", "hypoesthesie"), layAlternative: "moins de sensibilité" },
  { forbidden: "amnésie", pattern: pattern("amnésie", "amnesie", "amnésique", "amnesique"), layAlternative: "trous de mémoire" },
  { forbidden: "syncope", pattern: pattern("syncope"), layAlternative: "il s'est évanoui / il a perdu connaissance" },
  { forbidden: "lipothymie", pattern: pattern("lipothymie"), layAlternative: "malaise / il a failli tomber dans les pommes" },
  // Digestif
  { forbidden: "dyspepsie", pattern: pattern("dyspepsie"), layAlternative: "mal digéré / lourdeur après les repas" },
  { forbidden: "épigastralgie", pattern: pattern("épigastralgie", "epigastralgie"), layAlternative: "douleur en haut du ventre" },
  { forbidden: "méléna", pattern: pattern("méléna", "melena"), layAlternative: "selles très noires" },
  { forbidden: "hématémèse", pattern: pattern("hématémèse", "hematemese"), layAlternative: "vomi du sang" },
  { forbidden: "rectorragie", pattern: pattern("rectorragie"), layAlternative: "sang rouge dans les selles" },
  // Pédiatrie / locomoteur
  { forbidden: "boiterie d'esquive", pattern: pattern("boiterie d'esquive", "boiterie d esquive"), layAlternative: "elle évite de poser le pied / elle marche pas comme il faut" },
  { forbidden: "antalgie de décharge", pattern: pattern("antalgie de décharge", "antalgie de decharge"), layAlternative: "elle ne pose pas le pied à cause de la douleur" },
  { forbidden: "antalgique", pattern: pattern("antalgique"), layAlternative: "calmant / médicament contre la douleur" },
  { forbidden: "fébricule", pattern: pattern("fébricule", "febricule"), layAlternative: "petite fièvre / un peu de température" },
  { forbidden: "hyperpyrexie", pattern: pattern("hyperpyrexie"), layAlternative: "très grosse fièvre" },
  // Cardio
  { forbidden: "palpitations", pattern: pattern("palpitations"), layAlternative: "il sent son cœur battre fort / cœur qui s'emballe" },
  { forbidden: "bradycardie", pattern: pattern("bradycardie", "bradycarde"), layAlternative: "cœur qui bat lentement" },
  { forbidden: "tachycardie", pattern: pattern("tachycardie", "tachycarde"), layAlternative: "cœur qui bat vite" },
  { forbidden: "anasarque", pattern: pattern("anasarque"), layAlternative: "œdème généralisé / il est gonflé partout" },
];

// Détecte un terme banni dans un texte et retourne la première occurrence
// (utilisé par les tests E2E gated et par logLeaksIfAny). Renvoie `null`
// si aucun terme banni.
export interface DetectedLayLeak {
  forbidden: string;
  layAlternative: string;
  matchedAt: number;
  matchedText: string;
}

export function detectLayLeaks(reply: string): DetectedLayLeak[] {
  const leaks: DetectedLayLeak[] = [];
  if (!reply) return leaks;
  for (const c of LAY_CONSTRAINTS) {
    const m = reply.match(c.pattern);
    if (m && m.index !== undefined) {
      leaks.push({
        forbidden: c.forbidden,
        layAlternative: c.layAlternative,
        matchedAt: m.index,
        matchedText: m[0],
      });
    }
  }
  return leaks;
}

// Construit la directive markdown injectée dans le system prompt des
// participants en registre `lay`. La directive est explicite,
// énumérative (le LLM tend à respecter ce type de contrainte structurée)
// et fournit systématiquement l'alternative grand public — pas seulement
// l'interdit.
//
// La directive est volontairement courte (~ 30 termes) pour ne pas
// gonfler le prompt à chaque tour ; les termes les plus exotiques
// (ex. « anasarque ») sont quand même listés parce que leur mention par
// un profane est immédiatement détectée comme un faux par le candidat.
export function buildLayVocabularyDirective(): string {
  const lines = LAY_CONSTRAINTS.map(
    (c) => `- ❌ « ${c.forbidden} » → ✅ ${c.layAlternative}`,
  ).join("\n");
  return `

## VOCABULAIRE GRAND PUBLIC OBLIGATOIRE
Tu n'es pas soignant·e. Utilise EXCLUSIVEMENT le langage que tu emploierais avec ton médecin de famille, ta famille ou un voisin. Les termes médicaux suivants sont INTERDITS — utilise systématiquement leur équivalent grand public :

${lines}

Règle générale : si un mot ressemble à du jargon, reformule-le avec ce que tu RESSENS ou ce que tu OBSERVES, pas avec un nom de symptôme savant.`;
}
