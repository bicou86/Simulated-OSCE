// Phase 11 J3 — Script de migration des fixtures patient.
//
// OBJECTIF
//   Injecter le champ additif `pedagogicalContent` dans chaque station
//   du catalogue (server/data/patient/Patient_*.json) à partir des 285
//   fichiers déposés dans tmp/phase11-pedagogy-source/, puis renommer
//   les fichiers d'images dans client/public/pedagogical-images/ vers
//   leur slug canonique (cf. shared/pedagogical-image-slug.ts).
//
// MAPPING (A9)
//   • Le préfixe du nom de fichier source jusqu'au premier " - " est le
//     code station candidat (espaces internes → tirets).
//   • Lookup case-insensitive dans le catalogue.
//   • Match unique → mapping retenu, autrement listé dans `unmapped[]`.
//
// IMAGES (A10, A18, A19, A20, A21)
//   • Source de vérité = champ `data` du JSON source (basename extrait).
//   • Slugification déterministe via slugifyPedagogicalImageName().
//   • Si fichier disque trouvé sous son nom original → renommé vers slug
//     dans le commit data. Si fichier disque déjà nommé avec son slug →
//     pas de rename. Si fichier source ET slug coexistent → cas
//     « déjà migré », pas de rename.
//   • Collision (deux basenames distincts → même slug) → SlugCollisionError
//     fail-fast, abort de la migration.
//   • Fichier disque jamais référencé par aucune source → orphelin,
//     pas de rename, listé dans `imagesOrphans[]`.
//
// CONTRAT (A13, A14, A22)
//   • Dry-run par défaut (sans flag) : génère docs/phase-11-migration-report.json,
//     n'écrit AUCUN Patient_*.json ni rename d'image.
//   • --apply : applique les écritures (Patient_*.json + renames).
//   • --strict : exit 1 si unmapped.length > 0 (CI future).
//   • Idempotent : un second --apply ne produit aucun diff.
//   • Schéma additif strict : `pedagogicalContent` inséré en DERNIÈRE
//     position de chaque station, jamais ailleurs. Aucun champ
//     existant touché.
//   • UTF-8 strict, sortie JSON.stringify(parsed, null, 2) + "\n".
//
// USAGE
//   npx tsx scripts/migrate-pedagogical-content.ts            # dry-run
//   npx tsx scripts/migrate-pedagogical-content.ts --apply    # écrit
//   npx tsx scripts/migrate-pedagogical-content.ts --apply --strict
//
// Exit codes :
//   0 : succès (dry-run propre OU --apply réussi)
//   1 : erreur de validation, collision, ou (en --strict) sources non
//       mappables au-dessus du seuil

import { promises as fs } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  pedagogicalContentSchema,
  type PedagogicalContent,
  type PedagogicalImage,
} from "../shared/pedagogical-content-schema";
import { slugifyPedagogicalImageName } from "../shared/pedagogical-image-slug";

// ─── Erreurs typées ────────────────────────────────────────────────────

export class SlugCollisionError extends Error {
  constructor(
    public readonly collisions: Array<{ slug: string; conflictingBasenames: string[] }>,
  ) {
    super(
      `Phase 11 J3 — collision de slug détectée pour ${collisions.length} groupe(s) : ${collisions
        .map((c) => `${c.slug} ← {${c.conflictingBasenames.join(", ")}}`)
        .join(" ; ")}`,
    );
    this.name = "SlugCollisionError";
  }
}

// ─── Types du rapport ──────────────────────────────────────────────────

