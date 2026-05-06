// Phase 12 J5 — clôture Axe A : régénération du snapshot
// tests/fixtures/__snapshots__/phase2-checksum.json après absorption
// de la dette pédagogique (J3/J4ter/J4quater) et alignement de
// `shortIdOf` côté test sur `extractShortId` runtime (Phase 8 J2 :
// distinction RESCOS-64 ≠ RESCOS-64-P2).
//
// CONTRAT
//   • Lit les 14 fichiers server/data/patient/Patient_*.json.
//   • Recalcule le checksum SHA-256 de chaque station (sérialisation
//     déterministe, mêmes règles que server/__tests__/phase2Checksum.test.ts :
//     tri récursif des clés, retrait de legalContext et medicoLegalReviewed
//     au top-level, exclusion des 6 pilotes Phase 3/4/5).
//   • Compare au snapshot courant et imprime un audit pré-flight :
//     totaux, drift attendue (21 stations Phase 12), nouvelles entrées
//     attendues (RESCOS-64-P2 + RESCOS-70/-71/-72), divergences inattendues.
//   • En --apply, écrit le nouveau snapshot avec stationCount = 282.
//
// INVARIANTS Phase 12 J5
//   • Schéma additif strict : aucune entrée existante du snapshot
//     n'est SUPPRIMÉE en checksums (seules 3 entrées de _meta.excluded
//     migrent vers checksums : RESCOS-70/-71/-72).
//   • stationCount cible = 282 (288 unique shortIds − 6 pilotes excluded).
//     Toute autre valeur → STOP avant écriture.
//   • Aucune station inattendue n'apparaît / ne disparaît : l'ensemble
//     des nouvelles entrées doit être exactement
//     { RESCOS-64-P2, RESCOS-70, RESCOS-71, RESCOS-72 } ; l'ensemble
//     des entrées qui changent de hash doit être inclus dans la liste
//     des 21 stations Phase 12 attendues.
//   • Zéro LLM, lecture/écriture de texte pure.
//
// USAGE
//   npx tsx scripts/regenerate-phase2-checksums.ts            # dry-run + audit
//   npx tsx scripts/regenerate-phase2-checksums.ts --apply    # écrit le snapshot
//
// EXIT CODES
//   0 : audit propre (dry-run) ou écriture réussie (--apply).
//   1 : violation d'un invariant — STOP avant écriture.

import { promises as fs } from "fs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";

// ─── Constantes ──────────────────────────────────────────────────────

const PROJECT_ROOT = path.resolve(
  fileURLToPath(new URL(".", import.meta.url)),
  "..",
);
const PATIENT_DIR = path.join(PROJECT_ROOT, "server", "data", "patient");
const SNAPSHOT_PATH = path.join(
  PROJECT_ROOT,
  "tests",
  "fixtures",
  "__snapshots__",
  "phase2-checksum.json",
);

// Pilotes Phase 3/4/5 conservant un schéma additif futur attendu —
// strictement aligné sur PHASE_PILOTS_EXCLUDED côté test post-J5.
const PHASE_PILOTS_EXCLUDED = new Set([
  "AMBOSS-4",
  "RESCOS-9b",
  "RESCOS-13",
  "RESCOS-63",
  "AMBOSS-24",
  "USMLE-34",
]);

// Champs d'audit retirés du hash (cohérent avec le test).
const AUDIT_FIELDS_EXCLUDED_FROM_CHECKSUM = new Set([
  "legalContext",
  "medicoLegalReviewed",
]);

// Drift attendue Phase 12 (5 J3 + 12 J4ter + 4 J4quater = 21 stations
// dont le contenu pédagogique a été enrichi entre Phase 11 J3 et
// Phase 12 J4quater inclus). Toute station qui dérive HORS de cette
// liste est inattendue → STOP.
const PHASE_12_EXPECTED_DRIFT = new Set([
  // Phase 12 J3 (5)
  "AMBOSS-25",
  "German-68",
  "RESCOS-10",
  "RESCOS-29",
  "RESCOS-57",
  // Phase 12 J4ter (12)
  "RESCOS-5",
  "RESCOS-17",
  "RESCOS-19",
  "RESCOS-20",
  "RESCOS-24",
  "RESCOS-32",
  "RESCOS-34",
  "RESCOS-35",
  "RESCOS-41",
  "RESCOS-44",
  "RESCOS-48",
  "RESCOS-50",
  // Phase 12 J4quater (4)
  "RESCOS-14",
  "RESCOS-33",
  "RESCOS-45",
  "RESCOS-47",
]);

