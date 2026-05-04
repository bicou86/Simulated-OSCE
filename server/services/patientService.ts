// Service Patient — isolation stricte des données patient.
// N'accède JAMAIS aux fichiers Examinateur_*.json.
// Charge la station patient à la demande + construit le system prompt + appelle OpenAI.

import { promises as fs } from "fs";
import OpenAI from "openai";
import { getOpenAIKey } from "../lib/config";
import { logRequest } from "../lib/logger";
import { extractAge, extractSex, type PatientSex } from "../lib/patientSex";
import {
  resolveInterlocutor,
  type Interlocutor,
} from "../lib/patientInterlocutor";
import { loadPrompt } from "../lib/prompts";
import { findChildStations, getStationMeta, patientFilePath } from "./stationsService";
import {
  buildSpecialtyDirective,
  selectSpecialtyProfile,
} from "./specialtyProfileSelector";
import {
  detectCaregiverFindingLeaks,
  detectPatientFindingLeaks,
} from "@shared/patientLeakDetection";
import {
  getStationParticipants,
  legalContextSchema,
  type ConversationSpeakerRole,
  type LegalContext,
  type Participant,
  type ParticipantRole,
  type ParticipantSections,
} from "@shared/station-schema";
import { routeAddress, type RouteResult } from "./addressRouter";
import { buildLayVocabularyDirective } from "../lib/vocabularyConstraints";
import { buildLegalLeakDirective } from "../lib/legalLexicon";

// Cache des fichiers JSON déjà parsés (clé = filename).
const fileCache = new Map<string, any[]>();

async function loadFile(filename: string): Promise<any[]> {
  const cached = fileCache.get(filename);
  if (cached) return cached;
  const content = await fs.readFile(patientFilePath(filename), "utf-8");
  const parsed = JSON.parse(content) as { stations: any[] };
  fileCache.set(filename, parsed.stations);
  return parsed.stations;
}

export class StationNotFoundError extends Error {
  constructor(public readonly stationId: string) {
    super(`Station ${stationId} introuvable dans le catalogue patient.`);
    this.name = "StationNotFoundError";
  }
}

// Retourne la station patient complète (script, histoire, habitudes, etc.).
export async function getPatientStation(stationId: string): Promise<any> {
  const meta = getStationMeta(stationId);
  if (!meta) throw new StationNotFoundError(stationId);
  const stations = await loadFile(meta.patientFile);
  const station = stations[meta.indexInFile];
  if (!station || station.id !== meta.fullId) {
    // Index désynchronisé — fallback par recherche ID.
    const fallback = stations.find((s) => s.id === meta.fullId);
    if (!fallback) throw new StationNotFoundError(stationId);
    return fallback;
  }
  return station;
}

// Phase 5 J1 — accès server-only au cadre médico-légal d'une station.
//
// Retourne :
//   • le `LegalContext` parsé Zod si la station l'a déclaré,
//   • `null` sinon (rétrocompat 100 % stations sans qualification).
//
// Cet helper est consommé par l'évaluateur médico-légal J2
// (`/api/evaluation/legal`) — JAMAIS exposé via getPatientBrief ni
// injecté dans un prompt LLM (cf. META_FIELDS_TO_STRIP). C'est l'unique
// point d'entrée propre pour lire `legalContext.decision_rationale`,
// `expected_decision`, `red_flags`, etc.
export async function getLegalContext(stationId: string): Promise<LegalContext | null> {
  const station = await getPatientStation(stationId);
  const raw = (station as { legalContext?: unknown }).legalContext;
  if (raw === undefined || raw === null) return null;
  // safeParse pour ne pas crasher la chaîne si une station a un
  // legalContext malformé qui aurait échappé au validateur boot —
  // on retourne null + log d'audit plutôt que de throw côté évaluateur.
  const parsed = legalContextSchema.safeParse(raw);
  if (!parsed.success) {
    // eslint-disable-next-line no-console
    console.warn(
      `[getLegalContext] ${stationId}: legalContext malformé, ignoré.`,
      parsed.error.issues,
    );
    return null;
  }
  return parsed.data;
}

export interface PatientBrief {
  stationId: string;
  setting: string;
  patientDescription: string;
  vitals: Record<string, string>;
  phraseOuverture: string;
  phraseOuvertureComplement?: string;
  sex: PatientSex;
  age?: number;
  interlocutor: Interlocutor;
  stationType?: string;   // inféré par stationsService, optionnel pour rétrocompat tests
  // Phase 4 J2 — composition multi-profils. Vide pour les stations historiques.
  participants?: Participant[];
  // ID du participant qui répond par défaut au tout premier tour (T0). Sert
  // au client à initialiser `currentSpeakerId` sans avoir à réimplémenter
  // l'heuristique de défaut côté front. Pour les stations mono-patient,
  // c'est l'unique participant. Pour les multi-profils, on s'aligne sur
  // l'interlocuteur résolu par patientInterlocutor (parent vs self).
  defaultSpeakerId?: string;
  // Phase 9 J2 — découpage temporel chronométré pour les stations doubles
  // partie 2 (Bug 3a). Absent (undefined) pour les 287 stations classiques :
  // l'UI retombe sur la durée legacy 13 min unique. Présent pour
  // RESCOS-64-P2 : 4 min « preparation » silencieuse + 9 min « presentation »
  // examinateur (cf. shared/station-schema.ts:stationPhaseSchema).
  phases?: Array<{ id: string; label: string; minutes: number; kind: "silent" | "examiner" }>;
  // Phase 9 J2 — consigne candidat orientée présentation pour partie 2
  // (Bug 3b). L'UI affiche `consigneCandidat` prioritairement à
  // `patientDescription` quand il est présent (fallback). Absent (undefined)
  // pour les 287 stations classiques.
  consigneCandidat?: string;
  // Phase 9 J3 — Bug 2 : si la station courante (P1) a une partie 2 dans
  // le catalogue (lien `parentStationId` + suffixe -P2), on expose ici le
  // shortId de la P2 pour que l'UI puisse afficher l'écran intermédiaire
  // de transition automatique en fin de P1. Champ omis (undefined) pour :
  //   • les 286 stations classiques sans P2
  //   • RESCOS-64-P2 elle-même (pas de P3 dans le corpus J3)
  // Calculé à la volée via `findChildStations(stationId)`. Aucun appel
  // LLM, lecture O(n) du catalog en mémoire.
  nextPartStationId?: string;
  // Phase 9 J4 — Q-A10 : si la station courante est une P2 (i.e. son meta
  // catalog porte `parentStationId`), on l'expose dans le brief HTTP pour
  // que l'UI /evaluation puisse détecter le contexte « stations doubles »
  // et lire le résultat P1 depuis sessionStorage `osce.eval.${parentStationId}`
  // (rendu du bilan combiné, dette 7). Le champ est expressément distinct
  // de `nextPartStationId` (qui pointe P1→P2 ; ici on pointe P2→P1). Champ
  // omis (undefined) pour les 287 stations sans parent (286 classiques +
  // RESCOS-64 P1). META_FIELDS_TO_STRIP retire ce champ du JSON station
  // injecté au LLM patient (invariant Phase 8 J2 préservé) — on le
  // recompose explicitement ici depuis le catalog (meta), pas depuis le
  // payload station brut.
  parentStationId?: string;
}