export interface MigrationReport {
  phase: "11J3";
  generatedAt: string;
  mode: "dry-run" | "applied";
  totalSources: number;
  totalCatalogStations: number;
  mapped: Array<{
    stationId: string;
    sourceFile: string;
    imagesMigrated: number;
    imagesOmitted: number;
  }>;
  unmapped: Array<{ sourceFile: string; reason: string }>;
  stationsWithoutSource: string[];
  validationErrors: Array<{ stationId: string; sourceFile: string; zodError: string }>;
  imagesOnDiskTotal: number;
  imagesReferencedTotal: number;
  imagesMissingOnDisk: string[];
  imagesRenamed: Array<{ from: string; to: string }>;
  imagesOrphans: string[];
  slugCollisions: Array<{ slug: string; conflictingBasenames: string[] }>;
}

// ─── Options CLI / overrides paths (utilisés par les tests dry-run) ───

export interface MigrationOptions {
  apply: boolean;
  strict: boolean;
  sourceDir: string;
  patientDir: string;
  imagesDir: string;
  reportPath: string;
}

// ─── Constantes paths par défaut ───────────────────────────────────────

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

export function defaultOptions(overrides: Partial<MigrationOptions> = {}): MigrationOptions {
  return {
    apply: false,
    strict: false,
    sourceDir: path.join(ROOT, "tmp", "phase11-pedagogy-source"),
    patientDir: path.join(ROOT, "server", "data", "patient"),
    imagesDir: path.join(ROOT, "client", "public", "pedagogical-images"),
    reportPath: path.join(ROOT, "docs", "phase-11-migration-report.json"),
    ...overrides,
  };
}

// ─── Catalogue minimal (offline, sans boot serveur) ───────────────────
//
// Réimplémentation locale d'`extractShortId` pour ne pas booter le
// catalog runtime (qui logue 288 lignes JSON et lance des validations
// référentielles non pertinentes ici). Cohérent avec
// scripts/triage-medico-legal.ts qui a la même approche offline.

function extractShortId(fullId: string): string {
  if (/ - Station double 2$/.test(fullId)) {
    const idx = fullId.indexOf(" - ");
    const base = idx === -1 ? fullId : fullId.slice(0, idx);
    return `${base}-P2`;
  }
  const idx = fullId.indexOf(" - ");
  return idx === -1 ? fullId : fullId.slice(0, idx);
}

interface CatalogEntry {
  shortId: string;
  fullId: string;
  patientFile: string;
  indexInFile: number;
}

async function loadCatalog(patientDir: string): Promise<Map<string, CatalogEntry>> {
  const files = (await fs.readdir(patientDir)).filter(
    (f) => f.startsWith("Patient_") && f.endsWith(".json"),
  );
  const catalog = new Map<string, CatalogEntry>();
  for (const file of files) {
    const content = await fs.readFile(path.join(patientDir, file), "utf-8");
    const parsed = JSON.parse(content) as { stations: Array<{ id: string }> };
    parsed.stations.forEach((station, idx) => {
      const shortId = extractShortId(station.id);
      if (catalog.has(shortId)) return;
      catalog.set(shortId, {
        shortId,
        fullId: station.id,
        patientFile: file,
        indexInFile: idx,
      });
    });
  }
  return catalog;
}

// ─── Mapping nom de fichier source → stationId ─────────────────────────
//
// Convention A9 : préfixe avant le premier " - " du nom de fichier
// source. ATTENTION : on PRÉSERVE les espaces tels quels — la moitié
// des shortId catalog (40 entrées « USMLE Triage N ») contiennent des
// espaces littéralement, pas des tirets. Toute substitution
// space→dash casserait le mapping de ces stations.

export function deriveStationCandidate(sourceFile: string): string {
  const stem = sourceFile.replace(/\.json$/i, "");
  const idx = stem.indexOf(" - ");
  return idx === -1 ? stem : stem.slice(0, idx);
}

