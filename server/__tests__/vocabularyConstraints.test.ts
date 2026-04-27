// Phase 4 J3 — tests unitaires de la table de contraintes lexicales
// `vocabulary === 'lay'`.
//
// On vérifie :
//   • la directive injectée dans le prompt liste les ~30 termes interdits
//     avec leurs équivalents grand public (assert sur termes-clés
//     représentatifs des 3 scénarios canoniques),
//   • detectLayLeaks détecte un terme banni dans un texte (positifs),
//   • detectLayLeaks ne flag PAS les équivalents grand public (négatifs),
//   • detectLayLeaks gère accents et pluriels.

import { describe, expect, it } from "vitest";
import {
  buildLayVocabularyDirective,
  detectLayLeaks,
  LAY_CONSTRAINTS,
} from "../lib/vocabularyConstraints";

describe("buildLayVocabularyDirective", () => {
  it("liste les 3 termes pivots du scénario RESCOS-71 (gériatrique)", () => {
    const d = buildLayVocabularyDirective();
    expect(d).toMatch(/dyspnée/i);
    expect(d).toMatch(/asthénie/i);
    expect(d).toMatch(/cachexie/i);
    // Plus l'œdème (RESCOS-71 fin de vie).
    expect(d).toMatch(/œdème|oedème/i);
  });

  it("liste les termes pivots RESCOS-9b (pédiatrie locomoteur)", () => {
    const d = buildLayVocabularyDirective();
    expect(d).toMatch(/boiterie d'esquive/i);
    expect(d).toMatch(/antalgie de décharge/i);
    expect(d).toMatch(/fébricule/i);
  });

  it("liste les équivalents grand public, pas seulement les interdits", () => {
    const d = buildLayVocabularyDirective();
    expect(d).toMatch(/essoufflement/i);
    expect(d).toMatch(/fatigue intense/i);
    expect(d).toMatch(/jaunisse/i);
    expect(d).toMatch(/jambes gonflées/i);
  });

  it("titre de section explicite et instruction stricte", () => {
    const d = buildLayVocabularyDirective();
    expect(d).toMatch(/VOCABULAIRE GRAND PUBLIC OBLIGATOIRE/);
    expect(d).toMatch(/INTERDIT/i);
  });

  it("LAY_CONSTRAINTS couvre au moins 30 termes (cible spec utilisateur)", () => {
    expect(LAY_CONSTRAINTS.length).toBeGreaterThanOrEqual(30);
  });
});

describe("detectLayLeaks", () => {
  it("flag « dyspnée » au milieu d'une phrase", () => {
    const leaks = detectLayLeaks("Mon père a une dyspnée importante depuis hier.");
    expect(leaks.length).toBeGreaterThanOrEqual(1);
    expect(leaks[0].forbidden).toBe("dyspnée");
  });

  it("flag « asthénie » sans accent (asthenie)", () => {
    const leaks = detectLayLeaks("Il a une asthenie progressive.");
    expect(leaks.some((l) => l.forbidden === "asthénie")).toBe(true);
  });

  it("flag forme pluriel « œdèmes »", () => {
    const leaks = detectLayLeaks("Il a des œdèmes aux jambes.");
    expect(leaks.some((l) => l.forbidden === "œdème")).toBe(true);
  });

  it("flag « antalgie de décharge » (terme composé pédiatrie)", () => {
    const leaks = detectLayLeaks("Charlotte présente une antalgie de décharge sur la jambe gauche.");
    expect(leaks.some((l) => l.forbidden === "antalgie de décharge")).toBe(true);
  });

  it("ne flag PAS « essoufflement » (équivalent lay)", () => {
    const leaks = detectLayLeaks("Il a beaucoup d'essoufflement quand il monte les escaliers.");
    expect(leaks).toEqual([]);
  });

  it("ne flag PAS un texte purement profane", () => {
    const leaks = detectLayLeaks(
      "Mon père est très fatigué, il a maigri, ses jambes sont gonflées et sa peau est jaune.",
    );
    expect(leaks).toEqual([]);
  });

  it("ne flag PAS un sous-mot accidentel (« anesthésie » ne déclenche pas « asthénie »)", () => {
    const leaks = detectLayLeaks("Il a eu une anesthésie générale.");
    expect(leaks.some((l) => l.forbidden === "asthénie")).toBe(false);
  });

  it("texte vide ⇒ no leak", () => {
    expect(detectLayLeaks("")).toEqual([]);
    expect(detectLayLeaks(undefined as unknown as string)).toEqual([]);
  });
});