// "Feuille de porte" + phrase d'ouverture — tout ce dont l'UI a besoin côté étudiant :
// elle peut afficher les signes vitaux / cadre / description sans faire d'appel LLM.
// Aucune donnée de scoring ni script anamnèse complet n'est renvoyée.
// `sex` est déduit de `patient_description` par extractSex (cache mémoire).
// `stationType` est repris depuis le catalog (inférence déterministe au boot).
//
// Phase 4 J2 — `participants[]` (si la station est multi-profils) et
// `defaultSpeakerId` (le participant qui parle par défaut à T0) sont exposés
// pour permettre au client de threader `currentSpeakerId` dans ses requêtes
// /chat sans avoir à recalculer le défaut.
export async function getPatientBrief(stationId: string): Promise<PatientBrief> {
  const station = await getPatientStation(stationId);
  const patientDescription = station.patient_description ?? "";
  const sex = extractSex(patientDescription);
  const age = extractAge(station.age, patientDescription);
  const interlocutor = resolveInterlocutor({ patientDescription, age, sex });
  const meta = getStationMeta(stationId);
  const participants = getStationParticipants(station);
  const defaultSpeakerId = computeDefaultSpeakerId(participants, interlocutor);
  const isMultiProfile =
    Array.isArray((station as { participants?: unknown }).participants) &&
    ((station as { participants: unknown[] }).participants).length >= 2;
  // Phase 9 J2 — propagation phases + consigneCandidat (additifs stricts).
  // Les champs sont absents pour les 287 stations historiques ; présents
  // pour RESCOS-64-P2 (Patient_RESCOS_4.json partie 2). Aucun calcul ni
  // valeur synthétisée : on relit tels quels depuis la fixture, puis on
  // les omet de la réponse HTTP s'ils ne sont pas définis (undefined →
  // sérialisation JSON les supprime, baseline byteLength des stations
  // legacy strictement inchangée).
  const rawPhases = (station as { phases?: unknown }).phases;
  const phases = Array.isArray(rawPhases) ? (rawPhases as PatientBrief["phases"]) : undefined;
  const consigneCandidat =
    typeof (station as { consigneCandidat?: unknown }).consigneCandidat === "string"
      ? ((station as { consigneCandidat: string }).consigneCandidat)
      : undefined;
  // Phase 9 J3 — calcul de `nextPartStationId` : on consulte le catalog
  // pour trouver une station enfant (lien parentStationId + suffixe -P2$).
  // En J3, seul RESCOS-64 → RESCOS-64-P2. Les 286 autres stations sans P2
  // reçoivent `undefined` (champ omis du JSON HTTP, byteLength inchangé).
  // Si plusieurs enfants existent (corpus futur), on prend le premier
  // dans l'ordre du catalog (cohérent avec listStations() : tri stable).
  const children = findChildStations(stationId);
  const nextPartStationId = children.length > 0 ? children[0].id : undefined;
  // Phase 9 J4 — Q-A10 : propagation `parentStationId` depuis le meta
  // catalog (Phase 8 J1). Lecture O(1), pas de LLM. Présent uniquement
  // pour les stations P2 (= 1/288 stations en J4 : RESCOS-64-P2). Pour
  // les 287 autres stations, undefined → omis du JSON HTTP (baseline
  // byteLength inchangée).
  const parentStationId = meta?.parentStationId;
  return {
    stationId,
    setting: station.setting ?? "",
    patientDescription,
    vitals: station.vitals ?? {},
    phraseOuverture: station.ouverture ?? station.phrase_ouverture ?? "",
    phraseOuvertureComplement: station.ouverture_complement ?? station.phrase_ouverture_complement,
    sex,
    age,
    interlocutor,
    stationType: meta?.stationType,
    // On expose `participants` UNIQUEMENT pour les stations multi-profils
    // déclarées (≥ 2). Pour les mono-patient legacy, l'helper synthétise un
    // participant unique mais l'UI n'a pas besoin de l'afficher — le label
    // historique « Patient (voix IA) » reste suffisant.
    participants: isMultiProfile ? participants : undefined,
    defaultSpeakerId,
    phases,
    consigneCandidat,
    nextPartStationId,
    parentStationId,
  };
}

// Choisit le participant qui répond par défaut au tout premier tour. Mappe
// l'interlocuteur résolu par patientInterlocutor (parent vs self) sur un id
// participant. Si aucun mapping ne fonctionne (fallback paranoïaque), on
// retombe sur le premier participant déclaré.
function computeDefaultSpeakerId(
  participants: Participant[],
  interlocutor: Interlocutor,
): string {
  if (participants.length === 0) return "patient";
  if (interlocutor.type === "parent") {
    const acc = participants.find((p) => p.role === "accompanying");
    if (acc) return acc.id;
  }
  const pat = participants.find((p) => p.role === "patient");
  if (pat) return pat.id;
  return participants[0].id;
}

// Directive additionnelle injectée quand l'étudiant interagit au clavier plutôt qu'à la voix.
const TEXT_MODE_DIRECTIVE = `

## ADAPTATION
La conversation se déroule en mode texte, pas en mode vocal. Tu peux répondre avec des phrases légèrement plus construites, mais reste naturel et bref.`;

// Directive injectée quand l'interlocuteur est un parent présent à côté d'un
// patient qui parle (enfant en âge scolaire). Le patient parle, le parent peut
// compléter. Le cas `type === "parent"` est géré via un prompt dédié
// (`caregiver.md`), pas via une directive additive.
function interlocutorDirective(interlocutor: Interlocutor): string {
  if (interlocutor.type === "self" && interlocutor.parentPresent) {
    return `

## CONTEXTE D'INTERLOCUTION
Un parent est présent dans la pièce. Tu réponds toi-même aux questions du médecin (tu es le patient, un enfant en âge scolaire), mais le parent peut intervenir brièvement pour préciser des éléments factuels (dates, antécédents, chronologie) si tu hésites. Reste en personnage ; c'est à toi de parler en priorité.`;
  }
  return "";
}

