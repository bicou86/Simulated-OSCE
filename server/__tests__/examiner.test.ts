// Tests de la route /api/examiner/lookup et du scoring déterministe du service.

import { afterEach, describe, expect, it, vi } from "vitest";
import request from "supertest";

// Mock OpenAI / Anthropic pour que les routes chargées via buildTestApp()
// n'essaient pas d'ouvrir des connexions réelles.
vi.mock("openai", () => {
  class OpenAI {
    chat = { completions: { create: vi.fn() } };
    audio = {
      transcriptions: { create: vi.fn() },
      speech: { create: vi.fn() },
    };
    models = { list: vi.fn() };
    constructor(_opts: unknown) {}
  }
  return { default: OpenAI, toFile: vi.fn() };
});
vi.mock("@anthropic-ai/sdk", () => {
  class Anthropic {
    messages = { create: vi.fn() };
    constructor(_opts: unknown) {}
  }
  return { default: Anthropic };
});

const configMocks = { openai: "sk", anthropic: "sk-ant" };
vi.mock("../lib/config", () => ({
  loadConfig: vi.fn(async () => {}),
  getOpenAIKey: () => configMocks.openai,
  getAnthropicKey: () => configMocks.anthropic,
  setKeys: vi.fn(async () => {}),
  isConfigured: () => true,
}));

// On stub getPatientStation pour ne pas dépendre du catalogue réel.
const stationFixture = {
  id: "TEST-1",
  setting: "Cabinet",
  examen_resultats: {
    e1: {
      examen: "Mesures d'hygiène",
      details: [
        { item: "Lavage des mains", resultat: null },
      ],
    },
    e3: {
      examen: "Examen cardiovasculaire",
      resultat: "Auscultation cardiaque normale",
    },
    e5: {
      examen: "Examen abdominal",
      details: [
        { item: "Inspection de l'abdomen", resultat: null },
        { item: "Auscultation de l'abdomen", resultat: null },
        { item: "Percussion de l'abdomen", resultat: null },
        {
          item: "Palpation de l'abdomen",
          resultat: "Douleur à la palpation de l'épigastre et de l'hypocondre droit",
        },
      ],
    },
    e6: {
      examen: "Signe de Murphy",
      resultat: "Signe de Murphy positif - arrêt brutal de l'inspiration",
    },
  },
};

// Fixture téléconsultation (Bug #3) : aucun examen physique possible.
const teleconsultFixture = {
  id: "TEST-TEL-1",
  setting: "Consultation téléphonique pédiatrique",
  patient_description: "Fillette de 2 ans présentée par sa mère",
  examen_resultats: {
    e1: {
      examen: "Examen physique",
      resultat: "Non disponible dans les cas téléphoniques",
    },
  },
};

// Fixture "titre-comme-résultat" (Bug #1) : items cliniques avec resultat=null.
const hipFixture = {
  id: "TEST-HIP-1",
  setting: "Urgences pédiatriques",
  examen_resultats: {
    e2: {
      examen: "Examen ostéo-articulaire",
      details: [
        { item: "Pas de rougeur ni chaleur ni œdème des articulations", resultat: null },
        { item: "Douleur à la mobilisation passive de la hanche gauche", resultat: null },
        { item: "Limitation d'abduction et rotation interne", resultat: null },
        { item: "Inspection des genoux", resultat: null }, // titre purement label → no_resultat
      ],
    },
  },
};

// Fixture multi-manœuvres (Bug #2) : trois gestes distincts dans la grille ORL.
const entFixture = {
  id: "TEST-ENT-1",
  setting: "Cabinet ORL",
  examen_resultats: {
    e3: {
      examen: "Otoscopie bilatérale",
      resultat: "Normale des deux côtés",
    },
    e4: {
      examen: "Tests auditifs au diapason",
      details: [
        { item: "Test de Weber", resultat: "normal - pas de latéralisation" },
        { item: "Test de Rinne bilatéral", resultat: "normal - conduction aérienne > osseuse" },
      ],
    },
  },
};

const fixturesById: Record<string, any> = {
  "TEST-1": stationFixture,
  "TEST-TEL-1": teleconsultFixture,
  "TEST-HIP-1": hipFixture,
  "TEST-ENT-1": entFixture,
};

vi.mock("../services/patientService", async () => {
  const actual = await vi.importActual<typeof import("../services/patientService")>(
    "../services/patientService",
  );
  return {
    ...actual,
    getPatientStation: vi.fn(async (id: string) => {
      if (id === "UNKNOWN-0") {
        const { StationNotFoundError } = await vi.importActual<typeof import("../services/patientService")>(
          "../services/patientService",
        );
        throw new StationNotFoundError(id);
      }
      const fx = fixturesById[id];
      if (!fx) throw new Error(`fixture ${id} missing`);
      return fx;
    }),
  };
});

