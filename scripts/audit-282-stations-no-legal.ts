// Phase 8 J5 — mini sondage corpus : audit heuristique des stations
// SANS `legalContext` pour identifier les candidats potentiels à une
// future annotation médico-légale (Phase 9+).
//
// USAGE
//   npx tsx scripts/audit-282-stations-no-legal.ts                 → markdown stdout
//   npx tsx scripts/audit-282-stations-no-legal.ts --json           → JSON stdout
//   npx tsx scripts/audit-282-stations-no-legal.ts --top 50         → top N (défaut 30)
//
// SCOPE (arbitrage utilisateur Phase 8 #F : mini sondage SEULEMENT)
//   • Lecture seule sur fixtures Patient_*.json + Examinateur_*.json.
//   • ZÉRO modification de fixture, ZÉRO appel LLM.
//   • Heuristique pure : on réutilise les `patterns` regex du lexique
//     `legalLexicon` v1.1.0 (Phase 7) et on compte les matches sur le
//     texte aplati de chaque station (patient narratif + grille
//     évaluateur). Aucune invention de keyword.
//   • Stations cibles : celles SANS `legalContext` dans le patient
//     (cible Phase 8 J5 = 283 stations = 288 - 5 stations legal).
//   • Output : tableau trié par `scoreTotal` (somme des matches sur
//     toutes les catégories du lexique), top 30 par défaut.
//
// LIMITES (cf. doc bilan)
//   • Heuristique keyword pure : ne distingue pas affirmation/négation,
//     ne valide pas la pertinence pédagogique réelle.
//   • Nombre de matches ≠ priorité d'annotation. Un score élevé indique
//     que des keywords du lexique apparaissent dans la fixture, pas
//     que la station nécessite un legalContext.
//   • Précision sémantique fine : 0% (pas de LLM dans la décision).
//   • À utiliser comme aide à la priorisation Phase 9+ uniquement,
//     PAS comme recommandation directe d'extension corpus.

import { promises as fs } from "fs";
import path from "path";
import {
  LEGAL_LEXICON,
  LEGAL_LEXICON_CATEGORIES,
  LEGAL_LEXICON_VERSION,
  type LegalLexiconCategory,
} from "../server/lib/legalLexicon";

const PATIENT_DIR = path.resolve(import.meta.dirname, "..", "server", "data", "patient");
const EVALUATOR_DIR = path.resolve(import.meta.dirname, "..", "server", "data", "evaluator");

export interface AuditRow {
  fullId: string;
  shortId: string;
  source: string;
  setting: string;
  // Compteur par catégorie : nombre de patterns matchés pour cette
  // catégorie (somme sur toutes les entrées de cette catégorie).
  byCategory: Record<LegalLexiconCategory, number>;
  // Compteur transverse : nombre de catégories distinctes touchées
  // (≥ 1 keyword matché). Indicateur qu'une station croise plusieurs
  // axes médico-légaux différents.
  categoriesTouched: number;
  // Score total : somme des matches sur toutes les catégories.
  // Sert de tri primaire (priorité d'attention pour audit Phase 9+).
  scoreTotal: number;
}

export interface AuditSummary {
  lexiconVersion: string;
  totalStationsScanned: number;
  stationsWithLegalContext: number;
  stationsWithoutLegalContext: number;
  // Distribution : par catégorie, nombre de stations qui ont ≥ 1 hit.
  byCategoryStationCount: Record<LegalLexiconCategory, number>;
  // Distribution : par catégorie, somme des hits sur le corpus.
  byCategoryTotalHits: Record<LegalLexiconCategory, number>;
}

// ─────────────────────────────────────────────────────────────────────────
// Helpers d'aplatissement des données station

function flattenText(obj: unknown, out: string[] = []): string[] {
  if (obj === null || obj === undefined) return out;
  if (typeof obj === "string") {
    if (obj.length > 0) out.push(obj);
    return out;
  }
  if (typeof obj === "number" || typeof obj === "boolean") {
    return out;
  }
  if (Array.isArray(obj)) {
    for (const v of obj) flattenText(v, out);
    return out;
  }
  if (typeof obj === "object") {
    for (const v of Object.values(obj as Record<string, unknown>)) {
      flattenText(v, out);
    }
  }
  return out;
}

