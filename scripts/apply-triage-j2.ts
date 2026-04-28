// Phase 6 J2 — application effective du CSV de triage validé.
//
// CONTRAT
//   • Lit triage-output/phase-6-j1-validated.csv (CSV J1 augmenté de
//     human_validated_status / human_validated_category / human_notes).
//   • Pour chaque station :
//       - Status A USMLE Triage 39 : ajoute le legalContext complet
//         (catégorie signalement_maltraitance) + medicoLegalReviewed=true.
//       - Status A déjà annoté Phase 5 (3 pilotes) : ajoute uniquement
//         medicoLegalReviewed=true (le legalContext existe déjà).
//       - Status B : ajoute uniquement medicoLegalReviewed=true.
//       - Status C : SKIP (aucune modification — sera traité Phase 7).
//   • IDEMPOTENT : 2 runs successifs ne produisent aucune modification
//     supplémentaire (les stations déjà flaggées sont skippées).
//   • ZÉRO modification du brief patient : seuls les champs additifs
//     (medicoLegalReviewed, legalContext) sont touchés. Aucun champ
//     existant n'est renommé/réordonné/supprimé.
//   • PRÉSERVATION BYTE-FOR-BYTE du formatting des fixtures : on
//     n'utilise PAS JSON.stringify pour réécrire les fichiers (ça
//     reformaterait German_2 qui mélange compact et indenté). On édite
//     le texte source directement, avec une fonction de matching
//     balanced-braces pour localiser chaque station, et on insère les
//     nouveaux champs juste avant la `}` de fin de station.
//
// USAGE
//   npx tsx scripts/apply-triage-j2.ts
//   → log : N marquées / N already / N skipped (status C) / N erreurs
//
// INVARIANTS Phase 6 J2
//   • ZÉRO appel LLM. Lecture CSV + manipulation texte pure.
//   • Une seule catégorie nouvelle utilisée : signalement_maltraitance
//     (lexique v1.0.0 inchangé).
//   • USMLE-9 (status C) reste sans medicoLegalReviewed (cf. brief J2).

import { promises as fs } from "fs";
import path from "path";
import { fileURLToPath } from "url";

// ─── Constantes ──────────────────────────────────────────────────────

const PROJECT_ROOT = path.resolve(
  fileURLToPath(new URL(".", import.meta.url)),
  "..",
);
const PATIENT_DIR = path.join(PROJECT_ROOT, "server", "data", "patient");
const VALIDATED_CSV = path.join(
  PROJECT_ROOT,
  "triage-output",
  "phase-6-j1-validated.csv",
);

// LegalContext canonique pour USMLE Triage 39 — aligné sur USMLE-34
// (autre station signalement_maltraitance, cadre légal CH cohérent).
// Mineur : Joey, 3 ans (fille de l'appelante Kelly Richards).
export const USMLE_TRIAGE_39_LEGAL_CONTEXT = {
  category: "signalement_maltraitance",
  jurisdiction: "CH",
  subject_status: "minor",
  applicable_law: ["CP-321", "CP-364", "CP-364bis", "CC-307", "CC-314c"],
  mandatory_reporting: true,
  expected_decision: "report",
  decision_rationale:
    "Suspicion fondée de maltraitance sexuelle d'une mineure de 3 ans (Joey, fille de l'appelante Kelly Richards). En droit fédéral suisse, l'art. 364bis CP (devoir d'aviser pour les professionnels en contact avec des mineurs, en vigueur depuis 2019) et l'art. 314c CC (signalement à l'APEA mineur) imposent au médecin de signaler tout indice concret de mise en danger d'un mineur, MÊME quand l'information est recueillie par téléphone. Les indices verbaux rapportés (marques sur parties intimes, irritabilité sans raison apparente, modification comportementale, contexte de garde paternelle conflictuelle) constituent une suspicion fondée. Décision canonique : ORGANISER une évaluation physique en urgence (consultation pédiatrique au cabinet ou aux urgences) ET signaler à l'APEA en parallèle, en informant la mère du signalement par transparence. Le secret professionnel (CP-321) ne fait pas obstacle car CP-364bis et CC-314c constituent les bases légales explicites de levée pour la protection de l'enfance (CC-307 mesures de protection).",
  red_flags: [
    "marques observées par la mère sur les parties intimes de l'enfant",
    "irritabilité sans raison apparente, modification comportementale (« n'agit pas comme d'habitude »)",
    "pleurs au change rapportés par la mère",
    "contexte de garde paternelle conflictuelle (séparation, divorce)",
    "mère en larmes avec demande explicite « à quoi ça ressemble si quelqu'un lui faisait quelque chose »",
  ],
  candidate_must_verbalize: [
    "obligation de signalement APEA pour mineur en danger (art. 364bis CP / art. 314c CC)",
    "documentation rigoureuse des éléments téléphoniques entendus",
    "orientation vers consultation physique en urgence pour examen pédiatrique spécialisé",
    "secret professionnel levé en cas de signalement obligatoire pour mineur",
    "ressources LAVI et service de protection de l'enfance cantonal",
    "soutien et écoute non-jugeante de la mère, validation de sa démarche",
  ],
  candidate_must_avoid: [
    "rassurer faussement la mère que ce n'est probablement rien",
    "minimiser les indices verbaux (irritabilité, marques, comportement inhabituel)",
    "promettre la confidentialité absolue malgré le contexte de mineur en danger",
    "accepter le récit unique de la mère sans organiser une évaluation médicale physique",
    "imposer un dépôt de plainte immédiat avant toute évaluation",
  ],
} as const;

