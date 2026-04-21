// Tests de la route /api/stations — catalogue indexé en mémoire.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";

vi.mock("openai", () => ({
  default: class { constructor(_o: unknown) {} },
  toFile: vi.fn(),
}));
vi.mock("@anthropic-ai/sdk", () => ({
  default: class { constructor(_o: unknown) {} },
}));
vi.mock("../lib/config", () => ({
  loadConfig: vi.fn(async () => {}),
  getOpenAIKey: () => "sk-test",
  getAnthropicKey: () => "sk-ant-test",
  setKeys: vi.fn(async () => {}),
  isConfigured: () => true,
}));

// Mock du service pour contrôler le catalogue sans lire les vrais JSON.
vi.mock("../services/stationsService", () => ({
  initCatalog: vi.fn(async () => {}),
  listStations: () => [
    { id: "AMBOSS-1", fullId: "AMBOSS-1 - X", title: "X", source: "AMBOSS", setting: "Urgences", patientFile: "Patient_AMBOSS_1.json", evaluatorFile: "Examinateur_AMBOSS_1.json", indexInFile: 0 },
    { id: "RESCOS-1", fullId: "RESCOS-1 - Y", title: "Y", source: "RESCOS", setting: "Cabinet", patientFile: "Patient_RESCOS_1.json", evaluatorFile: "Examinateur_RESCOS_1.json", indexInFile: 0 },
  ],
  getStationMeta: (id: string) => {
    if (id === "RESCOS-1") {
      return { id: "RESCOS-1", fullId: "RESCOS-1 - Y", title: "Y", source: "RESCOS", setting: "Cabinet", patientFile: "Patient_RESCOS_1.json", evaluatorFile: "Examinateur_RESCOS_1.json", indexInFile: 0 };
    }
    return undefined;
  },
  patientFilePath: (f: string) => f,
  evaluatorFilePath: (f: string) => f,
}));

import { buildTestApp } from "./helpers";

describe("/api/stations", () => {
  afterEach(() => vi.clearAllMocks());

  it("GET / returns the catalog", async () => {
    const app = buildTestApp();
    const res = await request(app).get("/api/stations");
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(2);
    expect(res.body.stations[0]).toEqual({
      id: "AMBOSS-1", title: "X", source: "AMBOSS", setting: "Urgences",
    });
  });

  it("GET /:id returns the station meta", async () => {
    const app = buildTestApp();
    const res = await request(app).get("/api/stations/RESCOS-1");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      id: "RESCOS-1", title: "Y", source: "RESCOS", setting: "Cabinet",
    });
  });

  it("GET /:id returns 404 when unknown", async () => {
    const app = buildTestApp();
    const res = await request(app).get("/api/stations/UNKNOWN-1");
    expect(res.status).toBe(404);
    expect(res.body.code).toBe("not_found");
  });
});