// Lookup à 2 passes :
//   1. Exact (case-insensitive) — couvre la majorité des cas
//      (AMBOSS-N, USMLE Triage N, RESCOS-N propres).
//   2. Préfixe + séparateur attendu — fallback de sécurité au cas où
//      un shortId catalog malformé (séparateur « - » sans espace
//      autour) empêcherait `extractShortId` de séparer correctement.
//      Le typo historique « RESCOS-10 -Céphalée » (Phase 11) a été
//      corrigé en Phase 12 J2 ; cette passe est conservée
//      défensivement pour les futurs imports tant que la convention
//      de nommage n'est pas formalisée par un schéma Zod.
//   3. Si > 1 match préfixe → ambigu, retourne null (sécurité).
function lookupStationId(
  candidate: string,
  catalog: Map<string, CatalogEntry>,
): string | null {
  const lc = candidate.toLowerCase();
  for (const [id] of catalog) {
    if (id.toLowerCase() === lc) return id;
  }
  const prefix = lc + " ";
  const matches: string[] = [];
  for (const [id] of catalog) {
    if (id.toLowerCase().startsWith(prefix)) matches.push(id);
  }
  if (matches.length === 1) return matches[0];
  return null;
}

// ─── Construction du pedagogicalContent à partir d'un JSON source ─────

interface BuildResult {
  content: PedagogicalContent | null;
  imagesMigrated: number;
  imagesOmitted: number;
  missingOnDisk: string[];
  /** basename original → slug canonique (pour rename différé) */
  renames: Map<string, string>;
}

export function buildPedagogicalContent(
  source: unknown,
  imagesOnDisk: Set<string>,
  registerSlug: (slug: string, basename: string) => void,
): BuildResult {
  const annexes =
    (source as { annexes?: Record<string, unknown> }).annexes ?? {};
  const out: Record<string, unknown> = {};
  if (annexes.resume !== undefined) out.resume = annexes.resume;
  if (annexes.presentationPatient !== undefined) {
    out.presentationPatient = annexes.presentationPatient;
  }
  if (annexes.theoriePratique !== undefined) {
    out.theoriePratique = annexes.theoriePratique;
  }
  // Phase 12 J3 — extension additive ciblée (RESCOS-29, RESCOS-57).
  // Ces 2 champs (informationsExpert, scenarioPatienteStandardisee) sont
  // présents dans la majorité des sources (189/285) mais NON RENDUS par
  // ReportPdf.tsx. On les extrait UNIQUEMENT en fallback : quand aucun
  // des 3 champs canoniques (resume, presentationPatient, theoriePratique)
  // n'est présent dans l'output, on récupère les fallbacks pour éviter
  // que la station ne soit classée content=null.
  //
  // Cette asymétrie est documentée dans docs/phase-12-stations-non-applicables.md
  // (section « Champs auxiliaires non extraits par défaut ») et reste
  // réversible : un re-run futur avec un flag MIGRATE_INCLUDE_AUXILIARY=1
  // pourrait extraire systématiquement les 2 champs sur les 189 sources.
  const hasCanonicalContent =
    out.resume !== undefined ||
    out.presentationPatient !== undefined ||
    out.theoriePratique !== undefined;

  if (!hasCanonicalContent) {
    if (annexes.informationsExpert !== undefined) {
      out.informationsExpert = annexes.informationsExpert;
    }
    if (annexes.scenarioPatienteStandardisee !== undefined) {
      out.scenarioPatienteStandardisee = annexes.scenarioPatienteStandardisee;
    }
  }

  const renames = new Map<string, string>();
  const missingOnDisk: string[] = [];
  let imagesMigrated = 0;
  let imagesOmitted = 0;

  const rawImages = (annexes.images as Array<Record<string, unknown>> | undefined) ?? [];
  if (rawImages.length > 0) {
    const migratedImages: PedagogicalImage[] = [];
    for (const img of rawImages) {
      const dataRaw = img.data;
      if (typeof dataRaw !== "string") {
        // Image source sans data : on omet (pas de chemin → pas migrable).
        imagesOmitted++;
        continue;
      }
      const basename = path.basename(dataRaw);
      const slugResult = slugifyPedagogicalImageName(basename);
      // Vérification disque : on accepte basename original OU slug déjà
      // appliqué (idempotence run #2). Sinon image manquante.
      const onDisk = imagesOnDisk.has(basename) || imagesOnDisk.has(slugResult.basename);
      if (!onDisk) {
        missingOnDisk.push(basename);
        imagesOmitted++;
        continue;
      }
      // Enregistre la collision potentielle (slug ← basename).
      registerSlug(slugResult.basename, basename);
      // Si rename nécessaire (basename ≠ slug et le fichier original existe)
      // → différé jusqu'à apply().
      if (basename !== slugResult.basename && imagesOnDisk.has(basename)) {
        renames.set(basename, slugResult.basename);
      }
      // Construire l'entrée migrée (data slugifié, autres champs source
      // préservés via spread).
      const migrated: Record<string, unknown> = { ...img, data: slugResult.url };
      migratedImages.push(migrated as PedagogicalImage);
      imagesMigrated++;
    }
    if (migratedImages.length > 0) {
      out.images = migratedImages;
    }
  }

  if (Object.keys(out).length === 0) {
    return { content: null, imagesMigrated, imagesOmitted, missingOnDisk, renames };
  }
  return {
    content: out as PedagogicalContent,
    imagesMigrated,
    imagesOmitted,
    missingOnDisk,
    renames,
  };
}

