// Tests Phase 3 J2 — service labs + route /api/examiner/labs.
// Même stratégie de mocks que examiner.test.ts : on stub getPatientStation
// pour ne pas dépendre du catalogue réel, et on injecte des fixtures ciblées
// couvrant :
//   - labs résolus (single + multi, adulte + pédiatrique) ;
//   - fallbacks (no_teleconsult, no_labs, no_match) ;
//   - overrides de flag + absence de lab sur la station.

import { afterEach, describe, expect, it, vi } from "vitest";
import request from "supertest";

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

// ─────────── Fixtures station ───────────

const adultFixture = {
  id: "LAB-1",
  setting: "Service d'urgences",
  patient_description: "Homme de 45 ans",
  examen_resultats: {},
  examens_complementaires: {
    troponine_hs: {
      parameters: { troponine_hs: { value: 180 } },
      interpretation: "Troponine hs positive — compatible avec SCA.",
    },
    nfs: {
      parameters: {
        hb: { value: 14.8 },
        gb: { value: 9.2 },
        plaquettes: { value: 248 },
      },
    },
    ionogramme: {
      parameters: {
        sodium: { value: 139 },
        potassium: { value: 4.2 },
        chlore: { value: 102 },
        creatinine: { value: 95 },
        uree: { value: 5.5 },
      },
    },
  },
};

const pediatricFixture = {
  id: "LAB-PED-1",
  setting: "Urgences pédiatriques",
  patient_description: "Fillette de 2 ans, fièvre élevée",
  examen_resultats: {},
  examens_complementaires: {
    nfs: {
      parameters: {
        hb: { value: 11.8 },
        gb: { value: 18.2 },
        plaquettes: { value: 385 },
      },
    },
    crp: {
      parameters: { crp: { value: 68 } },
    },
  },
};

const teleconsultFixture = {
  id: "LAB-TEL-1",
  setting: "Consultation téléphonique",
  patient_description: "Enfant de 6 ans, téléconsultation",
  examen_resultats: {},
  examens_complementaires: {
    nfs: { parameters: { hb: { value: 13 } } },
  },
};

const noLabsFixture = {
  id: "LAB-NONE-1",
  setting: "Cabinet",
  patient_description: "Femme de 30 ans",
  examen_resultats: {},
  // pas de examens_complementaires du tout
};

const partialLabsFixture = {
  id: "LAB-PARTIAL-1",
  setting: "Cabinet",
  patient_description: "Homme de 60 ans",
  examen_resultats: {},
  examens_complementaires: {
    nfs: { parameters: { hb: { value: 13 } } },
    // pas de CRP — la demande CRP doit fallback
  },
};

const flagOverrideFixture = {
  id: "LAB-OVERRIDE-1",
  setting: "Cabinet",
  patient_description: "Homme de 50 ans",
  examen_resultats: {},
  examens_complementaires: {
    troponine_hs: {
      // Valeur 8 ng/L = normal par le computed flag (normalRange 0-14),
      // mais la station impose "critical" en override pour simuler un
      // contexte clinique particulier.
      parameters: { troponine_hs: { value: 8, flag: "critical" } },
    },
  },
};

const fixturesById: Record<string, unknown> = {
  "LAB-1": adultFixture,
  "LAB-PED-1": pediatricFixture,
  "LAB-TEL-1": teleconsultFixture,
  "LAB-NONE-1": noLabsFixture,
  "LAB-PARTIAL-1": partialLabsFixture,
  "LAB-OVERRIDE-1": flagOverrideFixture,
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
  lookupLabs,
  matchLabKeys,
  parsePatientAge,
  queryAsksForLabs,
  resolveLabResult,
} from "../services/labsService";
import {
  LAB_DEFINITIONS,
  computeFlag,
  pickRangeForAge,
} from "@shared/lab-definitions";

afterEach(() => vi.clearAllMocks());

// ─────────── queryAsksForLabs ───────────