// ─── Parsing CSV (RFC 4180 minimal) ──────────────────────────────────

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let i = 0;
  let inQuotes = false;
  while (i < text.length) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i += 2;
        continue;
      }
      if (c === '"') {
        inQuotes = false;
        i += 1;
        continue;
      }
      cell += c;
      i += 1;
      continue;
    }
    if (c === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (c === ",") {
      row.push(cell);
      cell = "";
      i += 1;
      continue;
    }
    if (c === "\n" || c === "\r") {
      row.push(cell);
      cell = "";
      if (row.length > 1 || row[0] !== "") rows.push(row);
      row = [];
      if (c === "\r" && text[i + 1] === "\n") i += 2;
      else i += 1;
      continue;
    }
    cell += c;
    i += 1;
  }
  if (cell !== "" || row.length > 0) {
    row.push(cell);
    if (row.length > 1 || row[0] !== "") rows.push(row);
  }
  return rows;
}

// ─── Lecture du CSV validé ────────────────────────────────────────────

export interface ValidatedRow {
  id: string;
  human_validated_status: "A" | "B" | "C";
  human_validated_category: string;
}

export async function readValidatedCsv(csvPath = VALIDATED_CSV): Promise<ValidatedRow[]> {
  const text = await fs.readFile(csvPath, "utf-8");
  const rows = parseCsv(text);
  if (rows.length < 2) return [];
  const header = rows[0];
  const idxId = header.indexOf("id");
  const idxStatus = header.indexOf("human_validated_status");
  const idxCat = header.indexOf("human_validated_category");
  if (idxId < 0 || idxStatus < 0 || idxCat < 0) {
    throw new Error(
      `CSV malformé : colonnes manquantes (id=${idxId}, human_validated_status=${idxStatus}, human_validated_category=${idxCat})`,
    );
  }
  return rows.slice(1).map((r) => {
    const status = r[idxStatus];
    if (status !== "A" && status !== "B" && status !== "C") {
      throw new Error(`Status invalide pour ${r[idxId]}: « ${status} »`);
    }
    return {
      id: r[idxId],
      human_validated_status: status,
      human_validated_category: r[idxCat],
    };
  });
}

// ─── Matching balanced-braces dans le texte JSON ─────────────────────
//
// Localise une station dans le texte source par son `id` complet, et
// retourne la position de la `}` qui ferme l'objet station. Permet
// d'insérer des champs additifs sans toucher au formatting du reste.

interface StationBraces {
  open: number;
  close: number;
  idIdx: number;
}

function findStationBraces(text: string, fullId: string): StationBraces {
  // On localise le `"id": "<fullId>"` exact (les fixtures n'ont pas
  // de variation de quoting). On échappe les chars regex spéciaux.
  const escapedId = fullId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const idRegex = new RegExp(`"id"\\s*:\\s*"${escapedId}"`);
  const m = idRegex.exec(text);
  if (!m) throw new Error(`Station id non trouvée dans le texte : ${fullId}`);
  const idIdx = m.index;
  // Trouver le `{` ouvrant qui contient cet id (premier `{` en remontant).
  let open = idIdx;
  while (open >= 0 && text[open] !== "{") open--;
  if (open < 0) throw new Error(`Brace ouvrante introuvable pour ${fullId}`);
  // Trouver la `}` correspondante via balanced-braces (en respectant les strings JSON).
  let depth = 1;
  let i = open + 1;
  let inStr = false;
  let esc = false;
  while (i < text.length) {
    const c = text[i];
    if (esc) {
      esc = false;
      i++;
      continue;
    }
    if (inStr) {
      if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
      i++;
      continue;
    }
    if (c === '"') {
      inStr = true;
      i++;
      continue;
    }
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return { open, close: i, idIdx };
    }
    i++;
  }
  throw new Error(`Brace fermante introuvable pour ${fullId}`);
}