// Bloc d'identification du patient injecté dans le prompt caregiver : même
// valeur logique que l'ancienne directive "le patient est X", mais consommé par
// caregiver.md qui a son propre registre naïf.
function caregiverIdentityBlock(
  interlocutor: Interlocutor,
  station: any,
): string {
  const role =
    interlocutor.parentRole === "mother" ? "la mère" :
    interlocutor.parentRole === "father" ? "le père" :
    "l'accompagnant·e";
  const patientName = station.nom ?? "le patient";
  const age = station.age ? ` (${station.age})` : "";
  return `

## PATIENT DONT TU ES L'ACCOMPAGNANT·E
Tu es ${role} de ${patientName}${age}. Toutes les règles du prompt s'appliquent en te nommant toi comme interlocuteur du médecin, pas le patient.`;
}

// Résout l'interlocuteur effectif pour une station (parent vs self), en
// factorisant la logique partagée entre buildSystemPrompt (prompt routing) et
// runPatientChat / streamPatientChat (leak detection post-génération).
export async function resolveStationInterlocutor(
  stationId: string,
): Promise<{ station: any; interlocutor: Interlocutor }> {
  const station = await getPatientStation(stationId);
  const patientDescription = station.patient_description ?? "";
  const sex = extractSex(patientDescription);
  const age = extractAge(station.age, patientDescription);
  const interlocutor = resolveInterlocutor({ patientDescription, age, sex });
  return { station, interlocutor };
}

// Construit le system prompt complet : markdown + bloc <station_data>.
// Quand l'interlocuteur est un parent/accompagnant, on charge `caregiver.md`
// au lieu de `patient.md` — le caregiver prompt a son propre registre naïf
// non-médical, sa propre blacklist élargie (verbes de mesure instrumentale,
// jargon soignant) et ses propres few-shots. Le cas `self + parent présent`
// reste sur patient.md + une directive additive.
//
// Phase 4 J2 — overload multi-profils :
//   • Si `target` est fourni (issu du routeur d'adresse pour une station
//     multi-profils), on choisit le template en fonction de SON rôle
//     (`accompanying` ⇒ caregiver.md, sinon patient.md) et on injecte une
//     directive « TU INCARNES » + une liste « AUTRES PRÉSENTS » pour que
//     le LLM ne réponde pas au nom du mauvais profil.
//   • Sans `target`, on conserve strictement la logique pré-J2 (résolution
//     parent vs self via patientInterlocutor). Aucune régression sur les
//     279 stations mono-patient legacy.
export async function buildSystemPrompt(
  stationId: string,
  mode: "voice" | "text",
  target?: Participant,
  allParticipants?: Participant[],
): Promise<string> {
  // Phase 9 J1 — branche examinateur pour stations doubles partie 2
  // (Bug 3c E2E Phase 8). Détection stricte par suffixe -P2$ (cf.
  // extractShortId Phase 8 J2). Le flow examinateur N'INJECTE PAS le
  // narratif patient (le candidat connaît déjà le cas et présente sa
  // restitution clinique au spécialiste). Source unique des questions :
  // `examinerQuestion` de chaque item p1-p15 dans la grille
  // `presentation` côté Examinateur_*.json. Zéro effet sur les 287
  // autres stations (mono-patient ou multi-profils).
  if (/-P2$/.test(stationId)) {
    return buildExaminerSystemPrompt(stationId);
  }

  const { station, interlocutor } = await resolveStationInterlocutor(stationId);

  let useCaregiverPrompt: boolean;
  let identityBlock: string;
  let othersBlock = "";

  if (target) {
    useCaregiverPrompt = target.role === "accompanying" || target.role === "witness";
    identityBlock = useCaregiverPrompt
      ? caregiverParticipantIdentityBlock(target, station)
      : patientParticipantIdentityBlock(target);
    if (allParticipants && allParticipants.length >= 2) {
      othersBlock = otherParticipantsBlock(allParticipants, target);
    }
  } else {
    useCaregiverPrompt = interlocutor.type === "parent";
    identityBlock = useCaregiverPrompt
      ? caregiverIdentityBlock(interlocutor, station)
      : interlocutorDirective(interlocutor);
  }

  const template = await loadPrompt(useCaregiverPrompt ? "caregiver" : "patient");

  // Phase 3 J3 — injection déterministe d'une directive pointant vers le
  // profil de spécialité à prioriser (gynéco / adolescent / palliatif), si
  // la station porte les flags correspondants. Zéro LLM : heuristique pure
  // sur `register` + âge, cf. specialtyProfileSelector.ts. Les 279 stations
  // sans flag ni âge éligible reçoivent une directive vide (rétrocompat).
  const profile = selectSpecialtyProfile(station as Record<string, unknown>);
  const specialtyDirective = buildSpecialtyDirective(
    profile,
    useCaregiverPrompt ? "caregiver" : "patient",
  );

  // Phase 4 J3 — registre lay : on injecte une directive énumérative
  // listant les termes médicaux à proscrire et leurs équivalents grand
  // public. Active uniquement quand `target.vocabulary === 'lay'` (les
  // stations mono-patient legacy n'ont pas de target → pas d'effet).
  const vocabularyDirective =
    target && target.vocabulary === "lay" ? buildLayVocabularyDirective() : "";

  // Phase 5 J3 — cloisonnement médico-légal : si la station déclare un
  // legalContext, on injecte une directive de blacklist (codes de loi
  // spécifiques + concepts juridiques transversaux) PLUS un garde-fou
  // sémantique. Conditionnel strict : aucun effet sur les stations
  // sans legalContext (= 285/288 stations historiques inchangées). Le
  // bloc legalContext lui-même reste strippé via META_FIELDS_TO_STRIP
  // (cf. invariant Phase 5 A : le patient ne voit jamais le rationale).
  const rawLegal = (station as { legalContext?: { applicable_law?: string[] } })
    .legalContext;
  const legalLeakDirective =
    rawLegal && Array.isArray(rawLegal.applicable_law)
      ? buildLegalLeakDirective(rawLegal.applicable_law)
      : "";

  // Phase 4 J3 — cloisonnement : si la station déclare des
  // `participantSections` ET qu'on a un target avec un knowledgeScope, on
  // filtre les sections sensibles avant injection. Pour les stations sans
  // règles, le filtre est l'identité (les invariants ECOS legacy
  // s'appliquent à l'identique).
  //
  // Phase 5 J3 — cas mono-patient avec legalContext :
  // si target est absent (chemin legacy 285+ stations), on conserve
  // strictement le prompt historique sauf pour `legalContext` qui DOIT
  // être strippé (sinon le rationale fuiterait au LLM patient — cf.
  // invariant Phase 5 A). Pour les autres META_FIELDS (id, tags, …) on
  // conserve la sémantique legacy d'avant J3 par souci de
  // non-régression sur le prompt des stations historiques.
  const filteredStation = target
    ? filterStationByScope(
        station as Record<string, unknown>,
        target.knowledgeScope,
      )
    : stripLegalContextOnly(station as Record<string, unknown>);

  const dataBlock = `\n\n<station_data>\n${JSON.stringify(filteredStation, null, 2)}\n</station_data>`;
  const modeDirective = mode === "text" ? TEXT_MODE_DIRECTIVE : "";
  return (
    template +
    identityBlock +
    othersBlock +
    vocabularyDirective +
    legalLeakDirective +
    specialtyDirective +
    modeDirective +
    dataBlock
  );
}

