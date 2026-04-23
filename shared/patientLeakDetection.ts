// Blacklists et détecteurs de leaks de findings — partagés entre client (tests
// de non-régression, judge futur) et serveur (log post-génération). Pas de
// dépendance DOM / Node-spécifique pour rester iso-environnement.

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/œ/g, "oe")
    .replace(/æ/g, "ae")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/['']/g, "'");
}

// ───────── PATIENT ─────────
// Tokens que le PATIENT (sujet de la station) ne doit pas produire comme
// findings objectifs. Un patient adulte peut en rapporter s'il les a entendus
// d'un soignant antérieur (« on m'a dit que ma saturation baissait ») — ces
// cas restent autorisés. La liste cible les auto-diagnostics cliniques et les
// inventions éponymes de findings.
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

// ───────── CAREGIVER ─────────
// Liste additionnelle pour l'accompagnant·e (parent/proche). Un parent n'a pas
// d'instrument (stéthoscope, saturomètre, tensiomètre), n'emploie pas les
// verbes de soignant (« j'ai mesuré », « à l'auscultation on trouve »), ni le
// jargon clinique (« tachypnée », « cyanose », « fébrile »). Ces termes sont
// donc interdits EN PLUS des termes patient.
export const CAREGIVER_EXTRA_BLACKLIST: string[] = [
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
  "murmure vesiculaire",
  "pale cutanee",
  "palure cutanee",
];

export const CAREGIVER_FINDING_BLACKLIST: string[] = [
  ...PATIENT_FINDING_BLACKLIST,
  ...CAREGIVER_EXTRA_BLACKLIST,
];

// ───────── Détecteurs ─────────

export function detectPatientFindingLeaks(reply: string): string[] {
  return detectLeaks(reply, PATIENT_FINDING_BLACKLIST);
}

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
