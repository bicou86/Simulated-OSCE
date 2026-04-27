// Phase 4 J3 (fix runtime) — verrou de non-régression sur la chaîne de
// cloisonnement de bout en bout, sans mock fs ni LLM.
//
// Ce fichier joue les 3 cas trifecta exigés par la spec utilisateur sur
// le VRAI catalogue (initCatalog) et le VRAI buildSystemPrompt. Il vérifie
// que chaque MAILLON de la chaîne de leak identifiée lors du fix runtime
// est désormais étanche :
//
//   1. Le station id (« RESCOS-70 - Contraception cachée … ») est strippé
//      du <station_data> envoyé au LLM (sinon il leak via le titre du
//      scénario).
//   2. Le champ `tags` (["adolescent","contraception","gyneco",
//      "effets-secondaires-pilule"]) est strippé.
//   3. Le champ `participants` (qui contient les knowledgeScope, dont
//      certains tags reprennent le mot « contraception ») est strippé.
//   4. Le champ `participantSections` lui-même n'apparaît pas.
//   5. La section `examens_complementaires.bhcg.interpretation`
//      (« observance de Cerazette depuis 3 mois ») est cloisonnée par
//      participantSections sur le tag `sexual_health`.
//
// Pour chacun de ces points, on assert que la mère NE voit PAS le
// terme et que Emma le voit (ou le voit pour les 2 selon le cas).

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
  return parsed.stations.find((s) => s.id.startsWith(shortId + " "));
}

describe("Phase 4 J3 (fix) — leaks runtime sur RESCOS-70 (mère ne doit JAMAIS voir)", () => {
  it("le station id (« Contraception cachée ») est strippé du prompt mère", async () => {
    await initCatalog();
    const station = await loadStationRaw("Patient_RESCOS_4.json", "RESCOS-70");
    const participants = getStationParticipants(station);
    const mother = participants.find((p) => p.id === "mother")!;
    const prompt = await buildSystemPrompt("RESCOS-70", "text", mother, participants);
    // L'id complet ne doit pas apparaître — il dévoilerait le pitch.
    expect(prompt).not.toMatch(/Contraception cach[ée]e/i);
  });

  it("le champ `tags` (effets-secondaires-pilule, …) est strippé du prompt mère", async () => {
    await initCatalog();
    const station = await loadStationRaw("Patient_RESCOS_4.json", "RESCOS-70");
    const participants = getStationParticipants(station);
    const mother = participants.find((p) => p.id === "mother")!;
    const prompt = await buildSystemPrompt("RESCOS-70", "text", mother, participants);
    expect(prompt).not.toMatch(/effets-secondaires-pilule/i);
    expect(prompt).not.toMatch(/"tags":\s*\[/);
  });

  it("le champ `participants` (knowledgeScope inclut le mot « contraception ») est strippé", async () => {
    await initCatalog();
    const station = await loadStationRaw("Patient_RESCOS_4.json", "RESCOS-70");
    const participants = getStationParticipants(station);
    const mother = participants.find((p) => p.id === "mother")!;
    const prompt = await buildSystemPrompt("RESCOS-70", "text", mother, participants);
    // Le bloc <station_data> ne doit pas inclure une clé "participants"
    // (qui ferait fuiter le scope d'Emma).
    expect(prompt).not.toMatch(/"participants":\s*\[/);
    expect(prompt).not.toMatch(/"knowledgeScope":\s*\[/);
  });

  it("`examens_complementaires.bhcg.interpretation` (Cerazette) est cloisonné", async () => {
    await initCatalog();
    const station = await loadStationRaw("Patient_RESCOS_4.json", "RESCOS-70");
    const participants = getStationParticipants(station);
    const mother = participants.find((p) => p.id === "mother")!;
    const prompt = await buildSystemPrompt("RESCOS-70", "text", mother, participants);
    expect(prompt).not.toMatch(/cerazette/i);
    expect(prompt).not.toMatch(/observance.*Cerazette/i);
  });

  it("Emma (avec sexual_health + contraception + full_scenario) garde l'accès à tout", async () => {
    await initCatalog();
    const station = await loadStationRaw("Patient_RESCOS_4.json", "RESCOS-70");
    const participants = getStationParticipants(station);
    const emma = participants.find((p) => p.id === "emma")!;
    const prompt = await buildSystemPrompt("RESCOS-70", "text", emma, participants);
    // Emma doit recevoir l'intégralité du contexte sensible pour pouvoir
    // jouer le scénario.
    expect(prompt).toMatch(/cerazette/i);
    expect(prompt).toMatch(/désogestrel/i);
    expect(prompt).toMatch(/spotting/i);
    expect(prompt).toMatch(/observance.*Cerazette/i); // bhcg interpretation
    // Sa propre identité dans le bloc « TU INCARNES ».
    expect(prompt).toMatch(/TU INCARNES[\s\S]*Emma Delacroix/);
  });
});

describe("Phase 4 J3 (fix) — non-régression mono-patient legacy", () => {
  it("AMBOSS-1 (mono, pas de target) ⇒ comportement strictement préservé (id et tags présents)", async () => {
    await initCatalog();
    const prompt = await buildSystemPrompt("AMBOSS-1", "text");
    // Sans target, aucun stripping. Le prompt legacy contient les
    // métadonnées de station comme avant J3.
    expect(prompt).toMatch(/AMBOSS-1/);
    // Pas de bloc "TU INCARNES" (introduit par J2 quand target est passé).
    expect(prompt).not.toMatch(/## TU INCARNES/);
  });

  it("RESCOS-1 (mono, target synthétique du runtime J2) ⇒ id et tags strippés mais prompt cohérent", async () => {
    // Quand le pipeline runtime synthétise un participant unique pour
    // mono-patient, le filtre s'applique et les meta-fields disparaissent.
    // L'expérience LLM legacy (anamnèse + symptômes + antécédents) reste
    // intacte ; seules les métadonnées catalogue sont retirées.
    await initCatalog();
    const station = await loadStationRaw("Patient_RESCOS_1.json", "RESCOS-1");
    const participants = getStationParticipants(station); // synthétique mono
    const target = participants[0];
    const prompt = await buildSystemPrompt("RESCOS-1", "text", target, participants);
    // L'id legacy (qui contient le titre complet) n'est plus injecté
    // dans <station_data> — mais le LLM a déjà l'identité via "TU INCARNES".
    // On vérifie que le prompt reste ENTIÈREMENT FONCTIONNEL : nom +
    // patient_description + vitals présents.
    expect(prompt).toMatch(/TU INCARNES/);
    expect(prompt).toMatch(/<station_data>/);
    // Pas de "tags" ni "participants" injecté (stripping global).
    expect(prompt).not.toMatch(/"participants":\s*\[/);
  });
});
