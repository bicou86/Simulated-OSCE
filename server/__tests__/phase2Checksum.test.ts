// Phase 3 J4 — verrou de non-régression byte-identique sur les stations
// Phase 2 NON touchées par les phases ultérieures.
//
// Le test recalcule un SHA-256 sur la sérialisation déterministe (JSON keys
// triées récursivement) de chaque station et compare au snapshot
// `tests/fixtures/__snapshots__/phase2-checksum.json`. Si une station Phase 2
// est byte-modifiée par mégarde lors d'un merge, le test échoue immédiatement
// en pointant l'ID concerné.
//
// Stations volontairement exclues du checksum :
//   • Phase 3 J3 — AMBOSS-4 : champs additifs
//     (register, patient_age_years, motif_cache, tags).
//   • Phase 4 J1 — RESCOS-9b, RESCOS-13, RESCOS-63 : champ additif
//     `participants[]` pour la composition multi-profils (ado + mère,
//     enfant + parent, …).
//   • Phase 5 J1 — AMBOSS-24, USMLE-34 : champ additif `legalContext`.
// Phase 12 J5 — RESCOS-70, RESCOS-71, RESCOS-72 ont quitté l'exclusion
// (pédagogie injectée + schéma additif figé) et entrent dans le checksum
// verrouillé. Le verrou s'établit à 282 stations.
//
// Pour mettre à jour le snapshot après un changement Phase 2 *intentionnel*,
// supprimer phase2-checksum.json et relancer le test avec
// UPDATE_PHASE2_CHECKSUM=1 — il regénère le snapshot et fait passer le test.

import { describe, expect, it } from "vitest";
import { promises as fs } from "fs";
import path from "path";
import crypto from "crypto";

const PATIENT_DIR = path.resolve(
  __dirname,
  "..",
  "data",
  "patient",
);
const SNAPSHOT_PATH = path.resolve(
  __dirname,
  "..",
  "..",
  "tests",
  "fixtures",
  "__snapshots__",
  "phase2-checksum.json",
);
// Pilotes exclus = Phase 3 J3 ∪ Phase 4 J1 ∪ Phase 5 J1.
//   • AMBOSS-4 (Phase 3 J3) — register/tags additifs.
//   • RESCOS-9b/RESCOS-13/RESCOS-63 (Phase 4 J1) — participants[] additifs.
//   • AMBOSS-24/USMLE-34 (Phase 5 J1) — legalContext additif.
//
// Phase 12 J5 — RESCOS-70, RESCOS-71 et RESCOS-72 sortent de l'exclusion :
// elles ont reçu pedagogicalContent comme le reste du catalogue et leur
// schéma additif (register/tags pour -70/-71, certificat_complaisance pour
// -72) est maintenant figé. Elles entrent dans le checksum verrouillé.
const PHASE_PILOTS_EXCLUDED = new Set([
  "AMBOSS-4",
  "RESCOS-9b",
  "RESCOS-13",
  "RESCOS-63",
  "AMBOSS-24",
  "USMLE-34",
]);

// Champs d'AUDIT internes ajoutés post-Phase 2 et qui ne doivent pas
// faire dériver le checksum byte-stability (ils n'ont aucun impact sur
// le narratif patient consommé par le LLM ni par le client) :
//   • legalContext (Phase 5 J1) — qualification médico-légale
//   • medicoLegalReviewed (Phase 6 J1/J2) — flag d'audit du triage
// On les strippe AVANT le hash pour que l'invariant Phase 2 reste sur
// le contenu narratif uniquement. Cohérent avec META_FIELDS_TO_STRIP
// côté serveur (le LLM ne voit jamais ces champs non plus).
const AUDIT_FIELDS_EXCLUDED_FROM_CHECKSUM = new Set([
  "legalContext",
  "medicoLegalReviewed",
]);

// Tri récursif des clés objet → sérialisation déterministe indépendante de
// l'ordre de définition dans les fichiers source. Les arrays gardent leur
// ordre — c'est volontaire (l'ordre des items dans pédagogiques compte).
// Les champs d'audit Phase 5/6 sont retirés au top-level.
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

