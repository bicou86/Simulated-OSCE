// Phase 4 J2 — Routeur d'adresse multi-profils.
//
// Détermine, pour un message du candidat, à quel participant celui-ci
// s'adresse. 100 % heuristique : pas de LLM, pas de fetch, pas d'I/O.
// Tables de patterns statiques + scoring déterministe.
//
// Stratégies (ordre de priorité) :
//   a) Tag explicite       : « [À Emma] … », « [a maman] … »
//   b/c) Vocatif/role      : « Emma, … », « Maman, … », « Madame Bettaz, … »
//   d) Marqueur de bascule : « Et vous ? », « Et de votre côté ? »
//   e) Sticky              : aucun marqueur ⇒ on garde currentSpeaker
//   f) Mono-patient        : un seul participant ⇒ toujours lui
//
// Sortie : { targetId, confidence, reason }. confidence ∈ {high, medium, low,
// ambiguous}. Si ambigu, targetId === null et l'UI doit demander une
// clarification au candidat — pas de routage silencieux.
//
// Le routeur ne maintient PAS d'état : c'est l'orchestrateur (côté
// simulation) qui mémorise currentSpeaker entre les tours et le repasse au
// routeur à chaque appel.

import type { Participant } from "@shared/station-schema";

export type RouteConfidence = "high" | "medium" | "low" | "ambiguous";

export interface RouteResult {
  targetId: string | null;
  confidence: RouteConfidence;
  reason: string;
  matchedTokens?: string[];
  candidateIds?: string[];
}

export interface RouteAddressInput {
  message: string;
  participants: Participant[];
  currentSpeaker?: string | null;
}

