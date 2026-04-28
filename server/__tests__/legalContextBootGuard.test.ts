// Phase 5 J3 — verrou strict au boot : si une station déclare un
// `legalContext` avec un code `applicable_law` qui N'EST PAS mappé
// dans `LEGAL_LAW_CODE_PATTERNS`, le boot DOIT throw — sinon (a) la
// directive prompt patient ne pourrait pas citer le code dans la
// blacklist, et (b) les tests de leak runtime auraient un trou
// invisible.
//
// On teste en écrivant un fichier station temporaire avec un code
// volontairement faux (« CP-9999 ») dans un répertoire de patient
// dédié — puis on appelle directement `validateLegalContextLawCodes`
// (exporté via __test__) sur la liste de fichiers fabriquée.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { __test__ as stationsServiceTest } from "../services/stationsService";

// Le validateur boucle sur le PATIENT_DIR du module — pour tester en
// isolation, on génère une fixture dans un sous-répertoire de
// `server/data/patient` (le validateur attend un dossier réel) et on
// la nettoie à la fin. Pour éviter les collisions avec le catalogue
// principal, on choisit un nom qui ne matche pas le filter `Patient_*`
// du validateur principal.
const PATIENT_DIR = path.resolve(__dirname, "..", "data", "patient");

const VALID_STATION = {
  id: "TEST-LEGAL-OK - Test fixture - 28 ans",
  setting: "Cabinet",
  patient_description: "Patient test, 28 ans",
  age: "28 ans",
  legalContext: {
    category: "secret_pro_levee",
    jurisdiction: "CH",
    subject_status: "adult_capable",
    applicable_law: ["CP-321", "CP-364"], // codes mappés
    mandatory_reporting: false,
    expected_decision: "refer",
    decision_rationale: "Test rationale long enough to satisfy schema validation min length.",
    red_flags: ["red flag test"],
    candidate_must_verbalize: ["secret professionnel (art. 321 CP)"],
    candidate_must_avoid: [],
  },
};

const INVALID_STATION = {
  id: "TEST-LEGAL-KO - Test fixture - 28 ans",
  setting: "Cabinet",
  patient_description: "Patient test, 28 ans",
  age: "28 ans",
  legalContext: {
    category: "secret_pro_levee",
    jurisdiction: "CH",
    subject_status: "adult_capable",
    // CP-321 est mappé, mais CP-9999 et FAKE-LAW-42 ne le sont pas.
    applicable_law: ["CP-321", "CP-9999", "FAKE-LAW-42"],
    mandatory_reporting: false,
    expected_decision: "refer",
    decision_rationale: "Test rationale long enough to satisfy schema validation min length.",
    red_flags: ["red flag test"],
    candidate_must_verbalize: ["secret professionnel (art. 321 CP)"],
    candidate_must_avoid: [],
  },
};

const VALID_FILE = "Patient_TEST_LEGAL_OK.json";
const INVALID_FILE = "Patient_TEST_LEGAL_KO.json";

describe("Phase 5 J3 — garde-fou boot : validateLegalContextLawCodes", () => {
  beforeEach(async () => {
    await fs.writeFile(
      path.join(PATIENT_DIR, VALID_FILE),
      JSON.stringify({ source: "USMLE", stations: [VALID_STATION] }),
    );
    await fs.writeFile(
      path.join(PATIENT_DIR, INVALID_FILE),
      JSON.stringify({ source: "USMLE", stations: [INVALID_STATION] }),
    );
  });

  afterEach(async () => {
    await fs.rm(path.join(PATIENT_DIR, VALID_FILE)).catch(() => {});
    await fs.rm(path.join(PATIENT_DIR, INVALID_FILE)).catch(() => {});
  });

  it("station avec applicable_law tous mappés → validateur OK", async () => {
    await expect(
      stationsServiceTest.validateLegalContextLawCodes([VALID_FILE]),
    ).resolves.toBeUndefined();
  });

  it("station avec un code non mappé → throw avec message explicite", async () => {
    await expect(
      stationsServiceTest.validateLegalContextLawCodes([INVALID_FILE]),
    ).rejects.toThrow(/non mappé/);
  });

  it("le message d'erreur cite les codes manquants ET le fichier source", async () => {
    let errorMessage = "";
    try {
      await stationsServiceTest.validateLegalContextLawCodes([INVALID_FILE]);
    } catch (e) {
      errorMessage = (e as Error).message;
    }
    expect(errorMessage).toContain("CP-9999");
    expect(errorMessage).toContain("FAKE-LAW-42");
    expect(errorMessage).toContain("TEST-LEGAL-KO");
    // Hint actionable pour l'opérateur.
    expect(errorMessage).toContain("legalLexicon.ts");
  });

  it("station SANS legalContext → ignorée par le validateur (rétrocompat)", async () => {
    const noLegalFile = "Patient_TEST_LEGAL_NONE.json";
    const noLegalStation = {
      id: "TEST-LEGAL-NONE - Test - 30 ans",
      setting: "Cabinet",
      patient_description: "Patient test, 30 ans",
    };
    await fs.writeFile(
      path.join(PATIENT_DIR, noLegalFile),
      JSON.stringify({ source: "USMLE", stations: [noLegalStation] }),
    );
    try {
      await expect(
        stationsServiceTest.validateLegalContextLawCodes([noLegalFile]),
      ).resolves.toBeUndefined();
    } finally {
      await fs.rm(path.join(PATIENT_DIR, noLegalFile)).catch(() => {});
    }
  });
});

// Évite l'erreur lint « unused import » si os est non utilisé.
void os;