// ─── Comparaison structurelle (pour idempotence) ───────────────────────

function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

// ─── Cœur de la migration (testable) ──────────────────────────────────

export async function runMigration(opts: MigrationOptions): Promise<MigrationReport> {
  // 1. Catalogue.
  const catalog = await loadCatalog(opts.patientDir);

  // 2. Sources.
  let sourceFiles: string[] = [];
  try {
    sourceFiles = (await fs.readdir(opts.sourceDir)).filter((f) =>
      f.endsWith(".json"),
    );
  } catch {
    sourceFiles = [];
  }

  // 3. Images sur disque.
  let imagesOnDiskList: string[] = [];
  try {
    imagesOnDiskList = (await fs.readdir(opts.imagesDir)).filter((f) =>
      f.toLowerCase().endsWith(".jpg"),
    );
  } catch {
    imagesOnDiskList = [];
  }
  const imagesOnDisk = new Set(imagesOnDiskList);

  // 4. Mapping.
  const mapped: MigrationReport["mapped"] = [];
  const unmapped: MigrationReport["unmapped"] = [];
  const validationErrors: MigrationReport["validationErrors"] = [];
  const missingOnDiskGlobal = new Set<string>();
  const allRenames = new Map<string, string>();
  const slugRegistry = new Map<string, Set<string>>();

  function registerSlug(slug: string, basename: string): void {
    let s = slugRegistry.get(slug);
    if (!s) {
      s = new Set();
      slugRegistry.set(slug, s);
    }
    s.add(basename);
  }

  // sourceFile → { stationId, content }
  const perStationContent = new Map<string, PedagogicalContent>();
  let imagesReferencedTotal = 0;

  for (const file of sourceFiles) {
    const candidate = deriveStationCandidate(file);
    const stationId = lookupStationId(candidate, catalog);
    if (!stationId) {
      unmapped.push({
        sourceFile: file,
        reason: `Préfixe « ${candidate} » introuvable dans le catalogue (288 stations connues).`,
      });
      continue;
    }
    let source: unknown;
    try {
      source = JSON.parse(await fs.readFile(path.join(opts.sourceDir, file), "utf-8"));
    } catch (e) {
      unmapped.push({ sourceFile: file, reason: `JSON.parse échoué : ${(e as Error).message}` });
      continue;
    }
    const built = buildPedagogicalContent(source, imagesOnDisk, registerSlug);
    imagesReferencedTotal += built.imagesMigrated + built.imagesOmitted;
    for (const m of built.missingOnDisk) missingOnDiskGlobal.add(m);
    for (const [from, to] of built.renames) allRenames.set(from, to);

    if (built.content === null) {
      // Source mappable mais sans contenu pédagogique extrayable :
      // on l'enregistre dans `mapped` avec compteurs zéro pour
      // visibilité, sans injecter de pedagogicalContent.
      mapped.push({
        stationId,
        sourceFile: file,
        imagesMigrated: 0,
        imagesOmitted: built.imagesOmitted,
      });
      continue;
    }

    // Validation Zod (le schéma J2bis accepte récursif + passthrough).
    const result = pedagogicalContentSchema.safeParse(built.content);
    if (!result.success) {
      validationErrors.push({
        stationId,
        sourceFile: file,
        zodError: result.error.issues
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .join(" | "),
      });
      continue;
    }

    perStationContent.set(stationId, result.data);
    mapped.push({
      stationId,
      sourceFile: file,
      imagesMigrated: built.imagesMigrated,
      imagesOmitted: built.imagesOmitted,
    });
  }

  // 5. Détection collisions.
  const slugCollisions: MigrationReport["slugCollisions"] = [];
  for (const [slug, basenames] of slugRegistry) {
    if (basenames.size > 1) {
      slugCollisions.push({ slug, conflictingBasenames: [...basenames] });
    }
  }
  if (slugCollisions.length > 0) {
    throw new SlugCollisionError(slugCollisions);
  }

  // 6. Stations sans source.
  const stationsWithoutSource: string[] = [];
  for (const [shortId] of catalog) {
    if (!mapped.some((m) => m.stationId === shortId)) {
      stationsWithoutSource.push(shortId);
    }
  }

  // 7. Orphelins disque (présents mais jamais référencés).
  const referencedBasenames = new Set<string>();
  for (const slug of slugRegistry.keys()) referencedBasenames.add(slug);
  for (const original of slugRegistry.values()) {
    for (const b of original) referencedBasenames.add(b);
  }
  const imagesOrphans: string[] = [];
  for (const f of imagesOnDiskList) {
    if (!referencedBasenames.has(f)) imagesOrphans.push(f);
  }

  // 8. Application (uniquement si --apply, et pas d'erreurs).
  if (opts.apply && validationErrors.length === 0) {
    await applyChanges(opts, catalog, perStationContent, allRenames, imagesOnDisk);
  }

  // 9. Rapport.
  const report: MigrationReport = {
    phase: "11J3",
    generatedAt: new Date().toISOString(),
    mode: opts.apply ? "applied" : "dry-run",
    totalSources: sourceFiles.length,
    totalCatalogStations: catalog.size,
    mapped: mapped.sort((a, b) => a.stationId.localeCompare(b.stationId)),
    unmapped,
    stationsWithoutSource: stationsWithoutSource.sort(),
    validationErrors,
    imagesOnDiskTotal: imagesOnDiskList.length,
    imagesReferencedTotal,
    imagesMissingOnDisk: [...missingOnDiskGlobal].sort(),
    imagesRenamed: [...allRenames]
      .map(([from, to]) => ({ from, to }))
      .sort((a, b) => a.from.localeCompare(b.from)),
    imagesOrphans: imagesOrphans.sort(),
    slugCollisions,
  };

  return report;
}

