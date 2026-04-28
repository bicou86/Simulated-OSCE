// Phase 6 J1 — outillage de triage médico-légal des 287 stations.
//
// OBJECTIF
//   Classer les 287 stations en 3 statuts (A/B/C) restreints aux 3
//   catégories Phase 5 (secret_pro_levee, signalement_maltraitance,
//   certificat_complaisance), produire un CSV exportable destiné à une
//   relecture pédagogique humaine (médecin CH) avant J2.
//
// INVARIANTS (Phase 6 J1)
//   • ZÉRO appel LLM. Heuristiques + RegExp uniquement.
//   • ZÉRO écriture dans les fichiers de stations. Le script génère
//     UNIQUEMENT du CSV dans triage-output/.
//   • Déterministe : 2 runs successifs produisent le MÊME CSV.
//   • Les 3 pilotes Phase 5 (AMBOSS-24, USMLE-34, RESCOS-72) doivent
//     ressortir en status A avec leur catégorie attendue (auto-test
//     de cohérence).
//
// USAGE
//   npx tsx scripts/triage-medico-legal.ts
//   → produit triage-output/phase-6-j1.csv
//   → imprime un résumé en stdout (counts A/B/C, top 10 ambiguïtés).
//
// ARCHITECTURE
//   On lit les fichiers Patient_*.json directement (pas le catalogue
//   en mémoire — pas besoin de boot serveur). Pour le stationType, on
//   réutilise `inferStationType` (déjà déterministe Phase 2).

import { promises as fs } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { extractAge, extractSex } from "../server/lib/patientSex";
import { resolveInterlocutor } from "../server/lib/patientInterlocutor";
import {
  inferStationType,
  type StationType,
} from "../server/services/stationTypeInference";
import type { StationSource } from "../server/services/stationsService";

// ─── Types ────────────────────────────────────────────────────────────

export type TriageStatus = "A" | "B" | "C";

// On reste strictement aligné avec les 3 catégories Phase 5 : pas
// d'extension scope en J1 (Phase 7 introduira d'autres catégories).
export type TriageCategory =
  | "secret_pro_levee"
  | "signalement_maltraitance"
  | "certificat_complaisance"
  | "";

export interface TriageRow {
  id: string;
  source: StationSource;
  title: string;
  setting: string;
  stationType: StationType;
  suggested_status: TriageStatus;
  suggested_category: TriageCategory;
  confidence: number; // 0..1
  rationale: string;
  already_annotated: boolean;
}

export interface TriageSummary {
  total: number;
  byStatus: Record<TriageStatus, number>;
  byCategory: Record<string, number>;
  bySource: Record<string, number>;
  top10Ambiguous: TriageRow[];
  pilotsCheckOk: boolean;
}

// ─── Helpers d'I/O ────────────────────────────────────────────────────

const PATIENT_DIR_DEFAULT = path.resolve(
  fileURLToPath(new URL(".", import.meta.url)),
  "..",
  "server",
  "data",
  "patient",
);

interface RawStation {
  id: string;
  setting?: string;
  patient_description?: string;
  age?: string | number;
  specialite?: string;
  legalContext?: { category?: string };
}

interface RawFile {
  source: StationSource;
  stations: RawStation[];
}

async function loadAllStations(patientDir = PATIENT_DIR_DEFAULT): Promise<
  Array<{ source: StationSource; raw: RawStation }>
> {
  const files = await fs.readdir(patientDir);
  const patientFiles = files
    .filter((f) => f.startsWith("Patient_") && f.endsWith(".json"))
    .sort(); // Tri déterministe sur le nom de fichier.
  const all: Array<{ source: StationSource; raw: RawStation }> = [];
  const seen = new Set<string>();
  for (const f of patientFiles) {
    const raw = await fs.readFile(path.join(patientDir, f), "utf-8");
    const parsed = JSON.parse(raw) as RawFile;
    for (const s of parsed.stations) {
      const shortId = s.id.split(" - ")[0];
      // Évite les doublons (cf. doublon RESCOS-64 documenté dans
      // stationsService) : on garde la PREMIÈRE occurrence en se
      // basant sur l'ordre de tri des fichiers + l'ordre dans le
      // tableau, pour rester strictement déterministe.
      if (seen.has(shortId)) continue;
      seen.add(shortId);
      all.push({ source: parsed.source, raw: s });
    }
  }
  return all;
}