// ─── Phase 9 J1 — flow examinateur (stations doubles partie 2) ────────────
//
// Le system prompt examinateur N'INJECTE PAS de bloc <station_data>
// (zéro narratif patient — le candidat connaît déjà le cas) et N'UTILISE
// PAS les directives patient simulé (specialty, lay vocabulary, legal
// leak, mode voix/texte). Le template `examiner.md` cadre seul le rôle ;
// la seule injection dynamique est la liste numérotée des 15 questions
// examinateur (`{{examinerQuestions}}`).
//
// Source de vérité : le champ `examinerQuestion` de chaque item p1-p15
// dans la grille `presentation` côté Examinateur_*.json (champ additif
// Phase 9 J1, schéma optionnel).
export async function buildExaminerSystemPrompt(stationId: string): Promise<string> {
  const template = await loadPrompt("examiner");
  const questions = await loadExaminerQuestions(stationId);
  if (questions.length === 0) {
    throw new Error(
      `Phase 9 J1 — aucune examinerQuestion trouvée pour ${stationId}. ` +
      `Vérifier la grille presentation côté Examinateur_*.json.`,
    );
  }
  const formatted = questions.map((q, i) => `${i + 1}. ${q}`).join("\n");
  return template.replace("{{examinerQuestions}}", formatted);
}

// Charge les 15 questions examinateur ordonnées depuis la grille
// `presentation` du fichier Examinateur_*.json correspondant à la
// station partie 2. Import dynamique de getEvaluatorStation pour éviter
// le cycle patientService ↔ evaluatorService (evaluatorService importe
// déjà `getLegalContext` depuis ce fichier).
async function loadExaminerQuestions(stationId: string): Promise<string[]> {
  const { getEvaluatorStation } = await import("./evaluatorService");
  const evaluatorStation = await getEvaluatorStation(stationId);
  const grille = (
    evaluatorStation as {
      grille?: { presentation?: Array<{ id: string; examinerQuestion?: string }> };
    }
  ).grille;
  const items = grille?.presentation ?? [];
  return items
    .filter(
      (item): item is { id: string; examinerQuestion: string } =>
        typeof item.examinerQuestion === "string" && item.examinerQuestion.length > 0,
    )
    .map((item) => item.examinerQuestion);
}

// Bloc d'identité injecté quand le target est un participant `patient` —
// le LLM doit incarner CE patient précisément (utile sur les stations où
// plusieurs profils coexistent : « Tu es Emma, 16 ans »).
function patientParticipantIdentityBlock(target: Participant): string {
  const ageStr = typeof target.age === "number" ? `, ${target.age} ans` : "";
  return `\n\n## TU INCARNES
Tu es ${target.name}${ageStr}, le ou la patient·e que le médecin examine. Le médecin t'adresse SA QUESTION ACTUELLE personnellement. Réponds en ton nom propre, à la première personne, sans parler à la place de quelqu'un d'autre.`;
}

// Bloc d'identité injecté quand le target est un participant `accompanying`
// (ou `witness`) — variante du caregiverIdentityBlock historique mais qui
// utilise le NOM EXPLICITE du participant target (pas l'inférence
// parentRole legacy). Le patient sujet de la station est référencé via le
// premier `participants[role==='patient']` ou, à défaut, le champ legacy
// `nom`.
function caregiverParticipantIdentityBlock(
  target: Participant,
  station: any,
): string {
  const patientName =
    typeof station.nom === "string" && station.nom.length > 0
      ? station.nom
      : "le patient";
  return `\n\n## TU INCARNES
Tu es ${target.name}, accompagnant·e de ${patientName}. Le médecin t'adresse SA QUESTION ACTUELLE en tant qu'accompagnant·e. Réponds en ton nom propre — n'incarne pas ${patientName} à sa place.`;
}

// ─── Phase 4 J3 — cloisonnement par knowledgeScope ────────────────────────
//
// Filtre le JSON de la station avant injection dans le prompt LLM en
// fonction des règles déclarées par `participantSections` ET du scope du
// participant cible. Sections non listées = visibles à tous (rétrocompat
// 100 % stations historiques).
//
// L'algorithme :
//   • clone profond du JSON station (on ne mute pas le cache)
//   • supprime explicitement `participantSections` de la copie envoyée au
//     LLM (la table de règles n'a pas à être révélée au modèle)
//   • pour chaque entrée de la table :
//       – si la section est visible (intersection des tags non vide), on
//         laisse intact ;
//       – sinon on supprime le chemin pointé.
//   • support des chemins pointés à 1 ou 2 niveaux (`a` ou `a.b`) — c'est
//     suffisant pour les patterns présents dans nos JSON ECOS (top-level
//     ou sous-clé directe d'un objet).
function deleteAtPath(obj: Record<string, unknown>, path: string): void {
  const parts = path.split(".");
  if (parts.length === 1) {
    delete obj[parts[0]];
    return;
  }
  let cur: unknown = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (!cur || typeof cur !== "object" || Array.isArray(cur)) return;
    cur = (cur as Record<string, unknown>)[parts[i]];
  }
  if (cur && typeof cur === "object" && !Array.isArray(cur)) {
    delete (cur as Record<string, unknown>)[parts[parts.length - 1]];
  }
}