// ─── Normalisation ─────────────────────────────────────────────────────────
//
// On lowercase, on retire les diacritiques (NFD + suppression des combining
// marks), on remplace apostrophes et la plupart des ponctuations par des
// espaces. Les points sont CONSERVÉS pour distinguer « M. » / « Mme. » des
// initiales aléatoires (heuristique honorifique infra).
function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[’‘']/g, " ")
    .replace(/[,;:!?()\[\]"«»]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Bordage par début/fin de chaîne ou par tout caractère non alphanumérique
// (le \b standard ne joue pas bien avec les apostrophes et les points).
function containsWord(haystack: string, needle: string): boolean {
  if (!needle) return false;
  const escaped = escapeRegex(needle);
  const re = new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, "i");
  return re.test(haystack);
}

// ─── Dérivation des tokens d'adresse pour un participant ──────────────────
//
// proper : fragments de noms propres (« emma », « delacroix », « emma delacroix »)
// role   : alias génériques (« maman », « madame », « monsieur ») dérivés
//          du préfixe du nom du participant. Permet de matcher « Madame, … »
//          sans connaître le prénom.

interface DerivedTokens {
  proper: string[];
  role: string[];
}

// Préfixes "rôle relationnel" : « Mère d'Emma … », « Parent de Liam … ».
// Ces préfixes décrivent une relation, pas un nom propre — on remplit `role`
// et on n'extrait PAS de proper-tokens (sinon « delacroix » serait à la fois
// un token d'Emma et de la mère, écrasant les disambiguations).
const ROLE_PATTERNS: Array<{ test: RegExp; tokens: string[] }> = [
  {
    test: /^(m[èe]re|maman)\b/,
    tokens: ["maman", "mere", "madame", "ma maman", "ma mere"],
  },
  {
    test: /^(p[èe]re|papa)\b/,
    tokens: ["papa", "pere", "monsieur", "mon papa", "mon pere"],
  },
  {
    test: /^parent\b/,
    tokens: ["parent", "maman", "papa", "mere", "pere", "madame", "monsieur"],
  },
];

// Préfixes "honorifiques" : « M. Louis Bettaz », « Mme Borloz ». On garde
// les tokens propres (Louis, Bettaz) ET on ajoute le titre comme alias rôle.
const HONORIFIC_PATTERNS: Array<{ test: RegExp; tokens: string[] }> = [
  { test: /^(m\.\s|mr\.?\s|monsieur\s)/i, tokens: ["monsieur", "m"] },
  {
    test: /^(mme\.?\s|mrs\.?\s|madame\s|mademoiselle\s|mlle\.?\s)/i,
    tokens: ["madame", "mademoiselle", "mme"],
  },
];

function deriveTokens(p: Participant): DerivedTokens {
  const norm = normalize(p.name);
  const proper: string[] = [];
  const role: string[] = [];

  // 1. Préfixe relationnel ⇒ tokens de rôle, pas d'extraction de proper.
  for (const rp of ROLE_PATTERNS) {
    if (rp.test.test(norm)) {
      role.push(...rp.tokens);
      // Le « id » du participant peut servir de tag explicite secondaire
      // (« [à parent] » ⇒ on ajoute aussi l'id comme proper-token).
      proper.push(normalize(p.id));
      return { proper, role };
    }
  }

  // 2. Préfixe honorifique ⇒ tokens de titre + extraction proper sur le reste.
  let nameForProper = norm;
  for (const hp of HONORIFIC_PATTERNS) {
    if (hp.test.test(norm)) {
      role.push(...hp.tokens);
      nameForProper = norm.replace(hp.test, "").trim();
      break;
    }
  }

  // 3. Extraction des fragments propres (prénom, nom, prénom-nom combiné).
  if (nameForProper) {
    const parts = nameForProper.split(/[\s/]+/).filter((w) => w.length > 1);
    proper.push(...parts);
    if (parts.length >= 2) proper.push(parts.slice(0, 2).join(" "));
  }
  // Toujours ajouter l'id participant comme alias (utilisable dans tag).
  proper.push(normalize(p.id));

  return { proper, role };
}

// ─── Stratégie a) Tag explicite [À Nom] ───────────────────────────────────
//
// Le tag prend la priorité absolue : même si le corps du message contient un
// vocatif ambigu, l'intention du candidat est exprimée explicitement.

const EXPLICIT_TAG_RE = /^\s*\[\s*(?:[àa@]\s+)?([^\]]+?)\s*\]/i;

function matchExplicitTag(
  rawMessage: string,
  participants: Participant[],
): RouteResult | null {
  const m = rawMessage.match(EXPLICIT_TAG_RE);
  if (!m) return null;
  const target = normalize(m[1]);
  const matches = participants.filter((p) => {
    const t = deriveTokens(p);
    return (
      t.proper.includes(target) ||
      t.role.includes(target) ||
      normalize(p.name) === target ||
      normalize(p.id) === target
    );
  });
  if (matches.length === 1) {
    return {
      targetId: matches[0].id,
      confidence: "high",
      reason: `tag explicite « [${m[1].trim()}] »`,
      matchedTokens: [m[1].trim()],
    };
  }
  if (matches.length > 1) {
    // Tag ambigu (ex. « [à madame] » sur 2 femmes)
    return {
      targetId: null,
      confidence: "ambiguous",
      reason: `tag « [${m[1].trim()}] » matche ${matches.length} participants`,
      candidateIds: matches.map((p) => p.id),
      matchedTokens: [m[1].trim()],
    };
  }
  // Tag présent mais ne correspond à aucun participant.
  return {
    targetId: null,
    confidence: "ambiguous",
    reason: `tag « [${m[1].trim()}] » ne correspond à aucun participant`,
    candidateIds: participants.map((p) => p.id),
  };
}

// ─── Stratégie b/c) Vocatif et préfixe rôle dans la tête du message ──────
//
// Heuristique d'extraction de la « zone vocative » :
//   • s'il y a une virgule (ou un point-virgule/point) dans les 60 premiers
//     caractères normalisés, on prend tout ce qui la précède — c'est la
//     forme vocative typique « Maman, ... » / « Mademoiselle Delacroix, ... ».
//   • sinon on retombe sur les ~80 premiers caractères (cas « Charlotte ne
//     marche pas du tout ? » sans virgule).
//
// Pour chaque participant, on cumule un score :
//   • +3 par token propre (prénom, nom, prénom-nom) trouvé en mot entier
//   • +2 par token rôle (maman, madame…) trouvé en mot entier
// Le participant au plus haut score gagne. Ex æquo ⇒ ambigu.

const VOCATIVE_HEAD_LEN = 80;
const VOCATIVE_COMMA_WINDOW = 60;

// On découpe sur la PREMIÈRE ponctuation forte du message brut (la
// normalisation supprime virgules / points / etc., elle ne peut pas servir).
function extractVocativeZone(rawMessage: string): string {
  const window = rawMessage.slice(0, VOCATIVE_COMMA_WINDOW);
  const stop = window.search(/[,;.!?]/);
  const slice = stop > 0 ? rawMessage.slice(0, stop) : rawMessage.slice(0, VOCATIVE_HEAD_LEN);
  return normalize(slice);
}

function matchVocativeOrRole(
  rawMessage: string,
  participants: Participant[],
): RouteResult | null {
  const head = extractVocativeZone(rawMessage);
  if (!head) return null;

  const scored = participants
    .map((p) => {
      const tokens = deriveTokens(p);
      const matched: string[] = [];
      let score = 0;
      for (const t of tokens.proper) {
        if (containsWord(head, t)) {
          score += 3;
          matched.push(t);
        }
      }
      for (const t of tokens.role) {
        if (containsWord(head, t)) {
          score += 2;
          matched.push(t);
        }
      }
      return { p, score, matched };
    })
    .filter((s) => s.score > 0);

  if (scored.length === 0) return null;

  scored.sort((a, b) => b.score - a.score);
  const top = scored[0];
  const second = scored[1];

  if (second && second.score === top.score) {
    return {
      targetId: null,
      confidence: "ambiguous",
      reason: `vocatif ambigu (${scored.map((s) => s.p.id).join(", ")})`,
      candidateIds: scored.map((s) => s.p.id),
      matchedTokens: scored.flatMap((s) => s.matched),
    };
  }

  // Score ≥ 3 ⇒ au moins un proper-token, donc match nominatif clair = high.
  // Score < 3 ⇒ uniquement role-tokens (maman, madame seul), sans nom = medium.
  return {
    targetId: top.p.id,
    confidence: top.score >= 3 ? "high" : "medium",
    reason: `vocatif/rôle détecté (${top.matched.join(", ")})`,
    matchedTokens: top.matched,
  };
}

// ─── Stratégie d) Marqueur de rebascule ────────────────────────────────────
//
// « Et vous ? », « Et toi ? », « Et de votre côté ? » ⇒ on bascule sur l'autre
// participant. Suppose 2 participants exactement (sinon on ne sait pas vers
// qui basculer, ambigu).

// `\b` après « côté » échoue (le « é » n'est pas un word-char en regex sans
// flag /u) — on borde explicitement la fin par un blanc / une ponctuation /
// la fin de chaîne.
const SWITCH_RE = /(?:^|[\s,;.!?])(et\s+(?:vous|toi)|et\s+de\s+(?:votre|ta|ton)\s+c[oô]t[eé])(?=\s|[,.;!?]|$)/i;

function matchSwitchMarker(
  rawMessage: string,
  participants: Participant[],
  currentSpeaker: string | null,
): RouteResult | null {
  if (!SWITCH_RE.test(rawMessage)) return null;
  if (!currentSpeaker) return null;
  if (participants.length !== 2) return null;
  const other = participants.find((p) => p.id !== currentSpeaker);
  if (!other) return null;
  return {
    targetId: other.id,
    confidence: "medium",
    reason: `bascule (« et vous ? ») depuis ${currentSpeaker}`,
    matchedTokens: ["et vous"],
  };
}

// ─── Entrypoint ────────────────────────────────────────────────────────────

export function routeAddress(input: RouteAddressInput): RouteResult {
  const { message, participants, currentSpeaker = null } = input;

  if (!participants || participants.length === 0) {
    return {
      targetId: null,
      confidence: "ambiguous",
      reason: "aucun participant déclaré pour la station",
    };
  }

  // f) Mono-patient ⇒ toujours lui (rétrocompat 100 % stations historiques).
  if (participants.length === 1) {
    return {
      targetId: participants[0].id,
      confidence: "high",
      reason: "station mono-patient",
    };
  }

  // a) Tag explicite (priorité absolue)
  const tag = matchExplicitTag(message, participants);
  if (tag) return tag;

  // b/c) Vocatif / préfixe rôle
  const voc = matchVocativeOrRole(message, participants);
  if (voc) return voc;

  // d) Marqueur de rebascule
  const sw = matchSwitchMarker(message, participants, currentSpeaker);
  if (sw) return sw;

  // e) Sticky : pas de marqueur mais un interlocuteur courant valide.
  if (currentSpeaker && participants.some((p) => p.id === currentSpeaker)) {
    return {
      targetId: currentSpeaker,
      confidence: "low",
      reason: "sticky (aucun marqueur d'adresse, on garde l'interlocuteur courant)",
    };
  }

  // Pas de marqueur, pas de currentSpeaker, station multi-profils ⇒ ambigu.
  return {
    targetId: null,
    confidence: "ambiguous",
    reason: "multi-profil sans marqueur ni interlocuteur courant — clarification requise",
    candidateIds: participants.map((p) => p.id),
  };
}