// ─── Normalisation lexicale ───────────────────────────────────────────
// Reprise du pattern stationTypeInference.normalize : lowercase, sans
// accents (NFD + strip diacritics), oe/ae remplacés.
function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/œ/g, "oe")
    .replace(/æ/g, "ae")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

// ─── Heuristiques par catégorie ───────────────────────────────────────
//
// Chaque règle :
//   • Reçoit un haystack normalisé (id + setting + patient_description
//     + nom + age stringifié, concaténés).
//   • Retourne un { status, category, confidence, rationale } si elle
//     match, ou null sinon.
//   • Les règles sont ordonnées de la plus spécifique à la plus large.
//     La PREMIÈRE règle qui match gagne (ordre = priorité).

interface Match {
  status: TriageStatus;
  category: TriageCategory;
  confidence: number;
  rationale: string;
}

interface Heuristic {
  name: string;
  test: (h: string, age: number | undefined) => Match | null;
}

// Mots-clés mineur : âge < 18 OU mention textuelle.
function isMinor(age: number | undefined, h: string): boolean {
  if (typeof age === "number" && age < 18) return true;
  return /\b(?:enfant|nourrisson|bebe|adolescent|ado\b|mineur)\b/.test(h);
}

const HEURISTICS: Heuristic[] = [
  // ─── signalement_maltraitance ─────────────────────────────────────
  {
    name: "minor_high_violence",
    test: (h, age) => {
      if (!isMinor(age, h)) return null;
      const VIOLENCE = /\b(?:violence|maltrait|abus|pleurs\s+inconsolables|ecchymos|trauma\s+non\s+explique|secouement|shaken|retard\s+staturo)/;
      if (!VIOLENCE.test(h)) return null;
      return {
        status: "A",
        category: "signalement_maltraitance",
        confidence: 0.9,
        rationale: "Mineur + indice direct de maltraitance (violence/abus/trauma non expliqué)",
      };
    },
  },
  {
    name: "minor_accident_suspect",
    test: (h, age) => {
      if (!isMinor(age, h)) return null;
      const ACCIDENT = /\b(?:intoxic|brulure|noyade|chute\s+hauteur)\b/;
      if (!ACCIDENT.test(h)) return null;
      return {
        status: "A",
        category: "signalement_maltraitance",
        confidence: 0.7,
        rationale: "Mineur + accident potentiellement suspect (intox/brûlure/noyade/chute hauteur)",
      };
    },
  },
  {
    name: "vulnerable_adult_violence",
    test: (h) => {
      const VULN = /\b(?:handicap|demenc|geriatri|dependance)\b/;
      const VIOLENCE = /\b(?:violence|abus|negligenc|neglig)\b/;
      if (!VULN.test(h) || !VIOLENCE.test(h)) return null;
      return {
        status: "A",
        category: "signalement_maltraitance",
        confidence: 0.8,
        rationale: "Adulte vulnérable (démence/handicap/gériatrie + dépendance) + indice de violence/négligence",
      };
    },
  },
  {
    name: "domestic_violence_woman",
    test: (h) => {
      const WOMAN_VICTIM = /\b(?:violence\s+conjugale|violence\s+domestique|conjoint\s+violent|ecchymoses\s+multiples)/;
      if (!WOMAN_VICTIM.test(h)) return null;
      // On ne demande pas explicitement « femme » : la majorité des
      // stations RESCOS/USMLE de violence conjugale identifient la
      // victime au féminin via patient_description, et on capte aussi
      // les masculins par cohérence (rare en ECOS mais possible).
      return {
        status: "A",
        category: "signalement_maltraitance",
        confidence: 0.85,
        rationale: "Adulte + violence conjugale/domestique avec marqueurs cliniques",
      };
    },
  },

  // ─── secret_pro_levee ─────────────────────────────────────────────
  {
    name: "suicide",
    test: (h) => {
      const SUICIDE = /\b(?:suicid|idee\s+suicidaire|idees\s+suicidaire|crise\s+suicidaire|passage\s+a\s+l\s*acte|ts\s+recent)/;
      if (!SUICIDE.test(h)) return null;
      return {
        status: "A",
        category: "secret_pro_levee",
        confidence: 0.85,
        rationale: "Idéation/crise/tentative suicidaire — devoir d'aviser si danger imminent",
      };
    },
  },
  {
    name: "third_party_threat",
    test: (h) => {
      const THREAT = /\b(?:violence\s+envers\s+tiers|menace|homicidaire|port\s+d\s*arme)/;
      if (!THREAT.test(h)) return null;
      return {
        status: "A",
        category: "secret_pro_levee",
        confidence: 0.85,
        rationale: "Menace/violence envers tiers — levée du secret pro envisageable",
      };
    },
  },
  {
    name: "hopi_plafa",
    test: (h) => {
      const HOPI = /\b(?:hopi|plafa|placement\s+a\s+des\s+fins\s+d\s*assistance)\b/;
      if (!HOPI.test(h)) return null;
      return {
        status: "A",
        category: "secret_pro_levee",
        confidence: 0.9,
        rationale: "HoPi/PLAFA — placement à fins d'assistance (cadre légal CH spécifique)",
      };
    },
  },
  {
    name: "driving_aptitude",
    test: (h) => {
      const DRIVING = /\b(?:conduite|aptitude\s+(?:a\s+la\s+)?conduite|permis\s+(?:de\s+)?conduire)/;
      const HAZARD = /\b(?:alcool|drogue|epilepsi|demenc|malaise\s+repete)/;
      if (!DRIVING.test(h) || !HAZARD.test(h)) return null;
      return {
        status: "A",
        category: "secret_pro_levee",
        confidence: 0.7,
        rationale: "Aptitude à la conduite + facteur de risque (alcool/drogue/épilepsie/démence)",
      };
    },
  },

  // ─── certificat_complaisance ──────────────────────────────────────
  {
    name: "certificate_inappropriate",
    test: (h) => {
      const CERT = /\b(?:arret\s+(?:de\s+)?travail|arret\s+travail|certificat|attestation)\b/;
      const ABUSIVE = /\b(?:demande\s+inappropriee|sans\s+motif|abusif|complaisance|pour\s+voyage|pour\s+examen|pour\s+divorce|pour\s+assurance)/;
      if (!CERT.test(h) || !ABUSIVE.test(h)) return null;
      return {
        status: "A",
        category: "certificat_complaisance",
        confidence: 0.9,
        rationale: "Demande de certificat/AT en contexte non médical (voyage/examen/divorce/abusif)",
      };
    },
  },
  {
    name: "death_certificate",
    test: (h) => {
      const DEATH = /\b(?:certificat\s+(?:de\s+)?deces|certificat\s+(?:de\s+)?mort|constatation\s+(?:de\s+)?deces|autopsie)/;
      if (!DEATH.test(h)) return null;
      return {
        status: "A",
        category: "certificat_complaisance",
        confidence: 0.7,
        rationale: "Certificat de décès / constatation / autopsie — cadre médico-légal formel",
      };
    },
  },
];