function getIndent(text: string, charIdx: number): string {
  const nl = text.lastIndexOf("\n", charIdx);
  return text.slice(nl + 1, charIdx);
}

// Vérifie si une station a déjà un champ donné (on regarde dans la
// portion de texte entre open et close — pas exhaustif si nested mais
// suffisant pour les champs top-level qu'on ajoute en J2).
function stationHasField(text: string, b: StationBraces, fieldName: string): boolean {
  const slice = text.slice(b.open, b.close + 1);
  // On cherche `"<fieldName>":` en top-level. Pour rester strict on
  // matche avec le même indent que `"id":`.
  const indent = getIndent(text, b.idIdx);
  // Pattern : newline + indent + "fieldName":
  const pat = new RegExp(`\\n${indent.replace(/[ \t]/g, "[ \\t]")}"${fieldName}"\\s*:`);
  return pat.test(slice);
}

// Construit l'insertion à pousser juste avant la `}` fermante d'une
// station, pour ajouter un champ.
function buildInsertion(
  fieldName: string,
  fieldValue: unknown,
  indent: string,
): string {
  let serialized: string;
  if (typeof fieldValue === "object" && fieldValue !== null) {
    // JSON.stringify avec indent 2 produit un texte multi-ligne ;
    // on indente chaque ligne (sauf la 1ère) avec l'indent de la
    // station pour rester aligné.
    const raw = JSON.stringify(fieldValue, null, 2);
    serialized = raw.replace(/\n/g, "\n" + indent);
  } else {
    serialized = JSON.stringify(fieldValue);
  }
  // Préfixe : virgule + newline + indent (on s'attache au champ
  // précédent qui se termine par `\n      "previous": ...` →
  // on ajoute `,\n      "newField": ...`).
  return `,\n${indent}"${fieldName}": ${serialized}`;
}

interface FieldEdit {
  name: string;
  value: unknown;
}

interface StationEdit {
  fullId: string;
  fields: FieldEdit[]; // dans l'ordre d'insertion
}

// Applique tous les edits sur le texte d'un fichier en une passe.
// Les insertions sont calculées sur le texte ORIGINAL puis appliquées
// de la fin vers le début pour ne pas invalider les positions.
function applyEditsToText(originalText: string, edits: StationEdit[]): string {
  const insertions: Array<{ pos: number; text: string }> = [];
  for (const e of edits) {
    if (e.fields.length === 0) continue;
    const b = findStationBraces(originalText, e.fullId);
    const indent = getIndent(originalText, b.idIdx);
    // Position d'insertion : juste avant le `\n` qui précède la `}` de
    // fermeture (= immédiatement après le dernier champ existant).
    let nlBeforeClose = b.close;
    while (nlBeforeClose > b.open && originalText[nlBeforeClose] !== "\n") {
      nlBeforeClose--;
    }
    if (nlBeforeClose === b.open) {
      throw new Error(
        `Format inattendu dans la station ${e.fullId} : pas de \\n avant la } de fermeture`,
      );
    }
    const text = e.fields.map((f) => buildInsertion(f.name, f.value, indent)).join("");
    insertions.push({ pos: nlBeforeClose, text });
  }
  insertions.sort((a, b) => b.pos - a.pos);
  let out = originalText;
  for (const ins of insertions) {
    out = out.slice(0, ins.pos) + ins.text + out.slice(ins.pos);
  }
  return out;
}

// ─── Application des annotations ─────────────────────────────────────

export interface ApplyStats {
  flagged: number;          // medicoLegalReviewed posé pour la 1ère fois
  alreadyFlagged: number;   // medicoLegalReviewed=true déjà présent
  skipped: number;          // status C (USMLE-9)
  legalContextAdded: number;
  legalContextAlreadyPresent: number;
  filesWritten: number;
  errors: string[];
}

function extractShortId(fullId: string): string {
  const idx = fullId.indexOf(" - ");
  return idx === -1 ? fullId : fullId.slice(0, idx);
}

export interface ApplyOpts {
  patientDir?: string;
  csvPath?: string;
  // Le legalContext à appliquer pour USMLE Triage 39 (par défaut le
  // canonique). Surchargeable pour les tests.
  usmleTriage39LegalContext?: object;
  // Si false, dry run (pas d'écriture sur disque). Par défaut true.
  write?: boolean;
}

