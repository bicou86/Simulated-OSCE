// Phase 7 J4 — Sujet 2 : verrou audit sur l'harmonisation des settings.
//
// Vérifie post-J4 que :
//   • "Cabinet de médecine générale" est désormais la valeur dominante
//     pour les cabinets de médecine générale ambulatoires (≥ 140 stations
//     post-J4 = 73 historique + 70 harmonisées ; tolérance grossière car
//     le corpus est mouvant).
//   • Les 4 variantes harmonisées (Cabinet médical, Clinique de médecine
//     générale, Cabinet du généraliste, Cabinet médical / consultation
//     programmée) ne sont PLUS présentes dans le corpus.
//   • Les variantes spécialisées NON-harmonisées (Cabinet de pédiatrie,
//     gynécologie, etc.) restent intactes.
//   • Les 4 stations Phase 5/6 avec legalContext (AMBOSS-24, RESCOS-72,
//     USMLE Triage 39, USMLE-9) ont leur setting INCHANGÉ.
//   • USMLE-34 a son setting harmonisé (cas explicite, byte count modifié,
//     flagué dans le commit message + PHASE_7_J4_NOTES.md).

import { promises as fs } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

const PATIENT_DIR = path.resolve(__dirname, "..", "data", "patient");

interface StationRow {
  shortId: string;
  setting: string;
}

async function loadAllSettings(): Promise<StationRow[]> {
  const out: StationRow[] = [];
  const seen = new Set<string>();
  const files = (await fs.readdir(PATIENT_DIR))
    .filter((f) => f.startsWith("Patient_") && f.endsWith(".json"))
    .sort();
  for (const f of files) {
    const txt = await fs.readFile(path.join(PATIENT_DIR, f), "utf-8");
    const parsed = JSON.parse(txt) as { stations: Array<Record<string, unknown>> };
    for (const s of parsed.stations) {
      const fullId = s.id as string;
      const shortId = fullId.split(" - ")[0];
      if (seen.has(shortId)) continue;
      seen.add(shortId);
      out.push({ shortId, setting: (s.setting as string) ?? "" });
    }
  }
  return out;
}

describe("Phase 7 J4 — Sujet 2 : harmonisation settings « Cabinet de médecine générale »", () => {
  it("« Cabinet de médecine générale » est la valeur dominante post-harmonisation (≥ 140 stations)", async () => {
    const rows = await loadAllSettings();
    const count = rows.filter((r) => r.setting === "Cabinet de médecine générale").length;
    // 73 historique + 70 harmonisées = 143. Marge à 140 pour absorber un
    // ajout/retrait Phase 8 sans casser le test.
    expect(count, `nombre de "Cabinet de médecine générale" = ${count}`).toBeGreaterThanOrEqual(140);
  });

  it("les 4 variantes harmonisées ont disparu du corpus", async () => {
    const rows = await loadAllSettings();
    const REMOVED = [
      "Cabinet médical",
      "Clinique de médecine générale",
      "Cabinet du généraliste",
      "Cabinet médical, consultation programmée",
    ];
    for (const variant of REMOVED) {
      const survivors = rows.filter((r) => r.setting === variant);
      expect(
        survivors.length,
        `Variant "${variant}" devrait être éliminée mais survit sur ${survivors.length} station(s) : ${survivors.map((r) => r.shortId).join(", ")}`,
      ).toBe(0);
    }
  });

  it("les variantes spécialisées (cabinets non-MG) restent intactes", async () => {
    // Garde-fou : si la harmonisation s'élargit accidentellement à des
    // settings spécialisés, ce test catch immédiatement le glissement.
    const rows = await loadAllSettings();
    const PROTECTED = [
      "Cabinet de gynécologie",
      "Cabinet de pédiatrie",
      "Cabinet de cardiologie",
      "Cabinet de gastro-entérologie",
      "Cabinet d'hématologie",
      "Cabinet ORL",
    ];
    for (const setting of PROTECTED) {
      const matches = rows.filter((r) => r.setting === setting);
      expect(
        matches.length,
        `"${setting}" doit rester présente (cabinet spécialisé, NON-MG)`,
      ).toBeGreaterThanOrEqual(1);
    }
  });

  it("AMBOSS-24, RESCOS-72, USMLE Triage 39, USMLE-9 — settings INCHANGÉS (legal stations préservées)", async () => {
    const rows = await loadAllSettings();
    const STABLE_LEGAL = {
      "AMBOSS-24":      "Clinique de soins urgents",
      "RESCOS-72":      "Cabinet de médecine générale", // déjà canonique pré-J4 — no-op
      "USMLE Triage 39": "Consultation téléphonique - Clinique médicale",
      "USMLE-9":        "Service d'urgences",
    };
    for (const [shortId, expected] of Object.entries(STABLE_LEGAL)) {
      const r = rows.find((x) => x.shortId === shortId);
      expect(r, `${shortId} introuvable`).toBeDefined();
      expect(r!.setting, `${shortId} setting drift`).toBe(expected);
    }
  });

  it("USMLE-34 — setting harmonisé (cas explicite, byte count brief modifié — voir PHASE_7_J4_NOTES.md)", async () => {
    // Ce test verrouille le SEUL cas où l'harmonisation impacte une
    // station legalContext. Le brief HTTP de USMLE-34 passe d'environ
    // 525 → 540 bytes (mesure runtime). Modification approuvée — voir
    // commit message Phase 7 J4 et PHASE_7_J4_NOTES.md §2.
    const rows = await loadAllSettings();
    const r = rows.find((x) => x.shortId === "USMLE-34");
    expect(r).toBeDefined();
    expect(r!.setting).toBe("Cabinet de médecine générale");
  });
});