// Champs systématiquement retirés du JSON station avant injection dans le
// prompt LLM cible-spécifique. Ce sont des métadonnées catalogue/runtime
// qui (a) ne servent pas au LLM pour jouer son rôle et (b) peuvent leak
// involontairement le scénario complet :
//   • `id`, `tags` → titre + catégories qui révèlent le pitch (ex.
//     « RESCOS-70 - Contraception cachée + effets secondaires », tags
//     ["contraception", "effets-secondaires-pilule"]).
//   • `participants`, `participantSections` → métadonnées de routage
//     d'adresse et règles de cloisonnement (le LLM voit déjà son identité
//     via le bloc "TU INCARNES" et la liste "AUTRES PRÉSENTS" injectés
//     séparément).
//   • `register`, `patient_age_years`, `source_scenario` → flags Phase 3 J3
//     et compteurs internes, sans valeur narrative.
//   • `legalContext` (Phase 5 J1) → qualification médico-légale qui
//     contient `decision_rationale`, `applicable_law`, `expected_decision` —
//     informations que le patient/accompagnant ne doit JAMAIS connaître
//     (cf. invariant Phase 5 A : le patient ne cite jamais le bon cadre
//     légal lui-même). Le contexte est consulté via `getLegalContext`
//     côté serveur uniquement, par l'évaluateur médico-légal (J2).
//   • `medicoLegalReviewed` (Phase 6 J1/J2) → flag d'audit interne
//     indiquant qu'une station a été passée en revue par le triage
//     Phase 6. Métadonnée d'audit qui n'a aucune valeur narrative pour
//     le LLM ni client — strippée par défense.
const META_FIELDS_TO_STRIP = [
  "id",
  "tags",
  "register",
  "patient_age_years",
  "source_scenario",
  "participants",
  "participantSections",
  "legalContext",
  "medicoLegalReviewed",
  // Phase 8 J2 — `parentStationId` est une métadonnée d'architecture
  // (lien partie-1 / partie-2 pour les stations doubles). Aucune valeur
  // narrative pour le LLM patient ni le client. Strippé par défense
  // pour qu'aucun brief HTTP ni system prompt ne fuite l'arbre des
  // stations doubles.
  "parentStationId",
  // Phase 9 J2 — `phases` et `consigneCandidat` sont des métadonnées
  // UI (découpage chronométré + consigne candidat orientée présentation).
  // Sans valeur narrative pour le LLM patient. Strippées par défense
  // au cas où une fixture future combinerait `phases` ET flow patient
  // simulé (RESCOS-64-P2 utilise actuellement le flow examinateur, qui
  // n'injecte de toute façon pas de <station_data>). Le brief HTTP
  // construit explicitement ces champs hors du chemin de strip.
  "phases",
  "consigneCandidat",
  // Phase 11 J2 — `pedagogicalContent` est un bloc pédagogique additif
  // (résumé, présentation type, théorie, iconographie) destiné
  // EXCLUSIVEMENT au rapport PDF post-évaluation et à l'endpoint
  // /api/patient/:id/pedagogy. Strippé par défense-en-profondeur pour
  // l'invariant I13 (cloisonnement LLM patient) : si le LLM voyait ce
  // bloc, le candidat aurait des indices factuels durant la consultation,
  // ce qui briserait la simulation OSCE. Le brief HTTP ne le remonte pas
  // non plus (invariant I14 : isolation heuristique vs pédagogie).
  "pedagogicalContent",
];

// Phase 5 J3 — variante minimale du strip pour le chemin mono-patient
// legacy. On clone la station et on retire UNIQUEMENT `legalContext` —
// les autres META_FIELDS (id, tags, …) restent en place pour préserver
// strictement le prompt historique des 285+ stations sans qualification
// médico-légale (invariant J3 #3 : prompt mono-patient sans legalContext
// inchangé). Les stations Phase 5 (AMBOSS-24, USMLE-34, RESCOS-72) qui
// passent ici (target absent) bénéficient quand même du strip de leur
// legalContext.decision_rationale.
//
// Phase 6 J2 — strip aussi `medicoLegalReviewed` (flag d'audit interne
// qui ne doit jamais sortir vers le LLM ou le client).
// Phase 8 J2 — strip aussi `parentStationId` (métadonnée d'architecture
// stations doubles, pas de valeur narrative).
export function stripLegalContextOnly(
  station: Record<string, unknown>,
): Record<string, unknown> {
  const cloned = JSON.parse(JSON.stringify(station)) as Record<string, unknown>;
  delete cloned.legalContext;
  delete cloned.medicoLegalReviewed;
  delete cloned.parentStationId;
  // Phase 11 J3 — invariant I13 : strip aussi `pedagogicalContent` du
  // chemin mono-patient legacy. Sans ce delete, le bloc pédagogique
  // (résumé clinique, théorie, drapeaux rouges) fuiterait dans le
  // <station_data> du LLM patient et le candidat aurait des indices
  // factuels durant la consultation. Le strip côté multi-profils est
  // déjà couvert par META_FIELDS_TO_STRIP / filterStationByScope.
  delete cloned.pedagogicalContent;
  return cloned;
}

export function filterStationByScope(
  station: Record<string, unknown>,
  participantScope: string[],
): Record<string, unknown> {
  const sections = (station.participantSections ?? null) as
    | ParticipantSections
    | null;
  // Clone toujours, même sans rule, pour qu'on puisse en toute sécurité
  // déposer les champs métadonnées (qui ne doivent JAMAIS apparaître
  // dans le contexte LLM).
  const cloned = JSON.parse(JSON.stringify(station)) as Record<string, unknown>;
  for (const f of META_FIELDS_TO_STRIP) delete cloned[f];
  if (!sections) return cloned;
  const scopeSet = new Set(participantScope);
  for (const [path, requiredTags] of Object.entries(sections)) {
    const visible = requiredTags.some((t) => scopeSet.has(t));
    if (!visible) deleteAtPath(cloned, path);
  }
  return cloned;
}

// Liste les autres profils présents dans la pièce pour que le LLM sache
// qu'il ne doit PAS répondre à leur place tant que le médecin ne s'adresse
// pas à eux explicitement (la prochaine question pourra rebasculer ;
// l'orchestrateur côté serveur appellera buildSystemPrompt à nouveau avec
// le bon target).
function otherParticipantsBlock(
  participants: Participant[],
  target: Participant,
): string {
  const others = participants.filter((p) => p.id !== target.id);
  if (others.length === 0) return "";
  const list = others
    .map((p) => {
      const role =
        p.role === "patient"
          ? "patient·e"
          : p.role === "accompanying"
            ? "accompagnant·e"
            : "tiers";
      const ageStr = typeof p.age === "number" ? `, ${p.age} ans` : "";
      return `${p.name}${ageStr} (${role})`;
    })
    .join(" ; ");
  return `\n\n## AUTRES PERSONNES PRÉSENTES
${list}. Ces profils sont présents dans la pièce mais le médecin NE leur adresse PAS sa question actuelle. Ne réponds pas à leur place. Si le médecin change d'interlocuteur lors d'un prochain tour, on te le signalera explicitement.`;
}

// Détecte les leaks de findings objectifs dans la réponse LLM POST-génération.
// Mode log-only : on émet une ligne JSON structurée dans stdout (picked up par
// /var/log/* ou l'agrégateur Replit), on ne bloque pas la conversation. Sert
// de télémétrie pour renforcer le prompt ou passer en mode sanitize plus tard.
// Respecte l'invariant 3 ECOS : jamais d'invention — ici on détecte la sortie
// suspecte sans la censurer, pour ne pas briser l'expérience sur un faux
// positif tant que la liste n'est pas 100% stabilisée.
function logLeaksIfAny(
  stationId: string,
  interlocutorType: Interlocutor["type"],
  reply: string,
): void {
  if (!reply) return;
  const leaks = interlocutorType === "parent"
    ? detectCaregiverFindingLeaks(reply)
    : detectPatientFindingLeaks(reply);
  if (leaks.length === 0) return;
  // eslint-disable-next-line no-console
  console.info(JSON.stringify({
    event: "patient_response_leak",
    stationId,
    interlocutor: interlocutorType,
    leaks,
  }));
}

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