// Nouvelles entrées attendues post-J5 :
//   • RESCOS-64-P2 — démasquée par l'alignement shortIdOf sur
//     extractShortId runtime (Phase 8 J2).
//   • RESCOS-70/-71/-72 — sortent de _meta.excluded (pédagogie injectée
//     + schéma additif figé, plus de delta attendu).
const EXPECTED_NEW_ENTRIES = new Set([
  "RESCOS-64-P2",
  "RESCOS-70",
  "RESCOS-71",
  "RESCOS-72",
]);

// ─── extractShortId — réplique runtime (Phase 8 J2) ──────────────────
// Cohérent avec server/services/stationsService.ts:42-59. Toute
// modification de la logique runtime devra être répercutée ici.

function extractShortId(fullId: string): string {
  if (/ - Station double 2$/.test(fullId)) {
    const idx = fullId.indexOf(" - ");
    const base = idx === -1 ? fullId : fullId.slice(0, idx);
    return `${base}-P2`;
  }
  const idx = fullId.indexOf(" - ");
  return idx === -1 ? fullId : fullId.slice(0, idx);
}

// ─── Hash déterministe ───────────────────────────────────────────────
// Identique à server/__tests__/phase2Checksum.test.ts:78-89.

function sortKeysRecursive(v: unknown, isStationRoot = false): unknown {
  if (Array.isArray(v)) return v.map((x) => sortKeysRecursive(x));
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v as Record<string, unknown>).sort()) {
      if (isStationRoot && AUDIT_FIELDS_EXCLUDED_FROM_CHECKSUM.has(k)) continue;
      out[k] = sortKeysRecursive((v as Record<string, unknown>)[k]);
    }
    return out;
  }
  return v;
}

function hashStation(station: unknown): string {
  const canon = JSON.stringify(sortKeysRecursive(station, true));
  return crypto.createHash("sha256").update(canon).digest("hex");
}

// ─── Audit + computation ─────────────────────────────────────────────

interface StationRecord {
  shortId: string;
  fullId: string;
  hasPedagogy: boolean;
  raw: unknown;
}

interface AuditResult {
  totalRows: number;
  uniqueShortIds: number;
  duplicates: Array<{ shortId: string; first: string; then: string }>;
  withPedagogy: number;
  withoutPedagogy: string[];
  allStations: Map<string, StationRecord>;
  checksumsAll: Record<string, string>;
}

async function auditAndCompute(): Promise<AuditResult> {
  const files = (await fs.readdir(PATIENT_DIR))
    .filter((f) => f.startsWith("Patient_") && f.endsWith(".json"))
    .sort();
  const allStations = new Map<string, StationRecord>();
  const duplicates: Array<{ shortId: string; first: string; then: string }> = [];
  let totalRows = 0;
  for (const f of files) {
    const content = await fs.readFile(path.join(PATIENT_DIR, f), "utf-8");
    const parsed = JSON.parse(content) as {
      stations: Array<{ id: string; pedagogicalContent?: unknown }>;
    };
    for (const station of parsed.stations) {
      totalRows++;
      const shortId = extractShortId(station.id);
      if (allStations.has(shortId)) {
        duplicates.push({
          shortId,
          first: allStations.get(shortId)!.fullId,
          then: station.id,
        });
        continue;
      }
      allStations.set(shortId, {
        shortId,
        fullId: station.id,
        hasPedagogy: !!station.pedagogicalContent,
        raw: station,
      });
    }
  }
  const withoutPedagogy: string[] = [];
  let withPedagogy = 0;
  for (const rec of allStations.values()) {
    if (rec.hasPedagogy) withPedagogy++;
    else withoutPedagogy.push(rec.shortId);
  }
  withoutPedagogy.sort();

  // Checksums : strictement les stations NON exclues.
  const checksumsAll: Record<string, string> = {};
  for (const rec of allStations.values()) {
    if (PHASE_PILOTS_EXCLUDED.has(rec.shortId)) continue;
    checksumsAll[rec.shortId] = hashStation(rec.raw);
  }

  return {
    totalRows,
    uniqueShortIds: allStations.size,
    duplicates,
    withPedagogy,
    withoutPedagogy,
    allStations,
    checksumsAll,
  };
}