export async function applyTriageJ2(opts: ApplyOpts = {}): Promise<ApplyStats> {
  const patientDir = opts.patientDir ?? PATIENT_DIR;
  const csvPath = opts.csvPath ?? VALIDATED_CSV;
  const legalCtx = opts.usmleTriage39LegalContext ?? USMLE_TRIAGE_39_LEGAL_CONTEXT;
  const write = opts.write ?? true;

  const validated = await readValidatedCsv(csvPath);
  const byId = new Map<string, ValidatedRow>();
  for (const r of validated) byId.set(r.id, r);

  const stats: ApplyStats = {
    flagged: 0,
    alreadyFlagged: 0,
    skipped: 0,
    legalContextAdded: 0,
    legalContextAlreadyPresent: 0,
    filesWritten: 0,
    errors: [],
  };

  const files = await fs.readdir(patientDir);
  const patientFiles = files
    .filter((f) => f.startsWith("Patient_") && f.endsWith(".json"))
    .sort();

  for (const file of patientFiles) {
    const filePath = path.join(patientDir, file);
    const original = await fs.readFile(filePath, "utf-8");
    let parsed: { stations: Array<Record<string, unknown>> };
    try {
      parsed = JSON.parse(original);
    } catch (e) {
      stats.errors.push(`${file}: JSON parse error: ${(e as Error).message}`);
      continue;
    }

    // 1ère passe : déterminer la liste des edits par station.
    const fileEdits: StationEdit[] = [];
    const seenInThisFile = new Set<string>();
    for (const station of parsed.stations) {
      const fullId = station.id as string;
      if (typeof fullId !== "string") continue;
      const shortId = extractShortId(fullId);
      // Garde-fou doublons (cf. RESCOS-64) : on traite la PREMIÈRE
      // occurrence — cohérent avec stationsService.
      if (seenInThisFile.has(shortId)) continue;
      seenInThisFile.add(shortId);

      const row = byId.get(shortId);
      if (!row) {
        stats.errors.push(`${shortId}: présent dans le JSON mais absent du CSV validé`);
        continue;
      }

      // Status C → skip.
      if (row.human_validated_status === "C") {
        stats.skipped += 1;
        continue;
      }

      const fields: FieldEdit[] = [];
      const b = findStationBraces(original, fullId);

      // USMLE Triage 39 : ajouter legalContext s'il n'est pas déjà présent.
      if (shortId === "USMLE Triage 39") {
        if (stationHasField(original, b, "legalContext")) {
          stats.legalContextAlreadyPresent += 1;
        } else {
          fields.push({
            name: "legalContext",
            value: JSON.parse(JSON.stringify(legalCtx)) as unknown,
          });
          stats.legalContextAdded += 1;
        }
      }

      // medicoLegalReviewed=true (toutes les stations sauf status C).
      if (stationHasField(original, b, "medicoLegalReviewed")) {
        stats.alreadyFlagged += 1;
      } else {
        fields.push({ name: "medicoLegalReviewed", value: true });
        stats.flagged += 1;
      }

      if (fields.length > 0) {
        fileEdits.push({ fullId, fields });
      }
    }

    if (fileEdits.length === 0) continue;
    const updated = applyEditsToText(original, fileEdits);
    if (updated === original) continue;
    if (write) {
      await fs.writeFile(filePath, updated, "utf-8");
    }
    stats.filesWritten += 1;
  }

  return stats;
}

// ─── CLI ──────────────────────────────────────────────────────────────

function formatStats(s: ApplyStats): string {
  const lines: string[] = [];
  lines.push(`\n────────── Apply triage Phase 6 J2 ──────────`);
  lines.push(`Stations marquées (medicoLegalReviewed=true)         : ${s.flagged}`);
  lines.push(`Stations déjà marquées (idempotent skip)             : ${s.alreadyFlagged}`);
  lines.push(`Stations skippées (status C, non annotées Phase 6)   : ${s.skipped}`);
  lines.push(`legalContext ajouté (USMLE Triage 39)                : ${s.legalContextAdded}`);
  lines.push(`legalContext déjà présent (3 pilotes Phase 5 + idem) : ${s.legalContextAlreadyPresent}`);
  lines.push(`Fichiers JSON réécrits                               : ${s.filesWritten}`);
  lines.push(`Erreurs                                              : ${s.errors.length}`);
  if (s.errors.length > 0) {
    for (const e of s.errors) lines.push(`  - ${e}`);
  }
  lines.push(`──────────────────────────────────────────────`);
  return lines.join("\n");
}

async function main(): Promise<void> {
  const stats = await applyTriageJ2();
  // eslint-disable-next-line no-console
  console.log(formatStats(stats));
  if (stats.errors.length > 0) process.exitCode = 1;
}

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
    console.error("[apply-triage-j2] fatal:", err);
    process.exit(1);
  });
}