export interface ChatOptions {
  stationId: string;
  history: ChatTurn[];
  userMessage: string;
  mode: "voice" | "text";
  model?: string;
  // Phase 4 J2 — id du participant qui a parlé au tour précédent (sticky).
  // Le client le repasse à chaque requête. `null`/absent à T0 ⇒ on retombe
  // sur le défaut de la station (cf. computeDefaultSpeakerId).
  currentSpeakerId?: string | null;
  // Phase 9 J1 — discriminant flow conversationnel. Défaut "patient"
  // (rétrocompat). En "examiner" : bypass addressRouter, bypass leak
  // detection patient, system prompt examinateur via examiner.md.
  conversationMode?: "patient" | "examiner";
}

// Phase 4 J2 — résultat d'un tour de chat patient. Discriminated union :
//   • `reply` ⇒ réponse LLM normale, taggée du participant qui a répondu.
//   • `clarification_needed` ⇒ le routeur d'adresse a tranché « ambigu » :
//     on N'APPELLE PAS OpenAI, on demande à l'UI de clarifier à qui le
//     candidat parle. Pas de tokens consommés sur ambigu.
export interface PatientChatReply {
  type: "reply";
  reply: string;
  speakerId: string;
  // Phase 10 J3 — dette 6 : élargissement type ParticipantRole →
  // ConversationSpeakerRole (additif strict, ajout "examiner"). Permet
  // d'aligner speakerRole sur speakerId quand conversationMode="examiner".
  // Les flows patient/multi-profils continuent de retourner les 3 valeurs
  // historiques ("patient", "accompanying", "witness").
  speakerRole: ConversationSpeakerRole;
}
export interface PatientChatClarification {
  type: "clarification_needed";
  reason: string;
  // Le routeur d'adresse multi-profils retourne UNIQUEMENT des
  // ParticipantRole (3 valeurs historiques) — un examinateur n'est pas
  // candidat à clarification, le flow examinateur bypasse le routing.
  candidates: Array<{ id: string; name: string; role: ParticipantRole }>;
}
export type PatientChatOutcome = PatientChatReply | PatientChatClarification;

// Phase 4 J2 — résolution d'adresse pour un tour. Le routeur lui-même
// (addressRouter) reste pur. Cette fonction est l'orchestration : elle
// charge la station, construit la liste des participants effective (en
// synthétisant un participant unique pour les stations mono-patient
// legacy) et appelle le routeur.
//
// Trois sorties possibles :
//   • { kind: "ok", target } ⇒ on connaît le participant qui doit répondre,
//     on peut appeler le LLM avec le bon system prompt.
//   • { kind: "ambiguous", route, candidates } ⇒ multi-profils sans marqueur
//     identifiable. L'UI doit demander une clarification.
//   • { kind: "ok", target } pour mono-patient ⇒ identique à legacy, le
//     participant unique synthétisé fait foi.
async function resolveTargetParticipant(
  stationId: string,
  userMessage: string,
  currentSpeakerId: string | null | undefined,
): Promise<
  | { kind: "ok"; target: Participant; allParticipants: Participant[]; route: RouteResult }
  | {
      kind: "ambiguous";
      route: RouteResult;
      allParticipants: Participant[];
    }
> {
  const station = await getPatientStation(stationId);
  const allParticipants = getStationParticipants(station);
  // Mono-profil (1 participant : legacy mono-patient OU station déclarant un seul
  // participant explicitement) ⇒ on retourne directement, pas d'appel routeur.
  if (allParticipants.length <= 1) {
    return {
      kind: "ok",
      target: allParticipants[0],
      allParticipants,
      route: {
        targetId: allParticipants[0]?.id ?? "patient",
        confidence: "high",
        reason: "mono-patient (synthèse legacy ou un seul participant déclaré)",
      },
    };
  }
  const route = routeAddress({
    message: userMessage,
    participants: allParticipants,
    currentSpeaker: currentSpeakerId ?? null,
  });
  if (route.confidence === "ambiguous") {
    return { kind: "ambiguous", route, allParticipants };
  }
  const target = allParticipants.find((p) => p.id === route.targetId);
  if (!target) {
    // Le routeur a renvoyé un targetId qui n'existe plus dans la liste —
    // ne devrait jamais arriver, mais on dégrade en ambigu plutôt que
    // d'aiguiller silencieusement vers un profil obsolète.
    return { kind: "ambiguous", route, allParticipants };
  }
  return { kind: "ok", target, allParticipants, route };
}

// Builds the clarification payload with the trimmed participant info that
// the UI needs to show buttons.
function buildClarificationOutcome(
  participants: Participant[],
  reason: string,
): PatientChatClarification {
  return {
    type: "clarification_needed",
    reason,
    candidates: participants.map((p) => ({ id: p.id, name: p.name, role: p.role })),
  };
}

// Appelle OpenAI Chat Completions. L'historique passé par le client est utilisé tel quel.
//
// Phase 4 J2 — la fonction retourne désormais un PatientChatOutcome :
//   • soit la réponse LLM tagguée du speaker (cas normal, station mono ou
//     multi-profils résolu),
//   • soit un payload `clarification_needed` (cas multi-profils ambigu)
//     SANS appel OpenAI — pas de tokens consommés sur ambigu.
export async function runPatientChat(opts: ChatOptions): Promise<PatientChatOutcome> {
  // Phase 9 J1 — flow examinateur : bypass routing/leak detection.
  if (opts.conversationMode === "examiner") {
    return runExaminerChat(opts);
  }

  const key = getOpenAIKey();
  if (!key) throw new Error("OPENAI_API_KEY_MISSING");

  const resolved = await resolveTargetParticipant(
    opts.stationId,
    opts.userMessage,
    opts.currentSpeakerId,
  );
  if (resolved.kind === "ambiguous") {
    return buildClarificationOutcome(resolved.allParticipants, resolved.route.reason);
  }

  const { target, allParticipants } = resolved;
  const { interlocutor } = await resolveStationInterlocutor(opts.stationId);
  const system = await buildSystemPrompt(
    opts.stationId,
    opts.mode,
    target,
    allParticipants,
  );
  const client = new OpenAI({ apiKey: key });
  const model = opts.model ?? "gpt-4o-mini";
  const started = Date.now();
  try {
    const completion = await client.chat.completions.create({
      model,
      temperature: 0.7,
      max_tokens: 400,
      messages: [
        { role: "system", content: system },
        ...opts.history,
        { role: "user", content: opts.userMessage },
      ],
    });
    const reply = completion.choices[0]?.message?.content?.trim() ?? "";
    // Leak detection : on aligne sur le ROLE du participant qui répond, pas
    // sur l'interlocuteur statique de la station — un participant
    // accompanying qui répond doit être checké contre la blacklist
    // caregiver.
    const interlocutorTypeForLeaks: Interlocutor["type"] =
      target.role === "patient" ? "self" : "parent";
    logLeaksIfAny(opts.stationId, interlocutorTypeForLeaks, reply);
    void logRequest({
      route: "/api/patient/chat",
      stationId: opts.stationId,
      model,
      tokensIn: completion.usage?.prompt_tokens ?? 0,
      tokensOut: completion.usage?.completion_tokens ?? 0,
      cachedTokens: 0,
      latencyMs: Date.now() - started,
      ok: true,
    });
    return {
      type: "reply",
      reply,
      speakerId: target.id,
      speakerRole: target.role,
    };
  } catch (err) {
    void logRequest({
      route: "/api/patient/chat",
      stationId: opts.stationId,
      model,
      tokensIn: 0,
      tokensOut: 0,
      cachedTokens: 0,
      latencyMs: Date.now() - started,
      ok: false,
    });
    throw err;
  }
}

