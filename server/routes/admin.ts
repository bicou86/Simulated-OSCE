// Routes admin — observabilité agrégée du logger JSONL.
//   GET /api/admin/stats?days=7   (header X-Admin-Key requis)

import { Router, type Request, type Response } from "express";
import { z } from "zod";

import { getAdminKey } from "../lib/config";
import { sendApiError } from "../lib/errors";
import { estimateCost, readLog, type LogEntry } from "../lib/logger";

const router = Router();

function requireAdmin(req: Request, res: Response): boolean {
  const expected = getAdminKey();
  const provided = req.header("x-admin-key");
  if (!expected) {
    sendApiError(res, "not_configured", "ADMIN_KEY non initialisée côté serveur.");
    return false;
  }
  if (!provided || provided !== expected) {
    sendApiError(res, "unauthorized", "X-Admin-Key manquant ou invalide.");
    return false;
  }
  return true;
}

const Query = z.object({
  days: z.coerce.number().int().min(1).max(90).default(7),
});

interface Bucket {
  calls: number;
  tokensIn: number;
  tokensOut: number;
  cachedTokens: number;
  costUsd: number;
}

function emptyBucket(): Bucket {
  return { calls: 0, tokensIn: 0, tokensOut: 0, cachedTokens: 0, costUsd: 0 };
}

function addTo(b: Bucket, e: LogEntry) {
  b.calls += 1;
  b.tokensIn += e.tokensIn ?? 0;
  b.tokensOut += e.tokensOut ?? 0;
  b.cachedTokens += e.cachedTokens ?? 0;
  // Recalcule le coût si absent de la ligne (cas log antérieur à l'estimation).
  b.costUsd += e.costUsd ?? estimateCost(e);
}

router.get("/stats", async (req: Request, res: Response) => {
  if (!requireAdmin(req, res)) return;

  const parsedQ = Query.safeParse(req.query);
  if (!parsedQ.success) {
    return sendApiError(res, "bad_request", "Paramètre ?days invalide.", parsedQ.error.issues[0]?.message);
  }
  const days = parsedQ.data.days;

  let entries: LogEntry[];
  try {
    entries = await readLog();
  } catch (err) {
    return sendApiError(res, "internal_error", (err as Error).message);
  }

  const now = Date.now();
  const fromTs = now - days * 24 * 60 * 60 * 1000;
  const inRange = entries.filter((e) => {
    const t = Date.parse(e.ts);
    return Number.isFinite(t) && t >= fromTs;
  });

  const totals = emptyBucket();
  const byDay = new Map<string, Bucket>();
  const byRoute = new Map<string, Bucket>();
  const byModel = new Map<string, Bucket>();

  for (const e of inRange) {
    addTo(totals, e);
    const day = e.ts.slice(0, 10); // YYYY-MM-DD
    if (!byDay.has(day)) byDay.set(day, emptyBucket());
    addTo(byDay.get(day)!, e);
    if (!byRoute.has(e.route)) byRoute.set(e.route, emptyBucket());
    addTo(byRoute.get(e.route)!, e);
    if (!byModel.has(e.model)) byModel.set(e.model, emptyBucket());
    addTo(byModel.get(e.model)!, e);
  }

  const serialize = (m: Map<string, Bucket>, keyName: string) =>
    Array.from(m.entries())
      .map(([k, v]) => ({ [keyName]: k, ...v } as Record<string, string | number>))
      .sort((a, b) => String(a[keyName]).localeCompare(String(b[keyName])));

  return res.json({
    period: {
      from: new Date(fromTs).toISOString(),
      to: new Date(now).toISOString(),
      days,
    },
    totals,
    byDay: serialize(byDay, "day"),
    byRoute: serialize(byRoute, "route"),
    byModel: serialize(byModel, "model"),
  });
});

export default router;
