// Phase 11 J3 — verrou de non-régression sur les baselines runtime
// après migration `pedagogicalContent` dans 14 Patient_*.json.
//
// La migration AJOUTE le champ `pedagogicalContent` à 281/288 stations
// du catalogue (4 sans source : RESCOS-64-P2, RESCOS-70, RESCOS-71,
// RESCOS-72 ; 3 collisions runtime dédupliquées par extractShortId).
// L'invariant I13 (META_FIELDS_TO_STRIP étendu en J2) garantit que :
//   • le brief HTTP ne fuite jamais `pedagogicalContent`
//   • les 6 baselines byteLength HTTP sont strictement préservées
//
// Ce fichier exerce ces deux propriétés en runtime supertest.

import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { initCatalog } from "../services/stationsService";
import { buildTestApp } from "./helpers";

beforeAll(async () => {
  await initCatalog();
});

describe("Phase 11 J3 — baselines byteLength HTTP préservées post-migration", () => {
  // Les 6 baselines historiques figées (Phase 7-9) — la migration ne
  // doit faire dériver AUCUNE d'entre elles. Si une baseline change,
  // c'est qu'un META_FIELDS_TO_STRIP a un trou.
  const BASELINES = [
    { id: "RESCOS-64", bytes: 682 },
    { id: "RESCOS-64-P2", bytes: 781 },
    { id: "AMBOSS-24", bytes: 528 },
    { id: "USMLE-34", bytes: 540 },
    { id: "USMLE-9", bytes: 509 },
    { id: "RESCOS-72", bytes: 717 },
  ];

  it.each(BASELINES)(
    "GET /api/patient/$id/brief = $bytes B UTF-8 (post-J3)",
    async ({ id, bytes }) => {
      const app = buildTestApp();
      const res = await request(app).get(`/api/patient/${id}/brief`);
      expect(res.status).toBe(200);
      const measured = Buffer.byteLength(JSON.stringify(res.body), "utf-8");
      expect(
        measured,
        `${id} : drift baseline post-J3 (attendu ${bytes}, mesuré ${measured})`,
      ).toBe(bytes);
    },
  );

  it("GET /api/evaluator/weights : table v1 inchangée (anamnese_examen.anamnese === 25)", async () => {
    const app = buildTestApp();
    const res = await request(app).get("/api/evaluator/weights");
    expect(res.status).toBe(200);
    const body = res.body as {
      axes?: string[];
      weights?: { anamnese_examen?: { anamnese?: number } };
    };
    expect(body.weights?.anamnese_examen?.anamnese).toBe(25);
  });

  it("GET /api/debug/evaluation-weights?stationId=RESCOS-72 : 6 axes, sumWeights=100, medico_legal=10", async () => {
    const app = buildTestApp();
    const res = await request(app).get(
      "/api/debug/evaluation-weights?stationId=RESCOS-72",
    );
    expect(res.status).toBe(200);
    const body = res.body as {
      sumWeights?: number;
      weights?: Record<string, number>;
    };
    expect(body.sumWeights).toBe(100);
    expect(body.weights?.medico_legal).toBe(10);
    // 6 axes attendus côté legal stations (Phase 7 J2 sixth axis).
    expect(Object.keys(body.weights ?? {})).toHaveLength(6);
  });
});
