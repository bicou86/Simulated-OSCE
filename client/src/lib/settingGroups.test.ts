// Verrouille le regroupement canonique des 64 variantes de "setting" présentes
// dans le catalogue patient (source : server/data/patient/*.json).

import { describe, it, expect } from "vitest";
import { CANONICAL_GROUPS, availableCanonicalSettings, canonicalSetting } from "./settingGroups";

describe("canonicalSetting", () => {
  // Chaque case correspond à une chaîne brute observée dans les données réelles.
  const cases: Array<[string, (typeof CANONICAL_GROUPS)[number]]> = [
    // Urgences pédiatriques — spécialité, doit passer avant le catchall "urgences".
    ["Service d'urgences pédiatriques", "Urgences pédiatriques"],
    ["Urgences d'un hôpital pédiatrique", "Urgences pédiatriques"],

    // Urgences psychiatriques — idem, catégorie distincte.
    ["Urgences psychiatriques du CHUV", "Urgences psychiatriques"],

    // Consultation téléphonique — doit capturer même les variantes "- Service d'urgence".
    ["Consultation téléphonique", "Consultation téléphonique"],
    ["Consultation téléphonique - Service d'urgence", "Consultation téléphonique"],
    ["Consultation téléphonique pédiatrique à 23h00", "Consultation téléphonique"],
    [
      "Urgence hôpital régional - Consultation téléphonique avec infirmier·ère d'EMS",
      "Consultation téléphonique",
    ],

    // Cabinet ORL — passe avant "urgences" pour que "Consultation ORL d'urgence" reste ORL.
    ["Cabinet ORL", "Cabinet ORL"],
    ["Consultation ORL d'urgence", "Cabinet ORL"],

    // Gynécologie / obstétrique → Cabinet de gynécologie.
    ["Cabinet de gynécologie", "Cabinet de gynécologie"],
    ["Consultation gynécologique", "Cabinet de gynécologie"],
    ["Cabinet du spécialiste - gynécologie", "Cabinet de gynécologie"],
    ["Service de gynécologie-obstétrique", "Cabinet de gynécologie"],

    // Cabinet de médecine générale (fourre-tout pour les variantes de cabinet/clinique GP).
    ["Cabinet de médecine générale", "Cabinet de médecine générale"],
    ["Cabinet médical", "Cabinet de médecine générale"],
    ["Cabinet du généraliste", "Cabinet de médecine générale"],
    ["Clinique médicale", "Cabinet de médecine générale"],
    ["Clinique de médecine générale", "Cabinet de médecine générale"],
    ["Consultation médicale", "Cabinet de médecine générale"],
    ["Service médical", "Cabinet de médecine générale"],
    ["Cabinet de médecine de famille - Garde de weekend", "Cabinet de médecine générale"],
    [
      "Cabinet de médecine générale de la Dre Kovac (médecin assistant·e)",
      "Cabinet de médecine générale",
    ],
    ["Cabinet de médecine générale (remplacement)", "Cabinet de médecine générale"],

    // Service d'urgences (toutes les variantes restantes).
    ["Urgences", "Service d'urgences"],
    ["Service des urgences", "Service d'urgences"],
    ["Service d'urgences de l'hôpital cantonal de Lucerne", "Service d'urgences"],
    ["Urgences d'un hôpital régional", "Service d'urgences"],
    ["Urgences d'un hôpital universitaire", "Service d'urgences"],
    ["Urgences du CHUV", "Service d'urgences"],
    ["Urgences - Box de déchocage", "Service d'urgences"],
    ["Urgences, médecin assistant", "Service d'urgences"],
    [
      "Urgences d'un hôpital régional (médecin assistant·e). Il est 21h30",
      "Service d'urgences",
    ],

    // Clinique — policlinique, permanence, soins urgents, santé étudiante.
    ["Clinique", "Clinique"],
    ["Policlinique", "Clinique"],
    ["Clinique de soins urgents", "Clinique"],
    ["Clinique de santé étudiante", "Clinique"],
    ["Consultation ambulatoire de permanence", "Clinique"],
    ["Service de permanence", "Clinique"],

    // Spécialités "cabinet" isolées.
    ["Cabinet de cardiologie", "Cabinet de cardiologie"],
    ["Cabinet d'hématologie", "Cabinet d'hématologie"],
    ["Cabinet de gastro-entérologie", "Cabinet de gastro-entérologie"],
    ["Cabinet de pédiatrie", "Cabinet de pédiatrie"],
    ["Cabinet de psychiatrie (remplacement)", "Cabinet de psychiatrie"],
    ["Présentation de Mme Dumont au pneumologue", "Cabinet de pneumologie"],

    // Services hospitaliers.
    ["Service de médecine interne", "Service de médecine interne"],
    ["Service de médecine interne - Colloque pluridisciplinaire", "Service de médecine interne"],
    ["Service hospitalier SMIG", "Service de médecine interne"],
    ["Service de neurologie", "Service de neurologie"],
    ["Service de neurochirurgie, CHUV", "Service de neurochirurgie"],
  ];

  it.each(cases)("%s → %s", (raw, expected) => {
    expect(canonicalSetting(raw)).toBe(expected);
  });

  it("returns empty string for empty input", () => {
    expect(canonicalSetting("")).toBe("");
    expect(canonicalSetting(null)).toBe("");
    expect(canonicalSetting(undefined)).toBe("");
  });

  it("returns the trimmed raw when no rule matches", () => {
    expect(canonicalSetting("   Centre de recherche en génétique  ")).toBe("Centre de recherche en génétique");
  });
});

describe("availableCanonicalSettings", () => {
  it("returns present groups sorted by CANONICAL_GROUPS order", () => {
    const raws = [
      "Cabinet médical",
      "Service d'urgences",
      "Consultation téléphonique",
      "Cabinet d'hématologie",
      "Clinique",
    ];
    const result = availableCanonicalSettings(raws);
    expect(result).toEqual([
      "Service d'urgences",
      "Consultation téléphonique",
      "Cabinet de médecine générale",
      "Cabinet d'hématologie",
      "Clinique",
    ]);
  });

  it("deduplicates when multiple raws map to the same canonical group", () => {
    const result = availableCanonicalSettings([
      "Urgences",
      "Service d'urgences",
      "Urgences du CHUV",
    ]);
    expect(result).toEqual(["Service d'urgences"]);
  });

  it("ignores null/undefined/empty entries", () => {
    const result = availableCanonicalSettings([null, undefined, "", "Cabinet ORL"]);
    expect(result).toEqual(["Cabinet ORL"]);
  });
});
