// Phase 4 J3 — tests unitaires du filtre `filterStationByScope`.
//
// On vérifie le contrat strict :
//   • sections non listées dans participantSections ⇒ visibles à tous,
//   • sections listées + scope intersecte ⇒ visibles,
//   • sections listées + scope ne matche aucun tag ⇒ supprimées,
//   • chemins dotés à 1 et 2 niveaux,
//   • le champ `participantSections` est lui-même retiré de la copie
//     (jamais injecté dans le LLM),
//   • la station originale n'est pas mutée (clone profond).

import { describe, expect, it } from "vitest";
import { filterStationByScope } from "../services/patientService";

const SENSITIVE_STATION = {
  id: "TEST-1",
  nom: "Patient X",
  vitals: { ta: "120/80" },
  histoire_actuelle: {
    symptomePrincipal: "fatigue",
    symptomesAssocies: "spotting",
    contexteVie: "lycée",
  },
  antecedents: {
    medicaux: "rien",
    gyneco: "pilule depuis 3 mois",
    traitements_en_cours: "Cerazette",
    familiaux: "HTA mère",
  },
  contexte: "Emma prend la pilule (top secret)",
  participantSections: {
    contexte: ["full_scenario"],
    "histoire_actuelle.symptomesAssocies": ["sexual_health"],
    "histoire_actuelle.contexteVie": ["sexual_health", "school"],
    "antecedents.gyneco": ["sexual_health"],
    "antecedents.traitements_en_cours": ["contraception"],
  },
};

describe("filterStationByScope — Phase 4 J3", () => {
  it("retire participantSections de la sortie (jamais leak au LLM)", () => {
    const out = filterStationByScope(SENSITIVE_STATION, ["full_scenario", "sexual_health", "contraception", "school"]);
    expect((out as { participantSections?: unknown }).participantSections).toBeUndefined();
  });

  it("scope omniscient (couvre tous les tags) ⇒ identique au station moins participantSections", () => {
    const out = filterStationByScope(SENSITIVE_STATION, ["full_scenario", "sexual_health", "contraception", "school"]);
    expect(out.contexte).toBe("Emma prend la pilule (top secret)");
    const ha = out.histoire_actuelle as Record<string, unknown>;
    expect(ha.symptomesAssocies).toBe("spotting");
    expect(ha.contexteVie).toBe("lycée");
    const ant = out.antecedents as Record<string, unknown>;
    expect(ant.gyneco).toBe("pilule depuis 3 mois");
    expect(ant.traitements_en_cours).toBe("Cerazette");
  });

  it("scope vide ⇒ supprime toutes les sections taggées (mais garde les non-listées)", () => {
    const out = filterStationByScope(SENSITIVE_STATION, []);
    // Sections taggées ⇒ supprimées
    expect(out.contexte).toBeUndefined();
    const ha = out.histoire_actuelle as Record<string, unknown>;
    expect(ha.symptomesAssocies).toBeUndefined();
    expect(ha.contexteVie).toBeUndefined();
    const ant = out.antecedents as Record<string, unknown>;
    expect(ant.gyneco).toBeUndefined();
    expect(ant.traitements_en_cours).toBeUndefined();
    // Sections non listées ⇒ visibles
    expect(ha.symptomePrincipal).toBe("fatigue");
    expect(ant.medicaux).toBe("rien");
    expect(ant.familiaux).toBe("HTA mère");
    expect(out.nom).toBe("Patient X");
    expect(out.vitals).toEqual({ ta: "120/80" });
  });

  it("scope mère RESCOS-70 (identité, symptômes_observés, antécédents_familiaux) ⇒ aucune fuite contraception", () => {
    const out = filterStationByScope(SENSITIVE_STATION, [
      "identité",
      "symptômes_observés",
      "antécédents_familiaux",
    ]);
    // Toutes les sections sensibles disparaissent.
    expect(out.contexte).toBeUndefined();
    const ant = out.antecedents as Record<string, unknown>;
    expect(ant.gyneco).toBeUndefined();
    expect(ant.traitements_en_cours).toBeUndefined();
    expect(ant.familiaux).toBe("HTA mère"); // visible (non listée)
  });

  it("scope partiel (sexual_health uniquement, sans contraception) ⇒ traitements_en_cours reste caché", () => {
    const out = filterStationByScope(SENSITIVE_STATION, ["sexual_health"]);
    const ant = out.antecedents as Record<string, unknown>;
    expect(ant.gyneco).toBe("pilule depuis 3 mois"); // sexual_health
    expect(ant.traitements_en_cours).toBeUndefined(); // contraception only
  });

  it("station sans participantSections ⇒ identité (clone, sans muter l'original)", () => {
    const station = { id: "X", nom: "Mr. X", vitals: { ta: "120/80" } };
    const out = filterStationByScope(station, []);
    expect(out).toEqual(station);
    // Vérification que c'est un clone (mutation indépendante).
    (out.vitals as Record<string, unknown>).ta = "MUTATED";
    expect((station.vitals as Record<string, unknown>).ta).toBe("120/80");
  });

  it("ne mute jamais la station d'origine", () => {
    const original = JSON.parse(JSON.stringify(SENSITIVE_STATION));
    filterStationByScope(SENSITIVE_STATION, []);
    expect(SENSITIVE_STATION).toEqual(original);
  });

  it("chemin .a.b inexistant ⇒ no-op (pas d'exception)", () => {
    const station: Record<string, unknown> = {
      id: "X",
      participantSections: { "ghost.path": ["secret"] },
    };
    expect(() => filterStationByScope(station, [])).not.toThrow();
  });

  it("préserve les arrays et scalars hors règles", () => {
    const station: Record<string, unknown> = {
      id: "X",
      tags: ["a", "b", "c"],
      vitals: { ta: "120/80", fc: "70" },
      stationType: "anamnese_examen",
    };
    const out = filterStationByScope(station, []);
    expect(out.tags).toEqual(["a", "b", "c"]);
    expect(out.vitals).toEqual({ ta: "120/80", fc: "70" });
    expect(out.stationType).toBe("anamnese_examen");
  });

  it("règle avec 2 tags ⇒ visible si scope intersecte au moins UN tag (OR logique)", () => {
    const station = {
      id: "X",
      sectionA: "contenu A",
      participantSections: { sectionA: ["tagX", "tagY"] },
    };
    expect(filterStationByScope(station, ["tagX"]).sectionA).toBe("contenu A");
    expect(filterStationByScope(station, ["tagY"]).sectionA).toBe("contenu A");
    expect(filterStationByScope(station, ["tagZ"]).sectionA).toBeUndefined();
  });
});
