// Phase 6 J2 — audit du flag medicoLegalReviewed sur le catalogue.
// Phase 7 J3 — couverture étendue à 287/287 (USMLE-9 désormais annotée
// avec legalContext violence_sexuelle_adulte + medicoLegalReviewed=true).
//
// Vérifie côté SERVEUR (vraies fixtures, pas de mock) :
//   • 287 / 287 stations portent medicoLegalReviewed=true (couverture
//     complète post-J3 ; héritage Phase 6 J2 = 286/287).
//   • USMLE-9 porte un legalContext (violence_sexuelle_adulte) ET
//     medicoLegalReviewed=true depuis J3.
//   • Aucune station ne fuite medicoLegalReviewed dans /api/patient/:id/brief
//     (META_FIELDS_TO_STRIP étendu en J2 + allow-list explicite du brief).
//   • Le flag est correctement parsé par le schéma Zod (default false
//     quand absent, true quand présent).
//
// Contraintes : ZÉRO appel LLM, ZÉRO mock fs. On consomme les vraies
// fixtures du repo (post-J3 appliqué).

import { promises as fs } from "fs";
import path from "path";
import request from "supertest";
import { beforeAll, describe, expect, it } from "vitest";
import { initCatalog } from "../services/stationsService";
import { getPatientBrief } from "../services/patientService";
import { stationSchema } from "@shared/station-schema";
import { buildTestApp } from "./helpers";

const PATIENT_DIR = path.resolve(__dirname, "..", "data", "patient");

interface AuditRow {
  shortId: string;
  hasFlag: boolean;
  flagValue: unknown;
  hasLegalContext: boolean;
}

async function auditAllFixtures(): Promise<AuditRow[]> {
  const out: AuditRow[] = [];
  const seen = new Set<string>();
  const files = (await fs.readdir(PATIENT_DIR))
    .filter((f) => f.startsWith("Patient_") && f.endsWith(".json"))
    .sort();
  for (const f of files) {
    const txt = await fs.readFile(path.join(PATIENT_DIR, f), "utf-8");
    const parsed = JSON.parse(txt) as { stations: Array<Record<string, unknown>> };
    for (const s of parsed.stations) {
      const fullId = s.id as string;
      const shortId = fullId.split(" - ")[0];
      if (seen.has(shortId)) continue;
      seen.add(shortId);
      out.push({
        shortId,
        hasFlag: "medicoLegalReviewed" in s,
        flagValue: s.medicoLegalReviewed,
        hasLegalContext: "legalContext" in s,
      });
    }
  }
  return out;
}

beforeAll(async () => {
  await initCatalog();
});

describe("Phase 6 J2 / Phase 7 J3 — couverture medicoLegalReviewed sur le catalogue", () => {
  it("287 stations sur 287 portent medicoLegalReviewed=true (couverture complète post-J3)", async () => {
    const rows = await auditAllFixtures();
    expect(rows.length).toBe(287);
    const flagged = rows.filter((r) => r.flagValue === true);
    expect(flagged.length).toBe(287);
  });

  it("USMLE-9 (annotée Phase 7 J3) porte legalContext ET medicoLegalReviewed=true", async () => {
    const rows = await auditAllFixtures();
    const u9 = rows.find((r) => r.shortId === "USMLE-9");
    expect(u9).toBeDefined();
    expect(u9!.hasFlag).toBe(true);
    expect(u9!.flagValue).toBe(true);
    expect(u9!.hasLegalContext).toBe(true);
  });

  it("toute station avec legalContext porte aussi medicoLegalReviewed=true", async () => {
    const rows = await auditAllFixtures();
    const annotated = rows.filter((r) => r.hasLegalContext);
    // 3 pilotes Phase 5 + USMLE Triage 39 (Phase 6) + USMLE-9 (Phase 7 J3) = 5
    expect(annotated.length).toBe(5);
    for (const r of annotated) {
      expect(r.flagValue, `${r.shortId} avec legalContext doit avoir flag=true`).toBe(true);
    }
  });

  it("aucune station ne porte medicoLegalReviewed=false (jamais explicite)", async () => {
    // J2 ne pose JAMAIS le flag à false : soit présent à true, soit
    // absent (= default false du schéma Zod). Cette propriété signale
    // une régression silencieuse si une fixture est éditée avec false.
    const rows = await auditAllFixtures();
    for (const r of rows) {
      if (r.hasFlag) {
        expect(r.flagValue, `${r.shortId} : flag explicit doit être true`).toBe(true);
      }
    }
  });
});

describe("Phase 6 J2 — schéma Zod : default false respecté", () => {
  it("station sans medicoLegalReviewed → parsé avec default false", () => {
    const result = stationSchema.parse({
      id: "TEST-NOLEGAL",
    });
    expect(result.medicoLegalReviewed).toBe(false);
  });

  it("station avec medicoLegalReviewed=true → parsé tel quel", () => {
    const result = stationSchema.parse({
      id: "TEST-FLAGGED",
      medicoLegalReviewed: true,
    });
    expect(result.medicoLegalReviewed).toBe(true);
  });

  it("medicoLegalReviewed=« string » → rejeté par Zod", () => {
    expect(() =>
      stationSchema.parse({
        id: "TEST-BAD",
        medicoLegalReviewed: "yes",
      }),
    ).toThrow();
  });
});

describe("Phase 6 J2 — strip HTTP : medicoLegalReviewed jamais dans /api/patient/:id/brief", () => {
  // 4 stations annotées + 5 témoins (cf. brief J2 récap §10).
  const TARGETS = [
    "AMBOSS-24",
    "USMLE-34",
    "RESCOS-72",
    "USMLE Triage 39",
    "AMBOSS-1",
    "RESCOS-1",
    "RESCOS-7",
    "USMLE-1",
    "German-1",
  ];

  it.each(TARGETS)(
    "%s : getPatientBrief() ne contient PAS medicoLegalReviewed",
    async (id) => {
      const brief = await getPatientBrief(id);
      const json = JSON.stringify(brief);
      expect(json, `${id} : leak medicoLegalReviewed`).not.toContain("medicoLegalReviewed");
    },
  );

  it.each(TARGETS)(
    "%s : GET /api/patient/:id/brief HTTP ne contient PAS medicoLegalReviewed",
    async (id) => {
      const app = buildTestApp();
      const res = await request(app).get(`/api/patient/${id}/brief`);
      expect(res.status).toBe(200);
      const json = JSON.stringify(res.body);
      expect(json, `${id} : leak medicoLegalReviewed dans la réponse HTTP`).not.toContain(
        "medicoLegalReviewed",
      );
    },
  );
});

describe("Phase 6 J2 — strip LLM : medicoLegalReviewed jamais dans le system prompt", () => {
  it.each(["USMLE Triage 39", "AMBOSS-24", "RESCOS-72", "AMBOSS-1"])(
    "%s : buildSystemPrompt n'expose PAS medicoLegalReviewed",
    async (id) => {
      const { buildSystemPrompt } = await import("../services/patientService");
      const prompt = await buildSystemPrompt(id, "text");
      expect(prompt, `${id} : leak medicoLegalReviewed dans le prompt LLM`).not.toContain(
        "medicoLegalReviewed",
      );
    },
  );
});