// ─── Phase 9 J1 — runExaminerChat (non streaming) ──────────────────────────
//
// Flow examinateur OSCE (station double partie 2, shortId -P2) :
//   • Pas de routing addressRouter (pas de multi-profils en mode examiner).
//   • Pas de leak detection patient (l'examinateur n'est pas un patient).
//   • System prompt = examiner.md + 15 questions injectées.
//   • Bypass userMessage à T0 : si history vide ET userMessage vide,
//     l'API OpenAI reçoit uniquement le message system, le LLM génère
//     seul l'ouverture (= question 1 verbatim ou reformulation neutre).
//   • speakerId/speakerRole : "examiner" / "examiner" (Phase 10 J3 dette 6).
//     Avant J3 : speakerRole valait "patient" (placeholder ParticipantRole
//     pour compat type, cohérence sémantique cassée). Depuis J3, le type
//     est élargi à ConversationSpeakerRole (additif strict) qui inclut
//     "examiner" — speakerId et speakerRole sont alignés. Le frontend
//     peut désormais lire speakerRole directement, en conservant le
//     fallback speakerId === "examiner" pour rétrocompat (clients
//     pré-J3 qui voient un événement legacy avec speakerRole=="patient"
//     + speakerId=="examiner" doivent toujours afficher "Examinateur").
async function runExaminerChat(opts: ChatOptions): Promise<PatientChatOutcome> {
  const key = getOpenAIKey();
  if (!key) throw new Error("OPENAI_API_KEY_MISSING");

  const system = await buildSystemPrompt(opts.stationId, opts.mode);
  const client = new OpenAI({ apiKey: key });
  const model = opts.model ?? "gpt-4o-mini";
  const started = Date.now();

  const isOpening = opts.history.length === 0 && opts.userMessage.length === 0;
  const messages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
    { role: "system", content: system },
    ...opts.history,
  ];
  if (!isOpening) {
    messages.push({ role: "user", content: opts.userMessage });
  }

  try {
    const completion = await client.chat.completions.create({
      model,
      temperature: 0.7,
      max_tokens: 400,
      messages,
    });
    const reply = completion.choices[0]?.message?.content?.trim() ?? "";
    void logRequest({
      route: "/api/patient/chat",
      stationId: opts.stationId,
      model,
      tokensIn: completion.usage?.prompt_tokens ?? 0,
      tokensOut: completion.usage?.completion_tokens ?? 0,
      cachedTokens: 0,
      latencyMs: Date.now() - started,
      ok: true,
    });
    return {
      type: "reply",
      reply,
      speakerId: "examiner",
      // Phase 10 J3 dette 6 : "patient" → "examiner" (alignement
      // speakerId/speakerRole, type ConversationSpeakerRole).
      speakerRole: "examiner",
    };
  } catch (err) {
    void logRequest({
      route: "/api/patient/chat",
      stationId: opts.stationId,
      model,
      tokensIn: 0,
      tokensOut: 0,
      cachedTokens: 0,
      latencyMs: Date.now() - started,
      ok: false,
    });
    throw err;
  }
}

// ─────────── Streaming ───────────

// Détecte la fin d'une phrase : ponctuation terminale suivie d'un espace ou fin de texte.
// Longueur minimale d'un "flush" pour éviter des abréviations ("Dr. ", "M. ").
const SENTENCE_END = /([.!?…]+)(\s+|$)/;
const MIN_SENTENCE_LENGTH = 12;

export interface StreamEvent {
  type:
    | "delta"
    | "sentence"
    | "done"
    | "error"
    // Phase 4 J2 — événements liés au routage multi-profils.
    | "speaker"
    | "clarification_needed";
  text?: string;
  index?: number;
  fullText?: string;
  code?: string;
  message?: string;
  // Phase 4 J2 — émis avant tout `delta` quand le routeur a tranché en
  // faveur d'un participant. Le client met à jour `currentSpeakerId` et
  // affiche le bon label ("Mère du patient (voix IA)" vs "Patient (voix IA)").
  // Phase 10 J3 — dette 6 : élargi à ConversationSpeakerRole (ajout
  // "examiner") pour aligner le speakerRole sur le speakerId quand le
  // flow examinateur est actif. Compat type préservée pour les flows
  // patient/multi-profils (sous-type strict de ConversationSpeakerRole).
  speakerId?: string;
  speakerRole?: ConversationSpeakerRole;
  // Phase 4 J2 — émis seul (pas de delta/done associé) quand le routeur a
  // tranché « ambigu ». Aucun appel OpenAI n'est effectué dans ce cas.
  // Le routeur multi-profils ne peut PAS produire de candidat "examiner"
  // (le flow examinateur bypasse le routing) → ParticipantRole conservé.
  candidates?: Array<{ id: string; name: string; role: ParticipantRole }>;
  reason?: string;
}