// ─── Diff vs snapshot existant ───────────────────────────────────────

interface CurrentSnapshot {
  _meta: {
    description?: string;
    excluded?: string[];
    excludedReason?: string;
    generatedAt?: string;
    algorithm?: string;
    stationCount?: number;
    regeneratedAt?: string;
  };
  checksums: Record<string, string>;
}

interface DiffReport {
  newEntries: string[];
  removedEntries: string[];
  changedEntries: string[];
  unchangedCount: number;
}

function diffAgainstCurrent(
  current: CurrentSnapshot,
  next: Record<string, string>,
): DiffReport {
  const oldKeys = new Set(Object.keys(current.checksums));
  const newKeys = new Set(Object.keys(next));
  const newEntries: string[] = [];
  const removedEntries: string[] = [];
  const changedEntries: string[] = [];
  let unchangedCount = 0;
  for (const k of newKeys) {
    if (!oldKeys.has(k)) newEntries.push(k);
    else if (current.checksums[k] !== next[k]) changedEntries.push(k);
    else unchangedCount++;
  }
  for (const k of oldKeys) {
    if (!newKeys.has(k)) removedEntries.push(k);
  }
  newEntries.sort();
  removedEntries.sort();
  changedEntries.sort();
  return { newEntries, removedEntries, changedEntries, unchangedCount };
}

// ─── Validation des invariants ───────────────────────────────────────

interface ValidationError {
  code: string;
  message: string;
}

function validateInvariants(
  audit: AuditResult,
  diff: DiffReport,
): ValidationError[] {
  const errors: ValidationError[] = [];

  // Invariant 1 : aucun doublon avec extractShortId aligné.
  if (audit.duplicates.length > 0) {
    errors.push({
      code: "I-DUP",
      message: `Doublons inattendus (extractShortId aligné devrait éliminer toute collision) : ${audit.duplicates
        .map((d) => `${d.shortId} [${d.first}] ↔ [${d.then}]`)
        .join(", ")}`,
    });
  }

  // Invariant 2 : stationCount cible = 282.
  const stationCount = Object.keys(audit.checksumsAll).length;
  if (stationCount !== 282) {
    errors.push({
      code: "I-COUNT",
      message: `stationCount calculé = ${stationCount}, attendu = 282 (288 uniques − 6 excluded).`,
    });
  }

  // Invariant 3 : aucune entrée du snapshot ancien ne doit DISPARAÎTRE
  // (additif strict — on ne supprime jamais une entrée checksum).
  if (diff.removedEntries.length > 0) {
    errors.push({
      code: "I-REMOVED",
      message: `Entrées du snapshot ancien disparues : ${diff.removedEntries.join(", ")}`,
    });
  }

  // Invariant 4 : nouvelles entrées strictement = EXPECTED_NEW_ENTRIES.
  const newSet = new Set(diff.newEntries);
  const unexpectedNew = diff.newEntries.filter((k) => !EXPECTED_NEW_ENTRIES.has(k));
  const missingNew = [...EXPECTED_NEW_ENTRIES].filter((k) => !newSet.has(k));
  if (unexpectedNew.length > 0) {
    errors.push({
      code: "I-NEW-UNEXPECTED",
      message: `Nouvelles entrées non prévues : ${unexpectedNew.join(", ")}`,
    });
  }
  if (missingNew.length > 0) {
    errors.push({
      code: "I-NEW-MISSING",
      message: `Nouvelles entrées attendues absentes : ${missingNew.join(", ")}`,
    });
  }

  // Invariant 5 : changements de hash ⊆ PHASE_12_EXPECTED_DRIFT.
  const unexpectedDrift = diff.changedEntries.filter(
    (k) => !PHASE_12_EXPECTED_DRIFT.has(k),
  );
  if (unexpectedDrift.length > 0) {
    errors.push({
      code: "I-DRIFT-UNEXPECTED",
      message: `Drift de hash inattendue (hors liste Phase 12) : ${unexpectedDrift.join(", ")}`,
    });
  }

  return errors;
}