// Phase 12 J5 — aligné sur server/services/stationsService.ts:extractShortId
// (Phase 8 J2). Le pattern « ... - Station double 2 » suffixe « -P2 » pour
// distinguer la partie 2 d'une station double de la partie 1 dans le
// catalog (RESCOS-64-P2 ≠ RESCOS-64). Sans cet alignement, le test
// dédupliquait silencieusement la partie 2 et la masquait du snapshot.
function shortIdOf(fullId: string): string {
  if (/ - Station double 2$/.test(fullId)) {
    const idx = fullId.indexOf(" - ");
    const base = idx === -1 ? fullId : fullId.slice(0, idx);
    return `${base}-P2`;
  }
  const idx = fullId.indexOf(" - ");
  return idx === -1 ? fullId : fullId.slice(0, idx);
}

async function computeChecksums(): Promise<Record<string, string>> {
  const files = (await fs.readdir(PATIENT_DIR))
    .filter((f) => f.startsWith("Patient_") && f.endsWith(".json"))
    .sort();
  const out: Record<string, string> = {};
  for (const f of files) {
    const content = await fs.readFile(path.join(PATIENT_DIR, f), "utf-8");
    const parsed = JSON.parse(content) as { stations: Array<{ id: string }> };
    for (const station of parsed.stations) {
      const shortId = shortIdOf(station.id);
      if (PHASE_PILOTS_EXCLUDED.has(shortId)) continue;
      // En cas de doublon d'ID (cf. RESCOS-64 historique dans
      // Patient_RESCOS_4.json), on conserve la première occurrence — même
      // règle que stationsService au démarrage.
      if (out[shortId]) continue;
      const canon = JSON.stringify(sortKeysRecursive(station, true));
      out[shortId] = crypto.createHash("sha256").update(canon).digest("hex");
    }
  }
  return out;
}

interface Snapshot {
  _meta: {
    description: string;
    excluded: string[];
    stationCount: number;
    algorithm: string;
  };
  checksums: Record<string, string>;
}

describe("Phase 2 byte-stability checksum (post-J1 baseline)", () => {
  it("snapshot file exists and has a sane structure", async () => {
    const raw = await fs.readFile(SNAPSHOT_PATH, "utf-8");
    const snap = JSON.parse(raw) as Snapshot;
    expect(snap._meta.algorithm).toMatch(/sha256/i);
    expect(Array.isArray(snap._meta.excluded)).toBe(true);
    expect(snap._meta.excluded).toEqual(
      expect.arrayContaining([
        "AMBOSS-4",
        "RESCOS-9b",
        "RESCOS-13",
        "RESCOS-63",
        "AMBOSS-24",
        "USMLE-34",
      ]),
    );
    expect(Object.keys(snap.checksums).length).toBe(snap._meta.stationCount);
    expect(Object.keys(snap.checksums).length).toBeGreaterThanOrEqual(282);
  });

  it("none of the excluded pilots is present in the snapshot (excluded by design)", async () => {
    const raw = await fs.readFile(SNAPSHOT_PATH, "utf-8");
    const snap = JSON.parse(raw) as Snapshot;
    for (const pilot of PHASE_PILOTS_EXCLUDED) {
      expect(snap.checksums[pilot]).toBeUndefined();
    }
  });

  it("recomputed checksums match the snapshot exactly (no Phase 2 station has been byte-modified)", async () => {
    const raw = await fs.readFile(SNAPSHOT_PATH, "utf-8");
    const snap = JSON.parse(raw) as Snapshot;
    const recomputed = await computeChecksums();

    // Test orienté diagnostic : on remonte les premiers IDs divergents AVANT
    // l'assert global, pour que l'erreur pointe directement la station fautive.
    const drift: Array<{ id: string; expected: string; actual: string }> = [];
    for (const id of Object.keys(snap.checksums).sort()) {
      const expected = snap.checksums[id];
      const actual = recomputed[id];
      if (expected !== actual) {
        drift.push({ id, expected, actual: actual ?? "<missing>" });
      }
    }
    const extras = Object.keys(recomputed).filter((id) => !(id in snap.checksums));

    if (drift.length > 0) {
      // eslint-disable-next-line no-console
      console.error("[phase2-checksum] drift detected on:", drift.slice(0, 5));
    }
    expect(drift).toEqual([]);
    expect(extras).toEqual([]);
    expect(Object.keys(recomputed).length).toBe(Object.keys(snap.checksums).length);
  });
});