import { buildTestApp } from "./helpers";
import {
  flattenExamenResultats,
  tokenize,
  lookupExaminer,
  isTeleconsultStation,
  titleLooksLikeFinding,
  splitMultiGestures,
} from "../services/examinerService";

afterEach(() => vi.clearAllMocks());

describe("flattenExamenResultats", () => {
  it("aplatit une catégorie avec details + une catégorie à resultat simple", () => {
    const flat = flattenExamenResultats(stationFixture.examen_resultats);
    // e1 → 1 hygiène, e3 → 1 direct, e5 → 4 détails, e6 → 1 direct ⇒ 7 findings
    expect(flat).toHaveLength(7);
    const murphy = flat.find((f) => f.categoryKey === "e6");
    expect(murphy?.resultat).toMatch(/Murphy/);
    const palpation = flat.find((f) => f.maneuver === "Palpation de l'abdomen");
    expect(palpation?.resultat).toMatch(/épigastre/i);
    const hygiene = flat.find((f) => f.maneuver === "Lavage des mains");
    expect(hygiene?.resultat).toBeNull();
  });

  it("renvoie [] sur un bloc absent / invalide", () => {
    expect(flattenExamenResultats(undefined)).toEqual([]);
    expect(flattenExamenResultats(null)).toEqual([]);
    expect(flattenExamenResultats("nope")).toEqual([]);
  });
});

describe("tokenize", () => {
  it("filtre les stopwords et les tokens trop courts", () => {
    expect(tokenize("Je palpe l'abdomen")).toEqual(["palpe", "abdomen"]);
  });
  it("normalise les accents et ligatures", () => {
    const toks = tokenize("Au fond d'œil et à l'auscultation");
    expect(toks).toContain("fond");
    expect(toks).toContain("oeil");
    expect(toks).toContain("auscultation");
  });
});

describe("lookupExaminer — service", () => {
  it("trouve le bon finding pour une palpation abdominale", async () => {
    const r = await lookupExaminer("TEST-1", "je palpe l'abdomen");
    expect(r.match).toBe(true);
    expect(r.kind).toBe("finding");
    expect(r.maneuver).toBe("Palpation de l'abdomen");
    expect(r.resultat).toMatch(/épigastre/i);
  });

  it("trouve le signe de Murphy", async () => {
    const r = await lookupExaminer("TEST-1", "je cherche le signe de Murphy");
    expect(r.match).toBe(true);
    expect(r.kind).toBe("finding");
    expect(r.categoryName).toBe("Signe de Murphy");
    expect(r.resultat).toMatch(/positif/i);
  });

  it("trouve l'auscultation cardiaque", async () => {
    const r = await lookupExaminer("TEST-1", "à l'auscultation cardiaque");
    expect(r.match).toBe(true);
    expect(r.kind).toBe("finding");
    expect(r.resultat).toMatch(/normale/i);
  });

  it("retourne fallback FALLBACK_NO_RESULTAT sur un item hygiène sans résultat", async () => {
    const r = await lookupExaminer("TEST-1", "je me lave les mains");
    // "lavage" / "mains" doivent matcher l'item e1, mais resultat est null
    // ET le titre ne contient pas de verbe clinique → no_resultat.
    expect(r.match).toBe(true);
    expect(r.kind).toBe("no_resultat");
    expect(r.resultat).toBeUndefined();
    expect(r.fallback).toMatch(/pas de finding|Manœuvre/i);
  });

  it("retourne fallback_no_match sur une requête sans correspondance", async () => {
    const r = await lookupExaminer("TEST-1", "je regarde par la fenêtre");
    expect(r.match).toBe(false);
    expect(r.kind).toBe("no_match");
    expect(r.fallback).toMatch(/non disponible/i);
  });

  it("lève StationNotFoundError sur station inconnue", async () => {
    await expect(lookupExaminer("UNKNOWN-0", "palpation")).rejects.toThrow();
  });
});

// ─────── Bug #3 : cadre téléconsultation ───────

describe("isTeleconsultStation", () => {
  it("détecte les settings contenant téléphonique/téléconsultation/visio", () => {
    expect(isTeleconsultStation({ setting: "Consultation téléphonique" })).toBe(true);
    expect(isTeleconsultStation({ setting: "Téléconsultation cabinet" })).toBe(true);
    expect(isTeleconsultStation({ setting: "Visio avec le médecin" })).toBe(true);
    expect(isTeleconsultStation({ setting: "Télémédecine" })).toBe(true);
  });
  it("ignore les settings présentiels", () => {
    expect(isTeleconsultStation({ setting: "Cabinet médical" })).toBe(false);
    expect(isTeleconsultStation({ setting: "Urgences" })).toBe(false);
  });
  it("tolère l'accent manquant (robuste à la normalisation)", () => {
    expect(isTeleconsultStation({ setting: "Consultation telephonique" })).toBe(true);
  });
});