describe("queryAsksForLabs — heuristique active verb + lab keyword", () => {
  const positives: string[] = [
    "je demande une NFS",
    "je prescris une CRP",
    "je fais un ionogramme",
    "je commande un bilan hépatique",
    "je demande une troponine hs",
    "faites une βHCG",
    "un bilan rénal s'il vous plaît",
    "je propose un gaz du sang artériel",
    "prescrivez un hémogramme",
  ];
  for (const q of positives) {
    it(`détecte "${q}"`, () => {
      expect(queryAsksForLabs(q)).toBe(true);
    });
  }

  const negatives: string[] = [
    "avez-vous déjà fait une NFS ?",
    "vos dernières analyses montraient quoi ?",
    "votre dernière CRP à combien ?",
    "quand avez-vous eu votre dernier ionogramme ?",
    "je palpe l'abdomen",
    "je demande une radio du thorax",
    "a-t-elle eu une NFS récemment ?",
  ];
  for (const q of negatives) {
    it(`ignore "${q}"`, () => {
      expect(queryAsksForLabs(q)).toBe(false);
    });
  }
});

describe("matchLabKeys — extraction de clés depuis la requête", () => {
  it("trouve une seule clé pour une demande simple", () => {
    expect(matchLabKeys("je demande une NFS")).toEqual(["nfs"]);
  });

  it("trouve plusieurs clés dans l'ordre d'apparition", () => {
    const keys = matchLabKeys("je prescris une NFS, une CRP et un ionogramme");
    expect(keys).toEqual(["nfs", "crp", "ionogramme"]);
  });

  it("normalise les variantes orthographiques", () => {
    expect(matchLabKeys("hémogramme")).toEqual(["nfs"]);
    expect(matchLabKeys("formule sanguine")).toEqual(["nfs"]);
    expect(matchLabKeys("beta hcg")).toEqual(["bhcg"]);
    expect(matchLabKeys("βHCG")).toEqual(["bhcg"]);
  });

  it("retourne [] quand aucun mot-clé lab ne matche", () => {
    expect(matchLabKeys("je palpe l'abdomen")).toEqual([]);
  });

  it("dédoublonne les matches multiples sur le même lab", () => {
    const keys = matchLabKeys("je demande une NFS et un hémogramme");
    expect(keys).toEqual(["nfs"]);
  });
});

// ─────────── parsePatientAge ───────────

describe("parsePatientAge — parsing depuis description ou champ explicite", () => {
  it("extrait l'âge depuis patient_description", () => {
    expect(parsePatientAge({ patient_description: "Homme de 45 ans" })).toBe(45);
    expect(parsePatientAge({ patient_description: "Fillette de 2 ans" })).toBe(2);
    expect(parsePatientAge({ patient_description: "Jeune homme de 16 ans" })).toBe(16);
  });

  it("convertit les mois en fraction d'année", () => {
    const v = parsePatientAge({ patient_description: "Nourrisson de 6 mois" });
    expect(v).toBeCloseTo(0.5);
  });

  it("privilégie le champ explicite si présent", () => {
    expect(parsePatientAge({ patient_age_years: 12, patient_description: "Fillette de 2 ans" })).toBe(12);
  });

  it("retourne null quand aucune source exploitable", () => {
    expect(parsePatientAge({})).toBeNull();
    expect(parsePatientAge({ patient_description: "Adulte d'âge moyen" })).toBeNull();
  });
});

// ─────────── computeFlag + pickRangeForAge ───────────

describe("computeFlag — flags selon age + normes", () => {
  const hb = LAB_DEFINITIONS.nfs.parameters.find((p) => p.key === "hb")!;

  it("adulte normal", () => {
    expect(computeFlag(hb, 14.5, 45)).toBe("normal");
  });

  it("adulte bas", () => {
    expect(computeFlag(hb, 11, 45)).toBe("low");
  });

  it("adulte critique (Hb ≤ 7)", () => {
    expect(computeFlag(hb, 6.5, 45)).toBe("critical");
  });

  it("pédiatrique 2 ans : normale pédiatrique (12) serait low en norme adulte", () => {
    // Pour un enfant de 2 ans, normes péd = 11.5–14.5. Hb 12 = normal péd.
    // Mais en norme adulte (12–16) il serait aussi limite basse — ici le flag
    // doit utiliser la plage péd, donc "normal".
    expect(computeFlag(hb, 12, 2)).toBe("normal");
  });

  it("pickRangeForAge sélectionne la bonne plage", () => {
    expect(pickRangeForAge(hb, 45).source).toBe("adult");
    expect(pickRangeForAge(hb, 2).source).toBe("pediatric");
    expect(pickRangeForAge(hb, null).source).toBe("adult");
  });
});