// Async generator qui yield des events discrets à partir du flux OpenAI.
// Le consommateur (route SSE) se charge de sérialiser au format text/event-stream.
// `signal` permet à la route d'abort l'appel OpenAI si le client se déconnecte.
//
// Phase 4 J2 — séquence des events :
//   1. soit `clarification_needed` (et fin du stream — pas d'OpenAI),
//   2. soit `speaker` puis `delta*`, `sentence*`, `done`.
export async function* streamPatientChat(
  opts: ChatOptions,
  signal?: AbortSignal,
): AsyncGenerator<StreamEvent> {
  // Phase 9 J1 — flow examinateur SSE.
  if (opts.conversationMode === "examiner") {
    yield* streamExaminerChat(opts, signal);
    return;
  }

  const key = getOpenAIKey();
  if (!key) throw new Error("OPENAI_API_KEY_MISSING");

  const resolved = await resolveTargetParticipant(
    opts.stationId,
    opts.userMessage,
    opts.currentSpeakerId,
  );
  if (resolved.kind === "ambiguous") {
    yield {
      type: "clarification_needed",
      reason: resolved.route.reason,
      candidates: resolved.allParticipants.map((p) => ({
        id: p.id,
        name: p.name,
        role: p.role,
      })),
    };
    return;
  }

  const { target, allParticipants } = resolved;
  const system = await buildSystemPrompt(
    opts.stationId,
    opts.mode,
    target,
    allParticipants,
  );
  const client = new OpenAI({ apiKey: key });
  const model = opts.model ?? "gpt-4o-mini";
  const started = Date.now();

  // Tag du speaker — émis EN PREMIER pour que le client puisse mettre à jour
  // l'UI (label « Mère du patient (voix IA) » vs « Patient (voix IA) »)
  // avant le premier delta.
  yield {
    type: "speaker",
    speakerId: target.id,
    speakerRole: target.role,
  };

  const stream = await client.chat.completions.create(
    {
      model,
      temperature: 0.7,
      max_tokens: 400,
      stream: true,
      // include_usage : OpenAI n'envoie le bloc usage qu'en fin de stream si on le demande.
      stream_options: { include_usage: true },
      messages: [
        { role: "system", content: system },
        ...opts.history,
        { role: "user", content: opts.userMessage },
      ],
    },
    { signal },
  );

  let fullText = "";
  let pending = "";
  let sentenceIndex = 0;
  let tokensIn = 0;
  let tokensOut = 0;
  let ok = true;

  try {
    for await (const chunk of stream) {
      // Le dernier chunk peut n'avoir que `usage` sans choices[0].delta.
      if ((chunk as any).usage) {
        tokensIn = (chunk as any).usage.prompt_tokens ?? 0;
        tokensOut = (chunk as any).usage.completion_tokens ?? 0;
      }
      const delta = chunk.choices?.[0]?.delta?.content ?? "";
      if (!delta) continue;
      fullText += delta;
      pending += delta;
      yield { type: "delta", text: delta };

      // Extrait toutes les phrases complètes du buffer courant.
      while (true) {
        const match = pending.match(SENTENCE_END);
        if (!match) break;
        const endIdx = match.index! + match[1].length;
        const candidate = pending.slice(0, endIdx).trim();
        if (candidate.length < MIN_SENTENCE_LENGTH) break;
        yield { type: "sentence", text: candidate, index: sentenceIndex++ };
        pending = pending.slice(endIdx + match[2].length);
      }
    }

    // Fin du stream : flush du buffer restant comme dernière phrase s'il contient du texte.
    const tail = pending.trim();
    if (tail.length > 0) {
      yield { type: "sentence", text: tail, index: sentenceIndex++ };
    }
    const interlocutorTypeForLeaks: Interlocutor["type"] =
      target.role === "patient" ? "self" : "parent";
    logLeaksIfAny(opts.stationId, interlocutorTypeForLeaks, fullText);
    yield { type: "done", fullText: fullText.trim() };
  } catch (err) {
    ok = false;
    throw err;
  } finally {
    void logRequest({
      route: "/api/patient/chat/stream",
      stationId: opts.stationId,
      model,
      tokensIn,
      tokensOut,
      cachedTokens: 0,
      latencyMs: Date.now() - started,
      ok,
    });
  }
}

// ─── Phase 9 J1 — streamExaminerChat (SSE) ────────────────────────────────
//
// Variante streaming du flow examinateur. Émet la séquence :
//   1. `speaker` (speakerId="examiner", speakerRole="examiner" — Phase 10 J3
//      dette 6, type ConversationSpeakerRole). Avant J3 : speakerRole valait
//      "patient" placeholder ParticipantRole, incohérent avec speakerId.
//   2. `delta*` puis `sentence*` (TTS progressif côté client)
//   3. `done`
//
// Aucun event `clarification_needed` ne peut être émis (le routing
// multi-profils est bypassé — pas de target ambigu en mode examiner).
async function* streamExaminerChat(
  opts: ChatOptions,
  signal?: AbortSignal,
): AsyncGenerator<StreamEvent> {
  const key = getOpenAIKey();
  if (!key) throw new Error("OPENAI_API_KEY_MISSING");

  const system = await buildSystemPrompt(opts.stationId, opts.mode);
  const client = new OpenAI({ apiKey: key });
  const model = opts.model ?? "gpt-4o-mini";
  const started = Date.now();

  yield {
    type: "speaker",
    speakerId: "examiner",
    // Phase 10 J3 dette 6 : "patient" → "examiner" (alignement
    // speakerId/speakerRole, type ConversationSpeakerRole).
    speakerRole: "examiner",
  };

  const isOpening = opts.history.length === 0 && opts.userMessage.length === 0;
  const messages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
    { role: "system", content: system },
    ...opts.history,
  ];
  if (!isOpening) {
    messages.push({ role: "user", content: opts.userMessage });
  }

  const stream = await client.chat.completions.create(
    {
      model,
      temperature: 0.7,
      max_tokens: 400,
      stream: true,
      stream_options: { include_usage: true },
      messages,
    },
    { signal },
  );

  let fullText = "";
  let pending = "";
  let sentenceIndex = 0;
  let tokensIn = 0;
  let tokensOut = 0;
  let ok = true;

  try {
    for await (const chunk of stream) {
      if ((chunk as any).usage) {
        tokensIn = (chunk as any).usage.prompt_tokens ?? 0;
        tokensOut = (chunk as any).usage.completion_tokens ?? 0;
      }
      const delta = chunk.choices?.[0]?.delta?.content ?? "";
      if (!delta) continue;
      fullText += delta;
      pending += delta;
      yield { type: "delta", text: delta };

      while (true) {
        const match = pending.match(SENTENCE_END);
        if (!match) break;
        const endIdx = match.index! + match[1].length;
        const candidate = pending.slice(0, endIdx).trim();
        if (candidate.length < MIN_SENTENCE_LENGTH) break;
        yield { type: "sentence", text: candidate, index: sentenceIndex++ };
        pending = pending.slice(endIdx + match[2].length);
      }
    }
    const tail = pending.trim();
    if (tail.length > 0) {
      yield { type: "sentence", text: tail, index: sentenceIndex++ };
    }
    yield { type: "done", fullText: fullText.trim() };
  } catch (err) {
    ok = false;
    throw err;
  } finally {
    void logRequest({
      route: "/api/patient/chat/stream",
      stationId: opts.stationId,
      model,
      tokensIn,
      tokensOut,
      cachedTokens: 0,
      latencyMs: Date.now() - started,
      ok,
    });
  }
}
