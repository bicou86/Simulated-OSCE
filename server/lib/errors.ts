// Helper de normalisation des erreurs côté serveur.
// Retourne un JSON uniforme { error, code, hint } pour que le front sache quoi afficher.

import type { Response } from "express";

export type ApiErrorCode =
  | "unauthorized"        // 401 — clé absente / rejetée par le fournisseur
  | "rate_limited"        // 429
  | "upstream_error"      // 5xx côté OpenAI/Anthropic
  | "bad_request"         // 400 — entrée invalide
  | "not_configured"      // 412 — clé non renseignée côté serveur
  | "internal_error";     // 500 — inattendu

interface ApiErrorBody {
  error: string;
  code: ApiErrorCode;
  hint?: string;
}

const HTTP_BY_CODE: Record<ApiErrorCode, number> = {
  unauthorized: 401,
  rate_limited: 429,
  upstream_error: 502,
  bad_request: 400,
  not_configured: 412,
  internal_error: 500,
};

export function sendApiError(
  res: Response,
  code: ApiErrorCode,
  error: string,
  hint?: string,
): void {
  const body: ApiErrorBody = { error, code };
  if (hint) body.hint = hint;
  res.status(HTTP_BY_CODE[code]).json(body);
}

// Mappe une erreur SDK (OpenAI/Anthropic) vers notre enveloppe.
// Les deux SDK exposent `.status` sur leurs APIError ; on se base dessus en priorité.
export function mapUpstreamError(err: unknown): {
  code: ApiErrorCode;
  error: string;
  hint: string;
} {
  const anyErr = err as { status?: number; message?: string; name?: string };
  const status = typeof anyErr?.status === "number" ? anyErr.status : undefined;
  const message = anyErr?.message ?? "Erreur inconnue";

  if (status === 401 || status === 403) {
    return {
      code: "unauthorized",
      error: "Clé API rejetée par le fournisseur.",
      hint: "Vérifiez la clé dans Paramètres ou régénérez-la.",
    };
  }
  if (status === 429) {
    return {
      code: "rate_limited",
      error: "Limite de requêtes atteinte chez le fournisseur.",
      hint: "Patientez quelques secondes puis réessayez.",
    };
  }
  if (status && status >= 500) {
    return {
      code: "upstream_error",
      error: `Le fournisseur a répondu ${status}.`,
      hint: "Réessayez dans un instant ; si le problème persiste, vérifiez le statut du fournisseur.",
    };
  }
  if (status === 400) {
    return {
      code: "bad_request",
      error: message,
      hint: "Requête mal formée côté serveur.",
    };
  }

  return {
    code: "internal_error",
    error: message,
    hint: "Erreur inattendue côté serveur.",
  };
}

export function sendUpstreamError(res: Response, err: unknown): void {
  const mapped = mapUpstreamError(err);
  sendApiError(res, mapped.code, mapped.error, mapped.hint);
}