// ─── Heuristiques status C (à arbitrer humainement) ────────────────
// Détectées APRÈS échec des règles A. Si on ne match aucune, on retombe
// sur une catégorisation B (vu non applicable) ou C (autre).

interface CHeuristic {
  name: string;
  match: (h: string, stationType: StationType, source: StationSource) => string | null; // retourne le rationale
}

const C_HEURISTICS: CHeuristic[] = [
  {
    name: "psy_no_emergency",
    match: (h, stationType) => {
      if (stationType !== "psy") return null;
      // Si la règle suicide n'a pas matché, c'est qu'on est en
      // psy NON-suicidaire → status C (Phase 7 traitera).
      return "Psychiatrie sans urgence suicidaire — peut nécessiter directives anticipées ou capacité de discernement (Phase 7)";
    },
  },
  {
    name: "pediatrics_no_redflag",
    match: (h, stationType) => {
      if (stationType !== "pediatrie_accompagnant") return null;
      return "Pédiatrie standard sans red flag de maltraitance — consentement parental implicite, hors scope Phase 5/6";
    },
  },
  {
    name: "bbn",
    match: (h, stationType) => {
      if (stationType !== "bbn") return null;
      return "BBN (annonce diagnostic grave) — pas de cadre médico-légal CH formalisé Phase 5/6";
    },
  },
  {
    name: "teleconsult_non_violence",
    match: (h, stationType) => {
      if (stationType !== "teleconsultation") return null;
      return "Téléconsultation hors maltraitance — responsabilité médicale, hors scope Phase 6 J1";
    },
  },
  {
    name: "usmle_amboss_non_pediatric_no_match",
    match: (_h, _stationType, source) => {
      if (source !== "USMLE" && source !== "AMBOSS") return null;
      return "Source USMLE/AMBOSS non triviale à transposer en droit CH — vérifier expert avant annotation";
    },
  },
];

