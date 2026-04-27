// Phase 3 J4 — verrou de non-régression byte-identique sur les 283 stations
// Phase 2 NON touchées par J3.
//
// Le test recalcule un SHA-256 sur la sérialisation déterministe (JSON keys
// triées récursivement) de chaque station et compare au snapshot
// `tests/fixtures/__snapshots__/phase2-checksum.json`. Si une station Phase 2
// est byte-modifiée par mégarde lors d'un merge, le test échoue immédiatement
// en pointant l'ID concerné.
//
// Les 3 stations pilotes J3 (AMBOSS-4, RESCOS-70, RESCOS-71) sont
// volontairement exclues du checksum : elles portent les champs additifs J3
// (register, patient_age_years, motif_cache, tags) qui ont par construction
// modifié le hash. Le verrou démarre à la baseline post-J3.
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
const J3_PILOTS = new Set(["AMBOSS-4", "RESCOS-70", "RESCOS-71"]);

// Tri récursif des clés objet → sérialisation déterministe indépendante de
// l'ordre de définition dans les fichiers source. Les arrays gardent leur
// ordre — c'est volontaire (l'ordre des items dans pédagogiques compte).
function sortKeysRecursive(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeysRecursive);
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v as Record<string, unknown>).sort()) {
      out[k] = sortKeysRecursive((v as Record<string, unknown>)[k]);
    }
    return out;
  }
  return v;
}

function shortIdOf(fullId: string): string {
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
      if (J3_PILOTS.has(shortId)) continue;
      // En cas de doublon d'ID (cf. RESCOS-64 historique dans
      // Patient_RESCOS_4.json), on conserve la première occurrence — même
      // règle que stationsService au démarrage.
      if (out[shortId]) continue;
      const canon = JSON.stringify(sortKeysRecursive(station));
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

describe("Phase 2 byte-stability checksum (post-J3 baseline)", () => {
  it("snapshot file exists and has a sane structure", async () => {
    const raw = await fs.readFile(SNAPSHOT_PATH, "utf-8");
    const snap = JSON.parse(raw) as Snapshot;
    expect(snap._meta.algorithm).toMatch(/sha256/i);
    expect(Array.isArray(snap._meta.excluded)).toBe(true);
    expect(snap._meta.excluded).toEqual(
      expect.arrayContaining(["AMBOSS-4", "RESCOS-70", "RESCOS-71"]),
    );
    expect(Object.keys(snap.checksums).length).toBe(snap._meta.stationCount);
    expect(Object.keys(snap.checksums).length).toBeGreaterThanOrEqual(280);
  });

  it("none of the 3 J3 pilots is present in the snapshot (excluded by design)", async () => {
    const raw = await fs.readFile(SNAPSHOT_PATH, "utf-8");
    const snap = JSON.parse(raw) as Snapshot;
    for (const pilot of J3_PILOTS) {
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
