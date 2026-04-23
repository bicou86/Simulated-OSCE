// Tests de la table statique de pondération des axes.
// Vérifie : somme=100 par ligne, couverture complète de StationType, accesseur
// typé, pas d'orphelin de l'inférence.

import { describe, expect, it } from "vitest";
import {
  EVALUATION_AXES,
  EVALUATION_WEIGHTS,
  getAxisWeights,
  type StationType,
} from "../../shared/evaluation-weights";

const ALL_STATION_TYPES: StationType[] = [
  "teleconsultation",
  "pediatrie_accompagnant",
  "bbn",
  "psy",
  "triage",
  "anamnese_examen",
];

describe("EVALUATION_WEIGHTS — invariants table statique", () => {
  it("chaque ligne somme à 100", () => {
    for (const [type, axes] of Object.entries(EVALUATION_WEIGHTS)) {
      const sum = axes.anamnese + axes.examen + axes.management + axes.cloture + axes.communication;
      expect(sum, `ligne ${type}`).toBe(100);
    }
  });
  it("toutes les valeurs de StationType ont une entrée (pas d'orphelin)", () => {
    for (const type of ALL_STATION_TYPES) {
      expect(EVALUATION_WEIGHTS[type]).toBeDefined();
    }
  });
  it("les poids sont tous des entiers positifs ou nuls", () => {
    for (const [, axes] of Object.entries(EVALUATION_WEIGHTS)) {
      for (const [axis, weight] of Object.entries(axes)) {
        expect(Number.isInteger(weight), `axis ${axis}`).toBe(true);
        expect(weight, `axis ${axis}`).toBeGreaterThanOrEqual(0);
      }
    }
  });
  it("EVALUATION_AXES liste les 5 axes canoniques dans l'ordre d'affichage", () => {
    expect(EVALUATION_AXES).toEqual([
      "anamnese",
      "examen",
      "management",
      "cloture",
      "communication",
    ]);
  });
});

describe("EVALUATION_WEIGHTS — invariant non-régression anamnese_examen", () => {
  it("communication = 0 sur anamnese_examen (garantie zero-diff sur stations déjà validées)", () => {
    expect(EVALUATION_WEIGHTS.anamnese_examen.communication).toBe(0);
  });
  it("les 4 axes classiques somment à 100 sur anamnese_examen", () => {
    const a = EVALUATION_WEIGHTS.anamnese_examen;
    expect(a.anamnese + a.examen + a.management + a.cloture).toBe(100);
  });
});

describe("EVALUATION_WEIGHTS — poids Communication non-trivial hors anamnese_examen", () => {
  it("bbn, psy, pediatrie_accompagnant, teleconsultation, triage ont tous Communication > 0", () => {
    for (const type of ["bbn", "psy", "pediatrie_accompagnant", "teleconsultation", "triage"] as const) {
      expect(EVALUATION_WEIGHTS[type].communication, type).toBeGreaterThan(0);
    }
  });
  it("anamnese_examen est le SEUL type avec Communication === 0 (protège non-régression Phase 1)", () => {
    // Invariant critique : toute future refonte des poids doit préserver
    // Communication=0 UNIQUEMENT sur anamnese_examen, sous peine de casser
    // les fixtures score-à-score des stations adulte-self classiques.
    const zeroCommTypes = ALL_STATION_TYPES.filter(
      (t) => EVALUATION_WEIGHTS[t].communication === 0,
    );
    expect(zeroCommTypes).toEqual(["anamnese_examen"]);
  });
  it("bbn a exactement 40 points en Communication (ligne critique pédagogiquement)", () => {
    // Garde-fou explicite : BBN = annonce de mauvaise nouvelle, exercice
    // dont l'évaluation est dominée par la communication. Une réduction
    // accidentelle ce poids ferait régresser les stations BBN validées en
    // Phase 2 bis / 3.
    expect(EVALUATION_WEIGHTS.bbn.communication).toBe(40);
    const bbn = EVALUATION_WEIGHTS.bbn;
    expect(bbn.anamnese + bbn.examen + bbn.management + bbn.cloture + bbn.communication).toBe(100);
  });
  it("bbn a le poids Communication le plus élevé (annonce = exercice communicationnel)", () => {
    const bbn = EVALUATION_WEIGHTS.bbn.communication;
    for (const type of ALL_STATION_TYPES) {
      if (type === "bbn") continue;
      expect(bbn, `bbn vs ${type}`).toBeGreaterThanOrEqual(EVALUATION_WEIGHTS[type].communication);
    }
  });
});

describe("getAxisWeights — accesseur", () => {
  it("retourne la ligne correcte pour un station_type valide", () => {
    const w = getAxisWeights("anamnese_examen");
    expect(w).toEqual(EVALUATION_WEIGHTS.anamnese_examen);
  });
  it("jette pour un station_type inconnu (pas de undefined silencieux)", () => {
    expect(() => getAxisWeights("unknown_type" as StationType)).toThrow(
      /pas d'entrée pour station_type/,
    );
  });
});