// ─── Détection « consultation purement clinique » (status B) ──────
// Si une station ne matche AUCUNE règle A et est dans un stationType
// clinique (anamnese_examen | triage), on la classe B. Sinon C.
function isClinicalRoutineSetting(stationType: StationType): boolean {
  return stationType === "anamnese_examen" || stationType === "triage";
}

// ─── Triage principal ────────────────────────────────────────────────

const PILOT_IDS_TO_CATEGORY: Record<string, TriageCategory> = {
  "AMBOSS-24": "secret_pro_levee",
  "USMLE-34": "signalement_maltraitance",
  "RESCOS-72": "certificat_complaisance",
};

export function triageOne(args: {
  source: StationSource;
  raw: RawStation;
}): TriageRow {
  const { source, raw } = args;
  const shortId = raw.id.split(" - ")[0];
  const title = raw.id.slice(shortId.length + 3) || raw.id;
  const setting = raw.setting ?? "";
  const desc = raw.patient_description ?? "";

  // Inférence stationType (réutilise la logique Phase 2 déterministe).
  const sex = extractSex(desc);
  const age = extractAge(raw.age, desc);
  const interlocutor = resolveInterlocutor({
    patientDescription: desc,
    age,
    sex,
  });
  const inference = inferStationType({
    id: shortId,
    fullId: raw.id,
    title,
    source,
    setting,
    patientDescription: desc,
    age,
    interlocutorType: interlocutor.type,
    specialite: typeof raw.specialite === "string" ? raw.specialite : undefined,
  });

  // Stations DÉJÀ annotées Phase 5 : on les ressort A avec leur
  // catégorie et confidence 1.0, indépendamment des heuristiques.
  // Auto-cohérence : c'est aussi le test 2.
  const alreadyAnnotated = Boolean(raw.legalContext);
  if (alreadyAnnotated && raw.legalContext?.category) {
    const cat = raw.legalContext.category as TriageCategory;
    return {
      id: shortId,
      source,
      title,
      setting,
      stationType: inference.type,
      suggested_status: "A",
      suggested_category: cat,
      confidence: 1.0,
      rationale: "Déjà annotée Phase 5 — legalContext présent dans la fixture",
      already_annotated: true,
    };
  }

  // Haystack normalisé pour les heuristiques : id + setting + desc +
  // age stringifié. On NE consomme PAS le contenu narratif riche
  // (consignes_jeu, motif_cache) — le triage doit rester explicable
  // à partir des champs visibles dans le brief HTTP (titre, setting,
  // patient_description) pour éviter que l'opérateur humain en
  // relisant le CSV soit perdu.
  const haystack = normalize(
    [raw.id, setting, desc, typeof raw.age === "string" ? raw.age : ""]
      .filter(Boolean)
      .join(" | "),
  );

  for (const rule of HEURISTICS) {
    const m = rule.test(haystack, age);
    if (m) {
      return {
        id: shortId,
        source,
        title,
        setting,
        stationType: inference.type,
        suggested_status: m.status,
        suggested_category: m.category,
        confidence: m.confidence,
        rationale: `[${rule.name}] ${m.rationale}`,
        already_annotated: false,
      };
    }
  }

  // Aucun match A. On essaie d'abord les heuristiques C.
  for (const rule of C_HEURISTICS) {
    const r = rule.match(haystack, inference.type, source);
    if (r) {
      return {
        id: shortId,
        source,
        title,
        setting,
        stationType: inference.type,
        suggested_status: "C",
        suggested_category: "",
        confidence: 0.4,
        rationale: `[${rule.name}] ${r}`,
        already_annotated: false,
      };
    }
  }

  // Si la station est dans un stationType "clinique routine" et n'a
  // matché ni A ni C : status B vu-non-applicable.
  if (isClinicalRoutineSetting(inference.type)) {
    return {
      id: shortId,
      source,
      title,
      setting,
      stationType: inference.type,
      suggested_status: "B",
      suggested_category: "",
      confidence: 0.6,
      rationale:
        "Consultation clinique standard (anamnèse/examen ou triage), aucun marqueur médico-légal détecté",
      already_annotated: false,
    };
  }

  // Reste : status C par défaut.
  return {
    id: shortId,
    source,
    title,
    setting,
    stationType: inference.type,
    suggested_status: "C",
    suggested_category: "",
    confidence: 0.3,
    rationale:
      "Station hors heuristiques — à arbitrer humainement (hors des 3 catégories Phase 5)",
    already_annotated: false,
  };
}

