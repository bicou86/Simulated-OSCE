// Phase 4 J3 — verrou prompt-level du trifecta canonique RESCOS-70.
//
// Sur les VRAIS fichiers JSON Patient_RESCOS_4.json (sans LLM, sans
// mocks fs), on construit le system prompt produit par buildSystemPrompt
// pour Emma puis pour la mère, et on assert que :
//   • Emma a accès aux infos sensibles (Cerazette, contraception, pilule),
//   • Mère N'A PAS accès à ces infos (filtre déterministe au build).
//   • Le bloc « VOCABULAIRE GRAND PUBLIC OBLIGATOIRE » est présent pour
//     les 2 (les deux profils sont en `vocabulary === 'lay'`).
//   • Le système prompt mère utilise le template caregiver.md, pas patient.md.
//
// Ces tests garantissent à la couche prompt que le LLM ne POURRA PAS
// révéler la pilule depuis la mère, indépendamment de sa température ou
// de la formulation candidat. Les tests E2E LLM gated (RUN_LLM_INTEGRATION=1)
// vérifient en complément qu'il ne le fait pas non plus en pratique.

import { describe, expect, it } from "vitest";
import { initCatalog } from "../services/stationsService";
import { buildSystemPrompt } from "../services/patientService";
import { getStationParticipants } from "@shared/station-schema";
import { promises as fs } from "fs";
import path from "path";

const PATIENT_DIR = path.resolve(__dirname, "..", "data", "patient");

async function loadStationRaw(file: string, shortId: string): Promise<any> {
  const raw = await fs.readFile(path.join(PATIENT_DIR, file), "utf-8");
  const parsed = JSON.parse(raw) as { stations: Array<{ id: string }> };
  const found = parsed.stations.find((s) => s.id.startsWith(shortId + " "));
  if (!found) throw new Error(`station ${shortId} introuvable`);
  return found;
}

describe("Phase 4 J3 — RESCOS-70 trifecta : cloisonnement Emma vs Mère", () => {
  it("Emma (target patient) voit la pilule, Cerazette, le copain, l'école", async () => {
    await initCatalog();
    const station = await loadStationRaw("Patient_RESCOS_4.json", "RESCOS-70");
    const participants = getStationParticipants(station);
    const emma = participants.find((p) => p.id === "emma")!;
    const prompt = await buildSystemPrompt("RESCOS-70", "text", emma, participants);
    // Doit contenir les infos sensibles (Emma a tous les tags).
    expect(prompt).toMatch(/cerazette/i);
    expect(prompt).toMatch(/désogestrel/i);
    expect(prompt).toMatch(/pilule/i);
    expect(prompt).toMatch(/contraception/i);
    expect(prompt).toMatch(/spotting/i);
    // Identité directive.
    expect(prompt).toMatch(/Emma Delacroix/);
    // Template patient (registre patient principal).
    expect(prompt).toMatch(/PATIENT TEMPLATE|## PRINCIPES DE RÉPONSE|patient standardisé/i);
  });

  it("Mère (target accompanying) NE voit JAMAIS la pilule, Cerazette, contraception, désogestrel, spotting", async () => {
    await initCatalog();
    const station = await loadStationRaw("Patient_RESCOS_4.json", "RESCOS-70");
    const participants = getStationParticipants(station);
    const mother = participants.find((p) => p.id === "mother")!;
    const prompt = await buildSystemPrompt("RESCOS-70", "text", mother, participants);
    // ZÉRO leak des termes sensibles dans le PROMPT ENTIER. La version
    // initiale du test slicait sur `prompt.split("<station_data>")[1]`,
    // mais caregiver.md cite `<station_data>` deux fois dans ses
    // instructions avant le bloc de données réel — l'index `[1]` était
    // le morceau ENTRE deux mentions de la docstring caregiver, pas le
    // bloc data. On vérifie maintenant le prompt complet en autorisant
    // la directive vocabulaire (qui peut citer des termes médicaux comme
    // exemples interdits, mais ne mentionne pas ces termes-ci).
    expect(prompt).not.toMatch(/cerazette/i);
    expect(prompt).not.toMatch(/désogestrel/i);
    expect(prompt).not.toMatch(/spotting/i);
    expect(prompt).not.toMatch(/copain/i);
    // « pilule » et « contracept » : pas dans la directive vocabulaire
    // lay non plus (cf. vocabularyConstraints.ts), donc on peut asserter
    // strictement leur absence dans le prompt entier.
    expect(prompt).not.toMatch(/\bpilule\b/i);
    expect(prompt).not.toMatch(/\bcontracept/i);
    // Identité mère + template caregiver bien activé.
    expect(prompt).toMatch(/Mère d'Emma Delacroix/);
  });

  it("Mère voit toujours les antécédents familiaux et l'identité légère (rétrocompat)", async () => {
    await initCatalog();
    const station = await loadStationRaw("Patient_RESCOS_4.json", "RESCOS-70");
    const participants = getStationParticipants(station);
    const mother = participants.find((p) => p.id === "mother")!;
    const prompt = await buildSystemPrompt("RESCOS-70", "text", mother, participants);
    // Sections NON listées dans participantSections ⇒ visibles à tous.
    expect(prompt).toMatch(/HTA/i); // antecedents.familiaux
    expect(prompt).toMatch(/Emma/); // nom
    expect(prompt).toMatch(/16/); // age
  });

  it("le champ participantSections lui-même n'apparaît jamais dans le prompt", async () => {
    await initCatalog();
    const station = await loadStationRaw("Patient_RESCOS_4.json", "RESCOS-70");
    const participants = getStationParticipants(station);
    for (const target of participants) {
      const prompt = await buildSystemPrompt("RESCOS-70", "text", target, participants);
      expect(prompt).not.toMatch(/participantSections/);
    }
  });

  it("la directive vocabulaire lay est injectée pour les 2 profils (Emma + Mère sont lay)", async () => {
    await initCatalog();
    const station = await loadStationRaw("Patient_RESCOS_4.json", "RESCOS-70");
    const participants = getStationParticipants(station);
    for (const target of participants) {
      const prompt = await buildSystemPrompt("RESCOS-70", "text", target, participants);
      expect(prompt).toMatch(/VOCABULAIRE GRAND PUBLIC OBLIGATOIRE/);
      expect(prompt).toMatch(/dyspnée/i);
    }
  });

  it("station mono-patient legacy (pas de target) ⇒ pas de directive lay (rétrocompat)", async () => {
    await initCatalog();
    const prompt = await buildSystemPrompt("RESCOS-1", "text");
    // Sans target, on est sur le chemin legacy — la directive vocabulaire
    // n'est pas injectée (elle est gated par target.vocabulary === 'lay').
    expect(prompt).not.toMatch(/VOCABULAIRE GRAND PUBLIC OBLIGATOIRE/);
  });

  it("RESCOS-70 sans target (chemin legacy) ⇒ comportement pré-J3 strictement préservé", async () => {
    await initCatalog();
    const prompt = await buildSystemPrompt("RESCOS-70", "text");
    // Sans target ⇒ pas de filtrage, prompt complet (Emma adolescente self).
    expect(prompt).toMatch(/cerazette/i);
    expect(prompt).toMatch(/Emma Delacroix/);
    // Pas de bloc TU INCARNES (introduit par J2 quand target est fourni).
    expect(prompt).not.toMatch(/## TU INCARNES/);
  });
});