// ─────────── resolveLabResult ───────────

describe("resolveLabResult — merge station + définition", () => {
  it("résout une NFS adulte avec flags calculés", () => {
    const def = LAB_DEFINITIONS.nfs;
    const result = resolveLabResult(
      def,
      { parameters: { hb: { value: 14.8 }, gb: { value: 9.2 } } },
      45,
    );
    expect(result.key).toBe("nfs");
    expect(result.label).toBe("Numération-formule sanguine (NFS)");
    expect(result.parameters).toHaveLength(2);
    const hb = result.parameters.find((p) => p.key === "hb")!;
    expect(hb.value).toBe(14.8);
    expect(hb.flag).toBe("normal");
    expect(hb.normalRange.source).toBe("adult");
  });

  it("résout une NFS pédiatrique avec range adaptée", () => {
    const def = LAB_DEFINITIONS.nfs;
    const result = resolveLabResult(
      def,
      { parameters: { gb: { value: 18.2 } } },
      2,
    );
    const gb = result.parameters.find((p) => p.key === "gb")!;
    expect(gb.flag).toBe("high"); // > 15.5 en pédiatrique 2–5 ans
    expect(gb.normalRange.source).toBe("pediatric");
    expect(gb.normalRange.max).toBe(15.5);
  });

  it("omet les paramètres que la station ne fournit pas", () => {
    const def = LAB_DEFINITIONS.nfs;
    const result = resolveLabResult(def, { parameters: { hb: { value: 13 } } }, 40);
    expect(result.parameters.map((p) => p.key)).toEqual(["hb"]);
  });

  it("respecte un override de flag depuis la station", () => {
    const def = LAB_DEFINITIONS.troponine_hs;
    const result = resolveLabResult(
      def,
      { parameters: { troponine_hs: { value: 8, flag: "critical" } } },
      50,
    );
    const tr = result.parameters[0];
    expect(tr.value).toBe(8);
    expect(tr.flag).toBe("critical"); // override, pas "normal" (computed aurait été normal)
  });
});

// ─────────── lookupLabs — bout en bout ───────────