export async function triageAll(patientDir = PATIENT_DIR_DEFAULT): Promise<TriageRow[]> {
  const stations = await loadAllStations(patientDir);
  const rows = stations.map(({ source, raw }) => triageOne({ source, raw }));
  // Tri stable par id (numérique-friendly, locale fr) — déterminisme
  // requis pour invariant J1 #6 (CSV reproductible).
  rows.sort((a, b) => a.id.localeCompare(b.id, "fr", { numeric: true }));
  return rows;
}

export function summarize(rows: TriageRow[]): TriageSummary {
  const byStatus: Record<TriageStatus, number> = { A: 0, B: 0, C: 0 };
  const byCategory: Record<string, number> = {};
  const bySource: Record<string, number> = {};
  for (const r of rows) {
    byStatus[r.suggested_status] += 1;
    const cat = r.suggested_category || "(none)";
    byCategory[cat] = (byCategory[cat] ?? 0) + 1;
    bySource[r.source] = (bySource[r.source] ?? 0) + 1;
  }
  // Top 10 ambiguïtés : status C avec confidence < 0.5, triées par
  // confidence ascendante (les plus incertaines d'abord).
  const top10Ambiguous = rows
    .filter((r) => r.suggested_status === "C" && r.confidence < 0.5)
    .sort((a, b) => a.confidence - b.confidence || a.id.localeCompare(b.id, "fr", { numeric: true }))
    .slice(0, 10);

  // Auto-test : les 3 pilotes Phase 5 doivent ressortir A.
  let pilotsCheckOk = true;
  for (const [pid, pcat] of Object.entries(PILOT_IDS_TO_CATEGORY)) {
    const found = rows.find((r) => r.id === pid);
    if (!found || found.suggested_status !== "A" || found.suggested_category !== pcat) {
      pilotsCheckOk = false;
    }
  }

  return {
    total: rows.length,
    byStatus,
    byCategory,
    bySource,
    top10Ambiguous,
    pilotsCheckOk,
  };
}

// ─── Sérialisation CSV (RFC 4180) ─────────────────────────────────────