describe("lookupExaminer — Bug #3 cadre téléconsultation", () => {
  it("renvoie no_teleconsult au lieu d'un fallback générique", async () => {
    const r = await lookupExaminer("TEST-TEL-1", "je palpe l'abdomen");
    expect(r.kind).toBe("no_teleconsult");
    expect(r.match).toBe(false);
    expect(r.fallback).toMatch(/téléconsultation/i);
    expect(r.fallback).toMatch(/parent|patient|présentiel/i);
    expect(r.resultat).toBeUndefined();
  });
  it("n'affecte pas les stations présentielles (AMBOSS-1-like)", async () => {
    const r = await lookupExaminer("TEST-1", "je palpe l'abdomen");
    expect(r.kind).toBe("finding");
    expect(r.resultat).toMatch(/épigastre/i);
  });
});

// ─────── Bug #1 : titre de l'item = finding (resultat null) ───────

describe("titleLooksLikeFinding", () => {
  it("reconnaît un titre qui décrit un état clinique", () => {
    expect(titleLooksLikeFinding("Limitation d'abduction et rotation interne")).toBe(true);
    expect(titleLooksLikeFinding("Douleur à la mobilisation passive")).toBe(true);
    expect(titleLooksLikeFinding("Pas de rougeur ni chaleur")).toBe(true);
    expect(titleLooksLikeFinding("Signe présent")).toBe(true);
    expect(titleLooksLikeFinding("Réflexe augmenté")).toBe(true);
    expect(titleLooksLikeFinding("Test de Lasègue positif")).toBe(true);
    expect(titleLooksLikeFinding("Auscultation normale")).toBe(true);
  });
  it("rejette un titre purement descriptif (label de geste)", () => {
    expect(titleLooksLikeFinding("Auscultation cardiaque")).toBe(false);
    expect(titleLooksLikeFinding("Palpation mastoïdienne")).toBe(false);
    expect(titleLooksLikeFinding("Inspection du pavillon auriculaire")).toBe(false);
    expect(titleLooksLikeFinding("Lavage des mains")).toBe(false);
    expect(titleLooksLikeFinding("Test de Weber")).toBe(false);
  });
});

describe("lookupExaminer — Bug #1 titre-comme-résultat", () => {
  it("renvoie le titre quand resultat=null + verbe clinique dans le titre", async () => {
    const r = await lookupExaminer("TEST-HIP-1", "limitation abduction hanche");
    expect(r.kind).toBe("finding");
    expect(r.match).toBe(true);
    expect(r.source).toBe("title_as_result");
    expect(r.resultat).toMatch(/Limitation|limitation/);
    expect(r.resultat).toMatch(/abduction/i);
  });
  it("renvoie un finding issu du titre sur « examen de la hanche »", async () => {
    const r = await lookupExaminer("TEST-HIP-1", "examen de la hanche");
    // N'importe quel item de e2 contenant "hanche" est acceptable, tant qu'on
    // ne tombe pas sur no_resultat.
    expect(r.kind).toBe("finding");
    expect(r.source).toBe("title_as_result");
    expect(r.resultat).toBeDefined();
  });
  it("retombe sur no_resultat quand le titre est un label neutre", async () => {
    const r = await lookupExaminer("TEST-HIP-1", "inspection des genoux");
    expect(r.kind).toBe("no_resultat");
    expect(r.resultat).toBeUndefined();
    expect(r.fallback).toMatch(/pas de finding|Manœuvre/i);
  });
  it("n'affecte pas les stations où resultat est rempli (Murphy)", async () => {
    const r = await lookupExaminer("TEST-1", "je cherche le signe de Murphy");
    expect(r.kind).toBe("finding");
    expect(r.source).toBeUndefined();
    expect(r.resultat).toMatch(/positif/i);
  });
});

// ─────── Bug #2 : multi-manœuvres dans une seule phrase ───────

describe("splitMultiGestures", () => {
  it("splitte sur virgule, puis, ensuite, après, et", () => {
    expect(splitMultiGestures("je fais une otoscopie, puis les tests de Rinne et Weber"))
      .toEqual(["je fais une otoscopie", "les tests de rinne", "weber"]);
    expect(splitMultiGestures("palpation, ensuite auscultation"))
      .toEqual(["palpation", "auscultation"]);
    expect(splitMultiGestures("inspection après palpation"))
      .toEqual(["inspection", "palpation"]);
  });
  it("renvoie la requête entière quand il n'y a pas de connecteur", () => {
    expect(splitMultiGestures("je palpe l'abdomen")).toEqual(["je palpe l'abdomen"]);
  });
  it("ne splitte pas sur des mots contenant « et » (« etat », « puisque »)", () => {
    expect(splitMultiGestures("etat general")).toEqual(["etat general"]);
  });
});