// ─── Sérialisation snapshot ──────────────────────────────────────────

function buildSnapshot(
  next: Record<string, string>,
  prevDescription: string | undefined,
): unknown {
  const sortedChecksums: Record<string, string> = {};
  for (const k of Object.keys(next).sort()) sortedChecksums[k] = next[k];
  return {
    _meta: {
      description:
        "SHA-256 checksum (canonical key-sorted JSON) of every station post-Phase 12 J5. Locks the catalog after closure of pedagogical migration (Phase 12 Axe A) and alignment of shortIdOf on runtime extractShortId (Phase 8 J2 — RESCOS-64-P2 distinct). Excluded pilots carry additive schema deltas expected by their respective phases.",
      excluded: [...PHASE_PILOTS_EXCLUDED].sort(),
      excludedReason:
        "Phase 3 J3 pilote (AMBOSS-4) + Phase 4 J1 pilotes (RESCOS-9b, RESCOS-13, RESCOS-63) + Phase 5 J1 pilotes (AMBOSS-24, USMLE-34) — schémas additifs (register/tags, participants[], legalContext) toujours susceptibles d'évoluer. RESCOS-70/-71/-72 SORTENT de l'exclusion en Phase 12 J5 (pédagogie injectée + schéma additif figé) et entrent dans le checksum verrouillé.",
      generatedAt: prevDescription ?? "2026-04-29",
      algorithm: "sha256(JSON.stringify(sortedKeys(station)))",
      stationCount: Object.keys(sortedChecksums).length,
      regeneratedAt:
        "2026-05-05 (Phase 12 J5 — clôture Axe A : regen post-pédagogie + alignement shortIdOf P2)",
    },
    checksums: sortedChecksums,
  };
}

// ─── CLI ─────────────────────────────────────────────────────────────

function parseArgs(argv: string[]): { apply: boolean } {
  return { apply: argv.includes("--apply") };
}

function fmtList(xs: string[], max = 25): string {
  if (xs.length === 0) return "(aucune)";
  const head = xs.slice(0, max).join(", ");
  return xs.length > max ? `${head}, … (+${xs.length - max})` : head;
}