function escapeCsvCell(s: string): string {
  // RFC 4180 : si la cellule contient une virgule, un guillemet double
  // ou un saut de ligne, on l'entoure de guillemets et on double les
  // guillemets internes.
  if (/[",\r\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export const CSV_HEADERS = [
  "id",
  "source",
  "title",
  "setting",
  "stationType",
  "suggested_status",
  "suggested_category",
  "confidence",
  "rationale",
  "already_annotated",
] as const;

export function rowsToCsv(rows: TriageRow[]): string {
  const header = CSV_HEADERS.join(",");
  const lines = rows.map((r) =>
    [
      r.id,
      r.source,
      r.title,
      r.setting,
      r.stationType,
      r.suggested_status,
      r.suggested_category,
      r.confidence.toFixed(2),
      r.rationale,
      r.already_annotated ? "true" : "false",
    ]
      .map((v) => escapeCsvCell(String(v)))
      .join(","),
  );
  return [header, ...lines].join("\n") + "\n";
}

// ─── CLI principal ────────────────────────────────────────────────────

function formatSummary(s: TriageSummary): string {
  const lines: string[] = [];
  lines.push(`\n────────── Triage médico-légal Phase 6 J1 ──────────`);
  lines.push(`Total stations : ${s.total}`);
  lines.push(`\nPar statut :`);
  for (const k of ["A", "B", "C"] as const) {
    const pct = ((s.byStatus[k] / s.total) * 100).toFixed(1);
    lines.push(`  ${k}  : ${String(s.byStatus[k]).padStart(3)}  (${pct}%)`);
  }
  lines.push(`\nPar catégorie suggérée :`);
  const sortedCats = Object.keys(s.byCategory).sort();
  for (const c of sortedCats) {
    lines.push(`  ${c.padEnd(28)} : ${s.byCategory[c]}`);
  }
  lines.push(`\nPar source :`);
  const sortedSources = Object.keys(s.bySource).sort();
  for (const src of sortedSources) {
    lines.push(`  ${src.padEnd(14)} : ${s.bySource[src]}`);
  }
  lines.push(
    `\nAuto-test pilotes Phase 5 (3 stations doivent ressortir A) : ${
      s.pilotsCheckOk ? "OK ✓" : "ÉCHEC ✗"
    }`,
  );
  if (s.top10Ambiguous.length > 0) {
    lines.push(`\nTop ${s.top10Ambiguous.length} ambiguïtés (status C, confidence < 0.5) :`);
    for (const r of s.top10Ambiguous) {
      lines.push(
        `  ${r.id.padEnd(14)} [${r.stationType.padEnd(22)}] (${r.confidence.toFixed(2)}) ${r.title}`,
      );
    }
  }
  lines.push(`────────────────────────────────────────────────────`);
  return lines.join("\n");
}

async function main(): Promise<void> {
  const projectRoot = path.resolve(
    fileURLToPath(new URL(".", import.meta.url)),
    "..",
  );
  const outDir = path.join(projectRoot, "triage-output");
  await fs.mkdir(outDir, { recursive: true });
  const outFile = path.join(outDir, "phase-6-j1.csv");

  const rows = await triageAll();
  const csv = rowsToCsv(rows);
  await fs.writeFile(outFile, csv, "utf-8");
  const summary = summarize(rows);
  // eslint-disable-next-line no-console
  console.log(formatSummary(summary));
  // eslint-disable-next-line no-console
  console.log(`\nCSV écrit : ${path.relative(projectRoot, outFile)}`);
  if (!summary.pilotsCheckOk) {
    process.exitCode = 1;
  }
}

// Exécution CLI uniquement si invoqué directement (pas en import test).
const isCli = (() => {
  try {
    const thisFile = fileURLToPath(import.meta.url);
    const arg1 = process.argv[1] ? path.resolve(process.argv[1]) : "";
    return arg1 === thisFile;
  } catch {
    return false;
  }
})();

if (isCli) {
  main().catch((err) => {
    // eslint-disable-next-line no-console
    console.error("[triage-medico-legal] fatal:", err);
    process.exit(1);
  });
}