describe("lookupExaminer — Bug #2 multi-manœuvres", () => {
  it("renvoie un payload agrégé avec 3 items pour otoscopie + Rinne + Weber", async () => {
    const r = await lookupExaminer(
      "TEST-ENT-1",
      "je fais une otoscopie, puis j'effectue les tests de Rinne et Weber",
    );
    expect(r.kind).toBe("findings");
    expect(r.match).toBe(true);
    expect(r.items).toBeDefined();
    expect(r.items!.length).toBe(3);
    const maneuvers = r.items!.map((i) => i.maneuver);
    expect(maneuvers.some((m) => /Otoscopie/i.test(m))).toBe(true);
    expect(maneuvers.some((m) => /Rinne/i.test(m))).toBe(true);
    expect(maneuvers.some((m) => /Weber/i.test(m))).toBe(true);
  });
  it("agrège 2 findings dans la même catégorie abdominale (palpation + Murphy)", async () => {
    const r = await lookupExaminer(
      "TEST-1",
      "je palpe les 4 quadrants et cherche Murphy",
    );
    expect(r.kind).toBe("findings");
    expect(r.items!.length).toBe(2);
    const maneuvers = r.items!.map((i) => i.maneuver);
    expect(maneuvers.some((m) => /Palpation/i.test(m))).toBe(true);
    expect(maneuvers.some((m) => /Murphy/i.test(m))).toBe(true);
  });
  it("conserve le comportement simple (kind=finding) quand une seule manœuvre est citée", async () => {
    const r = await lookupExaminer("TEST-1", "je cherche le signe de Murphy");
    expect(r.kind).toBe("finding");
    expect(r.items).toBeUndefined();
  });
  it("dédoublonne les segments qui matchent la même manœuvre", async () => {
    // Les deux segments visent "Palpation de l'abdomen" → 1 seul finding.
    const r = await lookupExaminer(
      "TEST-1",
      "je palpe l'abdomen et je palpe encore l'abdomen",
    );
    expect(r.kind).toBe("finding");
    expect(r.items).toBeUndefined();
  });
  it("tombe sur no_match quand aucun segment ne matche", async () => {
    const r = await lookupExaminer(
      "TEST-1",
      "je regarde par la fenêtre, puis j'observe les nuages",
    );
    expect(r.kind).toBe("no_match");
    expect(r.match).toBe(false);
  });
});

describe("POST /api/examiner/lookup", () => {
  it("200 avec finding sur requête valide", async () => {
    const app = buildTestApp();
    const res = await request(app).post("/api/examiner/lookup").send({
      stationId: "TEST-1",
      query: "je palpe l'abdomen",
    });
    expect(res.status).toBe(200);
    expect(res.body.match).toBe(true);
    expect(res.body.kind).toBe("finding");
    expect(res.body.resultat).toMatch(/épigastre|hypocondre/i);
  });

  it("200 avec match=false sur requête hors grille", async () => {
    const app = buildTestApp();
    const res = await request(app).post("/api/examiner/lookup").send({
      stationId: "TEST-1",
      query: "xyz abcdef",
    });
    expect(res.status).toBe(200);
    expect(res.body.match).toBe(false);
    expect(res.body.kind).toBe("no_match");
    expect(res.body.fallback).toMatch(/non disponible/i);
  });

  it("200 avec kind=no_teleconsult sur station téléphonique", async () => {
    const app = buildTestApp();
    const res = await request(app).post("/api/examiner/lookup").send({
      stationId: "TEST-TEL-1",
      query: "je palpe l'abdomen",
    });
    expect(res.status).toBe(200);
    expect(res.body.kind).toBe("no_teleconsult");
    expect(res.body.fallback).toMatch(/téléconsultation/i);
  });

  it("200 avec kind=findings sur requête multi-manœuvres", async () => {
    const app = buildTestApp();
    const res = await request(app).post("/api/examiner/lookup").send({
      stationId: "TEST-ENT-1",
      query: "otoscopie, puis tests de Rinne et Weber",
    });
    expect(res.status).toBe(200);
    expect(res.body.kind).toBe("findings");
    expect(res.body.items).toBeDefined();
    expect(res.body.items.length).toBe(3);
  });

  it("400 sur payload invalide (stationId vide)", async () => {
    const app = buildTestApp();
    const res = await request(app).post("/api/examiner/lookup").send({
      stationId: "",
      query: "palpation",
    });
    expect(res.status).toBe(400);
  });

  it("400 sur station inconnue", async () => {
    const app = buildTestApp();
    const res = await request(app).post("/api/examiner/lookup").send({
      stationId: "UNKNOWN-0",
      query: "palpation",
    });
    expect(res.status).toBe(400);
  });
});
