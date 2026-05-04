// Phase 11 J4 — tests d'intégration légers cross-référencés sur le
// round-trip pédagogique post-migration. Assure trois invariants :
//   1. AMBOSS-1 : station migrée riche → /pedagogy expose 5 images
//      avec slugs canoniques (premier slug = amboss-1-img1-murphy-s-sign.jpg)
//   2. RESCOS-72 : station SANS source pédagogique → /pedagogy renvoie
//      pedagogicalContent: null (fallback gracieux côté client A26)
//   3. Invariant I13 cross-référencé : /brief de AMBOSS-1 ne contient
//      JAMAIS le mot `pedagogicalContent` (META_FIELDS_TO_STRIP étendu
//      Phase 11 J2 protège l'isolement LLM patient)

import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { initCatalog } from "../services/stationsService";
import { buildTestApp } from "./helpers";

beforeAll(async () => {
  await initCatalog();
});

describe("Phase 11 J4 — round-trip /pedagogy + invariants cross-référencés", () => {
  it("AMBOSS-1 : 5 images migrées, premier slug canonique", async () => {
    const app = buildTestApp();
    const res = await request(app).get("/api/patient/AMBOSS-1/pedagogy");
    expect(res.status).toBe(200);
    expect(res.body.stationId).toBe("AMBOSS-1");
    const images = res.body.pedagogicalContent?.images;
    expect(Array.isArray(images)).toBe(true);
    expect(images.length).toBe(5);
    expect(images[0].data).toBe("/pedagogical-images/amboss-1-img1-murphy-s-sign.jpg");
  });

  it("RESCOS-72 : station sans source → pedagogicalContent: null", async () => {
    const app = buildTestApp();
    const res = await request(app).get("/api/patient/RESCOS-72/pedagogy");
    expect(res.status).toBe(200);
    expect(res.body.stationId).toBe("RESCOS-72");
    expect(res.body.pedagogicalContent).toBeNull();
  });

  it("invariant I13 : /brief AMBOSS-1 ne fuite jamais pedagogicalContent (même station riche)", async () => {
    const app = buildTestApp();
    const res = await request(app).get("/api/patient/AMBOSS-1/brief");
    expect(res.status).toBe(200);
    const json = JSON.stringify(res.body);
    expect(json).not.toContain("pedagogicalContent");
    // Cross-check : la même station EXPOSE bien ces données via /pedagogy.
    const ped = await request(app).get("/api/patient/AMBOSS-1/pedagogy");
    expect(ped.status).toBe(200);
    expect(ped.body.pedagogicalContent).not.toBeNull();
  });
});