// ─── Application effective : Patient_*.json + renames images ───────────

async function applyChanges(
  opts: MigrationOptions,
  catalog: Map<string, CatalogEntry>,
  perStationContent: Map<string, PedagogicalContent>,
  renames: Map<string, string>,
  imagesOnDisk: Set<string>,
): Promise<void> {
  // Renommage des images (idempotent : skip si destination déjà présente).
  for (const [from, to] of renames) {
    if (from === to) continue;
    if (imagesOnDisk.has(to)) {
      // Cas idempotence run #2 : le slug existe déjà, l'original a déjà été
      // déplacé OU coexiste. On ne touche pas (collision déjà détectée).
      continue;
    }
    const fromPath = path.join(opts.imagesDir, from);
    const toPath = path.join(opts.imagesDir, to);
    try {
      await fs.rename(fromPath, toPath);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn(`[migrate-pedagogy] rename ${from} → ${to} échoué : ${(e as Error).message}`);
    }
  }

  // Regroupe les contents par fichier patient.
  const perFile = new Map<string, Array<{ index: number; content: PedagogicalContent }>>();
  for (const [stationId, content] of perStationContent) {
    const meta = catalog.get(stationId);
    if (!meta) continue;
    let list = perFile.get(meta.patientFile);
    if (!list) {
      list = [];
      perFile.set(meta.patientFile, list);
    }
    list.push({ index: meta.indexInFile, content });
  }

  // Pour chaque fichier patient touché : charge, injecte, écrit si diff.
  for (const [file, items] of perFile) {
    const filePath = path.join(opts.patientDir, file);
    const original = await fs.readFile(filePath, "utf-8");
    const parsed = JSON.parse(original) as { stations: Array<Record<string, unknown>> };
    let mutated = false;
    for (const { index, content } of items) {
      const station = parsed.stations[index];
      if (!station) continue;
      const existing = station.pedagogicalContent;
      if (existing !== undefined && deepEqual(existing, content)) continue;
      // Insertion en DERNIÈRE position : on supprime puis on réassigne
      // pour garantir que la clé soit en fin d'objet (ordre d'insertion JS).
      delete station.pedagogicalContent;
      (station as Record<string, unknown>).pedagogicalContent = content;
      mutated = true;
    }
    if (!mutated) continue;
    const serialized = JSON.stringify(parsed, null, 2) + "\n";
    if (serialized !== original) {
      await fs.writeFile(filePath, serialized, "utf-8");
    }
  }
}