function extractShortIdLocal(fullId: string): string {
  // Aligné sur server/services/stationsService.ts:extractShortId Phase 8 J2.
  if (/ - Station double 2$/.test(fullId)) {
    const idx = fullId.indexOf(" - ");
    const base = idx === -1 ? fullId : fullId.slice(0, idx);
    return `${base}-P2`;
  }
  const idx = fullId.indexOf(" - ");
  return idx === -1 ? fullId : fullId.slice(0, idx);
}

// ─────────────────────────────────────────────────────────────────────────
// Audit d'une station (pure : prend données déjà chargées en argument)

export function auditStationFromText(
  fullId: string,
  source: string,
  setting: string,
  text: string,
): AuditRow {
  const byCategory: Record<LegalLexiconCategory, number> = {
    secret_pro_levee: 0,
    signalement_maltraitance: 0,
    certificat_complaisance: 0,
    violence_sexuelle_adulte: 0,
    capacite_discernement: 0,
    directives_anticipees: 0,
    responsabilite_teleconsult: 0,
  };
  for (const entry of Object.values(LEGAL_LEXICON)) {
    // On ignore les antiPatterns : ils ne sont PAS des indicateurs
    // pédagogiques positifs (ce sont des choses à éviter, leur présence
    // n'indique pas que la station mérite un legalContext).
    if (entry.antiPattern) continue;
    let hits = 0;
    for (const re of entry.patterns) {
      if (re.test(text)) hits++;
    }
    byCategory[entry.category] += hits;
  }
  const scoreTotal = Object.values(byCategory).reduce((s, n) => s + n, 0);
  const categoriesTouched = Object.values(byCategory).filter((n) => n > 0).length;
  return {
    fullId,
    shortId: extractShortIdLocal(fullId),
    source,
    setting,
    byCategory,
    categoriesTouched,
    scoreTotal,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Audit corpus complet (lecture I/O)

export async function auditAll(opts?: {
  patientDir?: string;
  evaluatorDir?: string;
}): Promise<{ rows: AuditRow[]; summary: AuditSummary }> {
  const pDir = opts?.patientDir ?? PATIENT_DIR;
  const eDir = opts?.evaluatorDir ?? EVALUATOR_DIR;

  // Index des stations évaluateur par fullId pour aplatissement combiné.
  const evaluatorByFullId = new Map<string, unknown>();
  const evalFiles = (await fs.readdir(eDir))
    .filter((f) => f.startsWith("Examinateur_") && f.endsWith(".json"))
    .sort();
  for (const f of evalFiles) {
    const txt = await fs.readFile(path.join(eDir, f), "utf-8");
    const parsed = JSON.parse(txt) as { stations: Array<{ id: string }> };
    for (const s of parsed.stations) {
      if (typeof s.id === "string") evaluatorByFullId.set(s.id, s);
    }
  }

  const patientFiles = (await fs.readdir(pDir))
    .filter((f) => f.startsWith("Patient_") && f.endsWith(".json"))
    .sort();
  const rows: AuditRow[] = [];
  let totalStationsScanned = 0;
  let stationsWithLegalContext = 0;

  for (const f of patientFiles) {
    const txt = await fs.readFile(path.join(pDir, f), "utf-8");
    const parsed = JSON.parse(txt) as {
      source: string;
      stations: Array<Record<string, unknown>>;
    };
    for (const s of parsed.stations) {
      totalStationsScanned++;
      if (s.legalContext !== undefined && s.legalContext !== null) {
        stationsWithLegalContext++;
        continue; // skip stations qui ont DÉJÀ un legalContext
      }
      const fullId = (s.id as string) ?? "<no id>";
      const setting = (s.setting as string) ?? "";
      const evalStation = evaluatorByFullId.get(fullId) ?? null;
      const flat = flattenText(s).concat(flattenText(evalStation));
      const text = flat.join(" \n ");
      rows.push(auditStationFromText(fullId, parsed.source, setting, text));
    }
  }

  // Tri stable par scoreTotal décroissant, puis par fullId (pour idempotence).
  rows.sort((a, b) => b.scoreTotal - a.scoreTotal || a.fullId.localeCompare(b.fullId));

  // Distribution par catégorie.
  const byCategoryStationCount: Record<LegalLexiconCategory, number> = {
    secret_pro_levee: 0,
    signalement_maltraitance: 0,
    certificat_complaisance: 0,
    violence_sexuelle_adulte: 0,
    capacite_discernement: 0,
    directives_anticipees: 0,
    responsabilite_teleconsult: 0,
  };
  const byCategoryTotalHits: Record<LegalLexiconCategory, number> = {
    secret_pro_levee: 0,
    signalement_maltraitance: 0,
    certificat_complaisance: 0,
    violence_sexuelle_adulte: 0,
    capacite_discernement: 0,
    directives_anticipees: 0,
    responsabilite_teleconsult: 0,
  };
  for (const row of rows) {
    for (const cat of LEGAL_LEXICON_CATEGORIES) {
      const hits = row.byCategory[cat];
      if (hits > 0) byCategoryStationCount[cat]++;
      byCategoryTotalHits[cat] += hits;
    }
  }

  return {
    rows,
    summary: {
      lexiconVersion: LEGAL_LEXICON_VERSION,
      totalStationsScanned,
      stationsWithLegalContext,
      stationsWithoutLegalContext: rows.length,
      byCategoryStationCount,
      byCategoryTotalHits,
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Output formatters

const CATEGORY_SHORT_LABEL: Record<LegalLexiconCategory, string> = {
  secret_pro_levee: "secret_pro",
  signalement_maltraitance: "signal",
  certificat_complaisance: "cert",
  violence_sexuelle_adulte: "vsx_adt",
  capacite_discernement: "discern",
  directives_anticipees: "dir_ant",
  responsabilite_teleconsult: "telecons",
};

export function rowsToMarkdownTable(rows: AuditRow[], topN = 30): string {
  const headerCols = [
    "Rang",
    "shortId",
    "source",
    "score",
    "n_cat",
    ...LEGAL_LEXICON_CATEGORIES.map((c) => CATEGORY_SHORT_LABEL[c]),
    "setting",
  ];
  const lines: string[] = [];
  lines.push(`| ${headerCols.join(" | ")} |`);
  lines.push(`|${headerCols.map(() => "---").join("|")}|`);
  const slice = rows.slice(0, topN);
  for (let i = 0; i < slice.length; i++) {
    const r = slice[i];
    const settingShort =
      r.setting.length > 40 ? r.setting.slice(0, 37) + "..." : r.setting;
    const catCells = LEGAL_LEXICON_CATEGORIES.map((c) =>
      r.byCategory[c] > 0 ? String(r.byCategory[c]) : "·",
    );
    lines.push(
      `| ${i + 1} | ${r.shortId} | ${r.source} | ${r.scoreTotal} | ${r.categoriesTouched} | ${catCells.join(" | ")} | ${settingShort} |`,
    );
  }
  return lines.join("\n");
}

export function summaryToMarkdown(summary: AuditSummary): string {
  const lines: string[] = [];
  lines.push("### Distribution par catégorie médico-légale (lexicon v" + summary.lexiconVersion + ")");
  lines.push("");
  lines.push("| Catégorie | Stations avec ≥ 1 hit | Total hits sur le corpus |");
  lines.push("|---|---|---|");
  for (const cat of LEGAL_LEXICON_CATEGORIES) {
    lines.push(
      `| ${cat} | ${summary.byCategoryStationCount[cat]} | ${summary.byCategoryTotalHits[cat]} |`,
    );
  }
  lines.push("");
  lines.push(
    `Stations scannées au total : **${summary.totalStationsScanned}** (${summary.stationsWithLegalContext} déjà annotées exclues, **${summary.stationsWithoutLegalContext}** auditées).`,
  );
  return lines.join("\n");
}

// ─────────────────────────────────────────────────────────────────────────
// CLI

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const useJson = args.includes("--json");
  let topN = 30;
  const idx = args.indexOf("--top");
  if (idx !== -1 && args[idx + 1]) {
    const n = Number.parseInt(args[idx + 1], 10);
    if (Number.isFinite(n) && n > 0) topN = n;
  }
  const { rows, summary } = await auditAll();
  if (useJson) {
    // eslint-disable-next-line no-console
    console.log(JSON.stringify({ summary, rows }, null, 2));
    return;
  }
  // eslint-disable-next-line no-console
  console.log(summaryToMarkdown(summary));
  // eslint-disable-next-line no-console
  console.log("\n### Top " + topN + " candidats par scoreTotal\n");
  // eslint-disable-next-line no-console
  console.log(rowsToMarkdownTable(rows, topN));
}

// Exécute uniquement si lancé directement via tsx (pas en import test).
const invokedDirect =
  typeof process !== "undefined" &&
  process.argv[1] &&
  process.argv[1].endsWith("audit-282-stations-no-legal.ts");
if (invokedDirect) {
  main().catch((err) => {
    // eslint-disable-next-line no-console
    console.error("[audit-282-stations] error:", err);
    process.exit(1);
  });
}