describe("lookupLabs — service", () => {
  it("renvoie labs résolus pour un adulte STEMI", async () => {
    const r = await lookupLabs("LAB-1", "je demande une troponine hs et une NFS");
    expect(r.match).toBe(true);
    expect(r.kind).toBe("labs");
    expect(r.results).toHaveLength(2);
    const keys = r.results!.map((lab) => lab.key);
    expect(keys).toContain("troponine_hs");
    expect(keys).toContain("nfs");
    const trop = r.results!.find((lab) => lab.key === "troponine_hs")!;
    expect(trop.parameters[0].value).toBe(180);
    expect(trop.parameters[0].flag).toBe("critical");
  });

  it("propage l'interpretation de la station", async () => {
    const r = await lookupLabs("LAB-1", "je demande une troponine hs");
    expect(r.results![0].interpretation).toMatch(/compatible.*SCA/i);
  });

  it("utilise les normes pédiatriques pour un enfant de 2 ans", async () => {
    const r = await lookupLabs("LAB-PED-1", "je demande une NFS et une CRP");
    const nfs = r.results!.find((lab) => lab.key === "nfs")!;
    const gb = nfs.parameters.find((p) => p.key === "gb")!;
    expect(gb.flag).toBe("high");
    expect(gb.normalRange.source).toBe("pediatric");
    expect(gb.normalRange.max).toBe(15.5);
  });

  it("retourne no_teleconsult en consultation téléphonique", async () => {
    const r = await lookupLabs("LAB-TEL-1", "je demande une NFS");
    expect(r.match).toBe(false);
    expect(r.kind).toBe("no_teleconsult");
    expect(r.fallback).toMatch(/téléconsultation/i);
  });

  it("retourne no_labs si la station n'a pas d'examens_complementaires", async () => {
    const r = await lookupLabs("LAB-NONE-1", "je demande une NFS");
    expect(r.match).toBe(false);
    expect(r.kind).toBe("no_labs");
    expect(r.requestedLabKeys).toEqual(["nfs"]);
    expect(r.fallback).toMatch(/non disponibles/i);
  });

  it("retourne no_labs si le lab demandé n'est pas présent (station partielle)", async () => {
    const r = await lookupLabs("LAB-PARTIAL-1", "je demande une CRP");
    expect(r.match).toBe(false);
    expect(r.kind).toBe("no_labs");
    expect(r.requestedLabKeys).toEqual(["crp"]);
  });

  it("résout seulement le subset demandé quand plusieurs labs mentionnés sur station partielle", async () => {
    // Station a NFS mais pas CRP : on doit récupérer uniquement NFS et pas
    // fallback global, puisqu'au moins un lab matche.
    const r = await lookupLabs("LAB-PARTIAL-1", "je demande une NFS et une CRP");
    expect(r.match).toBe(true);
    expect(r.kind).toBe("labs");
    expect(r.results!.map((lab) => lab.key)).toEqual(["nfs"]);
    expect(r.requestedLabKeys).toEqual(["nfs", "crp"]);
  });

  it("retourne no_match si aucun mot-clé lab n'est détecté", async () => {
    const r = await lookupLabs("LAB-1", "je palpe l'abdomen");
    expect(r.match).toBe(false);
    expect(r.kind).toBe("no_match");
  });

  it("respecte l'override de flag station-level", async () => {
    const r = await lookupLabs("LAB-OVERRIDE-1", "je demande une troponine hs");
    const trop = r.results!.find((lab) => lab.key === "troponine_hs")!;
    expect(trop.parameters[0].flag).toBe("critical");
  });

  it("lève StationNotFoundError sur station inconnue", async () => {
    await expect(lookupLabs("UNKNOWN-0", "je demande une NFS")).rejects.toThrow();
  });
});

// ─────────── POST /api/examiner/labs ───────────

describe("POST /api/examiner/labs", () => {
  it("200 avec labs résolus sur requête valide", async () => {
    const app = buildTestApp();
    const res = await request(app).post("/api/examiner/labs").send({
      stationId: "LAB-1",
      query: "je demande une NFS",
    });
    expect(res.status).toBe(200);
    expect(res.body.kind).toBe("labs");
    expect(res.body.results).toHaveLength(1);
    expect(res.body.results[0].key).toBe("nfs");
  });

  it("200 avec no_teleconsult en consultation distante", async () => {
    const app = buildTestApp();
    const res = await request(app).post("/api/examiner/labs").send({
      stationId: "LAB-TEL-1",
      query: "je demande une NFS",
    });
    expect(res.status).toBe(200);
    expect(res.body.kind).toBe("no_teleconsult");
  });

  it("200 avec no_labs si la station n'a pas le bloc", async () => {
    const app = buildTestApp();
    const res = await request(app).post("/api/examiner/labs").send({
      stationId: "LAB-NONE-1",
      query: "je demande une CRP",
    });
    expect(res.status).toBe(200);
    expect(res.body.kind).toBe("no_labs");
  });

  it("400 sur payload invalide (stationId manquant)", async () => {
    const app = buildTestApp();
    const res = await request(app).post("/api/examiner/labs").send({
      query: "je demande une NFS",
    });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("bad_request");
  });

  it("400 si la station est inconnue", async () => {
    const app = buildTestApp();
    const res = await request(app).post("/api/examiner/labs").send({
      stationId: "UNKNOWN-0",
      query: "je demande une NFS",
    });
    expect(res.status).toBe(400);
  });
});