// ─── CLI ───────────────────────────────────────────────────────────────

function parseArgs(argv: string[]): { apply: boolean; strict: boolean } {
  return {
    apply: argv.includes("--apply"),
    strict: argv.includes("--strict"),
  };
}

async function writeReport(reportPath: string, report: MigrationReport): Promise<void> {
  await fs.writeFile(reportPath, JSON.stringify(report, null, 2) + "\n", "utf-8");
}

async function main(): Promise<void> {
  const cli = parseArgs(process.argv.slice(2));
  const opts = defaultOptions(cli);
  // eslint-disable-next-line no-console
  console.log(
    `[migrate-pedagogy] mode=${opts.apply ? "apply" : "dry-run"} strict=${opts.strict}`,
  );
  let report: MigrationReport;
  try {
    report = await runMigration(opts);
  } catch (e) {
    if (e instanceof SlugCollisionError) {
      // eslint-disable-next-line no-console
      console.error(e.message);
      process.exit(1);
    }
    throw e;
  }
  await writeReport(opts.reportPath, report);
  // eslint-disable-next-line no-console
  console.log(
    `[migrate-pedagogy] mapping: ${report.mapped.length}/${report.totalSources} sources → catalog stations`,
  );
  // eslint-disable-next-line no-console
  console.log(
    `[migrate-pedagogy] images: référencées=${report.imagesReferencedTotal} renames=${report.imagesRenamed.length} orphans=${report.imagesOrphans.length} missing=${report.imagesMissingOnDisk.length}`,
  );
  // eslint-disable-next-line no-console
  console.log(
    `[migrate-pedagogy] unmapped=${report.unmapped.length} stationsWithoutSource=${report.stationsWithoutSource.length} validationErrors=${report.validationErrors.length}`,
  );
  if (report.validationErrors.length > 0) process.exit(1);
  if (opts.strict && report.unmapped.length > 0) process.exit(1);
  process.exit(0);
}

// Exécution CLI uniquement quand appelé directement (pas en import depuis tests).
const isMain =
  typeof process !== "undefined" &&
  process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((e) => {
    // eslint-disable-next-line no-console
    console.error(e);
    process.exit(1);
  });
}