async function main(): Promise<void> {
  const cli = parseArgs(process.argv.slice(2));
  const mode = cli.apply ? "apply" : "dry-run";
  // eslint-disable-next-line no-console
  console.log(`[regen-phase2] mode=${mode}`);

  const audit = await auditAndCompute();
  const currentRaw = await fs.readFile(SNAPSHOT_PATH, "utf-8");
  const current = JSON.parse(currentRaw) as CurrentSnapshot;
  const diff = diffAgainstCurrent(current, audit.checksumsAll);
  const stationCount = Object.keys(audit.checksumsAll).length;

  // ─── Audit pré-flight ─
  // eslint-disable-next-line no-console
  console.log("");
  // eslint-disable-next-line no-console
  console.log("=== Audit pré-flight ===");
  // eslint-disable-next-line no-console
  console.log(`Total rows lues (Patient_*.json)         : ${audit.totalRows}`);
  // eslint-disable-next-line no-console
  console.log(`Unique shortIds (extractShortId aligné)  : ${audit.uniqueShortIds}`);
  // eslint-disable-next-line no-console
  console.log(`Doublons résiduels                       : ${audit.duplicates.length}`);
  // eslint-disable-next-line no-console
  console.log(`Stations avec pedagogicalContent         : ${audit.withPedagogy}`);
  // eslint-disable-next-line no-console
  console.log(`Stations sans pedagogicalContent         : ${audit.withoutPedagogy.length}`);
  // eslint-disable-next-line no-console
  console.log(`  → ${fmtList(audit.withoutPedagogy, 10)}`);
  // eslint-disable-next-line no-console
  console.log(`Stations excluded (pilotes Phase 3/4/5)  : ${PHASE_PILOTS_EXCLUDED.size}`);
  // eslint-disable-next-line no-console
  console.log(`stationCount cible (uniques − excluded)  : ${stationCount}`);

  // ─── Diff vs snapshot ─
  // eslint-disable-next-line no-console
  console.log("");
  // eslint-disable-next-line no-console
  console.log("=== Diff vs snapshot courant ===");
  // eslint-disable-next-line no-console
  console.log(`Snapshot courant    : stationCount=${current._meta.stationCount}, excluded=${current._meta.excluded?.length ?? 0}`);
  // eslint-disable-next-line no-console
  console.log(`Entrées inchangées  : ${diff.unchangedCount}`);
  // eslint-disable-next-line no-console
  console.log(`Entrées modifiées   : ${diff.changedEntries.length}`);
  // eslint-disable-next-line no-console
  console.log(`  → ${fmtList(diff.changedEntries, 25)}`);
  // eslint-disable-next-line no-console
  console.log(`Nouvelles entrées   : ${diff.newEntries.length}`);
  // eslint-disable-next-line no-console
  console.log(`  → ${fmtList(diff.newEntries, 10)}`);
  // eslint-disable-next-line no-console
  console.log(`Entrées disparues   : ${diff.removedEntries.length}`);
  // eslint-disable-next-line no-console
  console.log(`  → ${fmtList(diff.removedEntries, 10)}`);

  // ─── Candidates extraction excluded → checksums ─
  const excludedNowMigrated: string[] = [];
  for (const id of current._meta.excluded ?? []) {
    if (audit.allStations.has(id) && !PHASE_PILOTS_EXCLUDED.has(id)) {
      excludedNowMigrated.push(id);
    }
  }
  excludedNowMigrated.sort();
  // eslint-disable-next-line no-console
  console.log(`Anciens excluded désormais en checksums  : ${fmtList(excludedNowMigrated, 10)}`);

  // ─── Validation ─
  const errors = validateInvariants(audit, diff);
  // eslint-disable-next-line no-console
  console.log("");
  if (errors.length > 0) {
    // eslint-disable-next-line no-console
    console.error("=== STOP — invariants violés ===");
    for (const e of errors) {
      // eslint-disable-next-line no-console
      console.error(`[${e.code}] ${e.message}`);
    }
    process.exit(1);
  }
  // eslint-disable-next-line no-console
  console.log("=== Invariants OK ===");
  // eslint-disable-next-line no-console
  console.log(`  • stationCount = 282 ✓`);
  // eslint-disable-next-line no-console
  console.log(`  • aucune entrée disparue ✓`);
  // eslint-disable-next-line no-console
  console.log(`  • ${diff.newEntries.length} nouvelles entrées ⊆ {RESCOS-64-P2, RESCOS-70, -71, -72} ✓`);
  // eslint-disable-next-line no-console
  console.log(`  • ${diff.changedEntries.length} drift ⊆ liste Phase 12 (21 stations attendues) ✓`);

  // ─── Écriture ou dry-run ─
  const snapshot = buildSnapshot(audit.checksumsAll, current._meta.generatedAt);
  if (cli.apply) {
    const serialized = JSON.stringify(snapshot, null, 2) + "\n";
    await fs.writeFile(SNAPSHOT_PATH, serialized, "utf-8");
    // eslint-disable-next-line no-console
    console.log("");
    // eslint-disable-next-line no-console
    console.log(`[regen-phase2] snapshot écrit : ${path.relative(PROJECT_ROOT, SNAPSHOT_PATH)}`);
  } else {
    // eslint-disable-next-line no-console
    console.log("");
    // eslint-disable-next-line no-console
    console.log("[regen-phase2] dry-run — aucun fichier modifié. Relancer avec --apply.");
  }
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(e);
  process.exit(1);
});
