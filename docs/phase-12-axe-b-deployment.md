# Phase 12 Axe B — Déploiement Replit (modèle Restricted with password)

## Modèle d'auth retenu

**Restricted with password** (Replit native). Aucun code applicatif d'auth.
Tous les utilisateurs partagent un mot de passe géré dans le panneau Publish
de Replit. Cible utilisateurs Phase 12 (Q-P12-B-15 = α) : équipe interne +
quelques bêta-testeurs invités, pas d'inscription publique.

## Cible de déploiement

- `deploymentTarget = "autoscale"` ([.replit:77-80](../.replit#L77-L80)) —
  conteneur on-demand avec scale-to-zero, l'auth proxy Replit s'applique
  aux routes Express.
- Domaine prévu : `ecos-sim.replit.app`
- Mode d'accès : **Restricted with password** (Publish UI Replit).
- `trust proxy = 1` configuré dans [server/index.ts](../server/index.ts) —
  derrière le proxy Replit, `req.ip` et `req.protocol` reflètent le client
  réel et non le proxy interne.

## Routes sensibles

- **`POST /api/settings`** : désactivé en production (HTTP 403). Cf.
  [server/routes/settings.ts](../server/routes/settings.ts) — garde au
  début du handler. Raisons :
  1. Le filesystem est volatile en autoscale (la persistance `.env.local`
     serait perdue à chaque scale).
  2. Un utilisateur authentifié par mot de passe partagé ne doit pas
     pouvoir écraser les clés API du déploiement.
  ⇒ Les clés se gèrent via les **Replit Secrets** (Tools → Secrets).
- **`GET /api/admin/stats`** : continue d'exiger le header `X-Admin-Key`
  (defense-in-depth ; Q-P12-B-4 = a). Le mur Replit reste la première
  barrière, le `X-Admin-Key` la seconde.
- **`GET /api/debug/evaluation-weights`** : 404 forcé en
  `NODE_ENV=production` (cf. [server/routes/debug.ts](../server/routes/debug.ts)).
- Toutes les autres routes `/api/*` sont protégées **par le mur Replit
  uniquement** (mot de passe partagé) — aucune protection applicative
  additionnelle (Q-P12-B-14 = 5).

## Variables d'environnement requises (Replit Secrets)

| Secret | Rôle | Défaut |
|---|---|---|
| `OPENAI_API_KEY` | Clé OpenAI (chat, STT Whisper, TTS) | obligatoire |
| `ANTHROPIC_API_KEY` | Clé Anthropic (évaluateur Claude Sonnet/Opus) | obligatoire |
| `ADMIN_KEY` | Garde `X-Admin-Key` sur `/api/admin/stats` | optionnelle (auto-générée 24 bytes hex au boot si absente, cf. [server/lib/config.ts](../server/lib/config.ts)) |
| `NODE_ENV` | Posé à `production` par `npm run start` | géré par le script |
| `PORT` | Port d'écoute Express | géré par Replit Deployments (5000 par défaut) |

## Procédure de publication

1. Vérifier que les Replit Secrets contiennent bien `OPENAI_API_KEY`,
   `ANTHROPIC_API_KEY`, `ADMIN_KEY` (à reporter manuellement depuis
   `.env.local` le cas échéant — `.env.local` n'est PAS lu en production
   sur autoscale).
2. Onglet **Publish** → **Restricted with password** → mot de passe
   ≥ 12 caractères.
3. Cliquer **Publish**.
4. Tester l'URL `ecos-sim.replit.app` : le mur de mot de passe doit
   apparaître ; après saisie, l'app doit fonctionner normalement.

## Procédure de rotation du mot de passe

Onglet **Publish** → modifier le password → **Republish**. Les sessions
en cours expirent côté proxy Replit ; aucune action côté app nécessaire
(stateless, Q-P12-B-3 = a).

## Suppressions hygièniques associées (Phase 12 Axe B J1)

- Dépendances dormantes désinstallées : `express-session`, `passport`,
  `passport-local` (+ leurs `@types/*`). Étaient présentes dans
  `package.json` mais zéro consommateur.
- Schéma `users` (Drizzle PostgreSQL) supprimé :
  `shared/schema.ts`, `server/storage.ts`, `drizzle.config.ts` —
  `MemStorage` n'avait aucun consommateur, aucun appel à `db:push`
  jamais effectué.
- Dépendances Drizzle désinstallées : `drizzle-kit`, `drizzle-orm`,
  `drizzle-zod`. Script `db:push` retiré de `package.json`.
- Allowlist de bundling [script/build.ts](../script/build.ts) nettoyée
  des entrées correspondantes (cohérence avec le repo réel).
- Le module Replit `postgresql-16` reste déclaré dans `[modules]` de
  `.replit` (zéro coût, anticipation persistance future éventuelle).
