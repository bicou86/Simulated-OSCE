// Phase 5 J2 — tests E2E HTTP sur POST /api/evaluation/legal.
//
// Vérifie le contrat de la route :
//   • 200 + payload complet sur les 3 stations pilotes,
//   • 400 si stationId inconnu,
//   • 400 si station sans legalContext (ex. RESCOS-1),
//   • 400 si body invalide (Zod).
// 0 LLM, 0 mock OpenAI/Anthropic — la chaîne est 100 % déterministe.

import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { initCatalog } from "../services/stationsService";
import { buildTestApp } from "./helpers";

beforeAll(async () => {
  await initCatalog();
});

describe("POST /api/evaluation/legal", () => {
  it("200 + structure complète sur AMBOSS-24 (transcript parfait)", async () => {
    const app = buildTestApp();
    const res = await request(app)
      .post("/api/evaluation/legal")
      .send({
        stationId: "AMBOSS-24",
        transcript: `
          Je suis tenu au secret professionnel selon l'article 321 CP.
          La confidentialité est maintenue sauf en cas de danger imminent.
          Il faut distinguer le droit d'aviser du devoir d'aviser.
          Je peux établir un certificat médical descriptif des lésions à fin de preuve.
          Je peux vous orienter vers la LAVI, l'aide aux victimes.
          Je respecte votre autonomie, c'est votre choix.
        `,
      });
    expect(res.status).toBe(200);
    expect(res.body.stationId).toBe("AMBOSS-24");
    expect(res.body.category).toBe("secret_pro_levee");
    expect(res.body.expected_decision).toBe("refer");
    expect(res.body.mandatory_reporting).toBe(false);
    expect(res.body.lexiconVersion).toMatch(/^\d+\.\d+\.\d+$/);
    expect(res.body.axes).toHaveProperty("reconnaissance");
    expect(res.body.axes).toHaveProperty("verbalisation");
    expect(res.body.axes).toHaveProperty("decision");
    expect(res.body.axes).toHaveProperty("communication");
    // Au moins un axe avec must_verbalize a un score > 0.
    const positiveAxis = (
      ["reconnaissance", "verbalisation", "decision", "communication"] as const
    ).some((a) => res.body.axes[a].score_pct > 0);
    expect(positiveAxis).toBe(true);
    expect(res.body.unmapped).toEqual([]);
  });

  it("200 sur USMLE-34 — category=signalement_maltraitance, decision=report", async () => {
    const app = buildTestApp();
    const res = await request(app)
      .post("/api/evaluation/legal")
      .send({
        stationId: "USMLE-34",
        transcript:
          "J'ai un devoir d'aviser l'APEA, art. 364bis CP. Les enfants en danger priment sur le secret professionnel.",
      });
    expect(res.status).toBe(200);
    expect(res.body.category).toBe("signalement_maltraitance");
    expect(res.body.expected_decision).toBe("report");
    expect(res.body.mandatory_reporting).toBe(true);
  });

  it("200 sur RESCOS-72 — category=certificat_complaisance, decision=decline_certificate", async () => {
    const app = buildTestApp();
    const res = await request(app)
      .post("/api/evaluation/legal")
      .send({
        stationId: "RESCOS-72",
        transcript:
          "Je ne peux pas vous délivrer ce certificat — c'est un faux dans les titres (CP-318), CDM art. 34.",
      });
    expect(res.status).toBe(200);
    expect(res.body.category).toBe("certificat_complaisance");
    expect(res.body.expected_decision).toBe("decline_certificate");
    expect(res.body.mandatory_reporting).toBe(false);
  });

  it("400 si stationId inconnu", async () => {
    const app = buildTestApp();
    const res = await request(app)
      .post("/api/evaluation/legal")
      .send({ stationId: "DOES-NOT-EXIST", transcript: "" });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("bad_request");
  });

  it("400 si station sans legalContext (RESCOS-1)", async () => {
    const app = buildTestApp();
    const res = await request(app)
      .post("/api/evaluation/legal")
      .send({ stationId: "RESCOS-1", transcript: "" });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("bad_request");
    expect(res.body.error).toMatch(/legalContext/i);
  });

  it("400 si body sans stationId", async () => {
    const app = buildTestApp();
    const res = await request(app)
      .post("/api/evaluation/legal")
      .send({ transcript: "" });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("bad_request");
  });

  it("400 si transcript absent", async () => {
    const app = buildTestApp();
    const res = await request(app)
      .post("/api/evaluation/legal")
      .send({ stationId: "AMBOSS-24" });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("bad_request");
  });

  it("transcript vide accepté → score 0 + missing non-vide", async () => {
    const app = buildTestApp();
    const res = await request(app)
      .post("/api/evaluation/legal")
      .send({ stationId: "AMBOSS-24", transcript: "" });
    expect(res.status).toBe(200);
    expect(res.body.missing.length).toBeGreaterThan(0);
  });
});
