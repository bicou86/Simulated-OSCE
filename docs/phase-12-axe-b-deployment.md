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

## B-J2 — Bundle serveur ESM (fix runtime production)

Phase 12 Axe B J1 a basculé `[deployment]` vers `autoscale`, mais le bundle
production (`npm run start` = `node dist/index.cjs`) crashait au boot. La
publication Replit était impossible tant que ce bug n'était pas corrigé.

### Bug initial : `import.meta.dirname` undefined en CJS

`script/build.ts` produisait un bundle au format `cjs` (extension `.cjs`).
Trois fichiers serveur reposaient sur `import.meta.dirname` :

- [server/services/stationsService.ts:36-37](../server/services/stationsService.ts#L36-L37)
  (`PATIENT_DIR`, `EVALUATOR_DIR`)
- [server/lib/prompts.ts:7](../server/lib/prompts.ts#L7) (`PROMPTS_DIR`)

esbuild émettait 3 warnings « `import.meta` is not available with the cjs
output format and will be empty ». **En réalité ces warnings étaient des
crash runtime** : `path.resolve(undefined, …)` lève
`TypeError [ERR_INVALID_ARG_TYPE]: The "paths[0]" argument must be of type
string. Received undefined`. L'app ne démarrait jamais en production.

**Décision (Q-P12-B-16 = α)** : passer le bundle serveur de CJS vers ESM
pour conserver `import.meta` natif. Modifications [script/build.ts](../script/build.ts) :

- `format: "cjs"` → `format: "esm"`
- `outfile: "dist/index.cjs"` → `outfile: "dist/index.js"` (extension `.js`
  héritant automatiquement de `"type": "module"` déjà présent dans
  `package.json`)
- ajout `target: "node20"` (cohérent avec `nodejs-20` dans `[modules]`)
- ajout banner `createRequire` :
  ```js
  banner: { js: 'import { createRequire as __createRequire } from "node:module"; const require = __createRequire(import.meta.url);' }
  ```
  Restitue `require()` au runtime pour les deps CJS bundlées qui en
  appellent dynamiquement (express 5 + path-to-regexp, multer, pg, etc.).

[package.json](../package.json) : `scripts.start` →
`NODE_ENV=production node dist/index.js`.

### Bug latent découvert post-fix CJS→ESM

Le passage à ESM a éliminé les 3 warnings esbuild — mais a révélé un
**second bug latent** masqué jusque-là par le premier crash. Les paths
construits avec `path.resolve(import.meta.dirname, "..", "data", "patient")`
résolvaient correctement en dev/test (depuis `server/services/`), mais
**en bundle ESM `import.meta.dirname` du bundle pointe vers `dist/`** —
donc `path.resolve("/root/dist/", "..", "data", "patient")` devient
`/root/data/patient` au lieu du vrai `/root/server/data/patient`. Crash
`ENOENT` au premier `readdir` dans `initCatalog()`.

Site additionnel touché : [server/static.ts:6](../server/static.ts#L6),
qui utilisait `__dirname` (inexistant en ESM). Corrigé en
`import.meta.dirname` (résout en `dist/public` — c'est exactement ce qu'on
veut pour la sortie Vite).

### Décision (Q-P12-B-17 = D') : `process.cwd()` + garde boot fail-fast

Plutôt que de copier les ressources `server/data/` et `server/prompts/`
dans `dist/` au build (option A) ou de bricoler un helper context-aware
(option F), on ancre les paths data/prompts sur `process.cwd()`. Cette
hypothèse est valide dans **tous** nos contextes d'exécution :

- Replit Autoscale `npm start` ⇒ cwd = project root
- `npm run dev` (tsx) ⇒ cwd = project root
- `vitest run` ⇒ cwd = project root

Modifications source :

- [server/services/stationsService.ts](../server/services/stationsService.ts)
  introduit une constante locale `SERVER_ROOT = path.resolve(process.cwd(), "server")`
  et redéfinit `PATIENT_DIR` / `EVALUATOR_DIR` à partir d'elle.
- [server/lib/prompts.ts](../server/lib/prompts.ts) :
  `PROMPTS_DIR = path.resolve(process.cwd(), "server", "prompts")`.
- [server/static.ts](../server/static.ts) : conserve `import.meta.dirname`
  (le path attendu est `dist/public`, qui résout correctement par
  cohabitation avec le bundle).

**Garde boot fail-fast** ajoutée au début de
[server/index.ts](../server/index.ts) :

```ts
const expectedServerDir = path.resolve(process.cwd(), "server");
if (!fs.existsSync(expectedServerDir)) {
  console.error(
    `[boot] Erreur fatale : process.cwd() = ${process.cwd()} `
      + `ne contient pas de répertoire 'server/'. `
      + `L'application doit être démarrée depuis la racine du projet.`,
  );
  process.exit(1);
}
```

Convertit l'hypothèse silencieuse « cwd = project root » en crash
diagnosticable au boot (au lieu d'un `ENOENT` cryptique plus loin dans
la pile d'appels).

### Test manuel de la garde fail-fast

À reproduire si quelqu'un suspecte une régression (post-build) :

```bash
cd /tmp
NODE_ENV=production node /home/runner/workspace/dist/index.js
# → "[boot] Erreur fatale : process.cwd() = /tmp …"
# → exit code 1
```

### Validations B-J2 acquises au commit

- `npm run build` : **0 warning import.meta** (vérifié) — les 3 warnings
  esbuild historiques sont éliminés.
- Validations grep sur `dist/index.js` :
  - `import.meta` : **2** (banner createRequire + `static.ts` pour
    `dist/public`)
  - `createRequire` : **1** (banner injecté)
  - `setupVite | @vitejs/plugin | vite/dist` : **0** (dead-code-elimination
    confirmée pour `server/vite.ts` en NODE_ENV=production)
- Validations runtime : `curl -sI /` → 200 + `Content-Type text/html`,
  `curl -s /api/stations` → 200, **288 stations indexées** (catalog
  total ; le 282 = checksum-lock count, indépendant).
- Garde fail-fast : exit 1 immédiat depuis `/tmp` avec message clair.
- `npm test` : 1575 passed / 12 skipped (baseline inchangée).
- `npm run check` : 8 erreurs préexistantes (target ES5/iterators), aucune
  nouvelle erreur introduite par les modifs B-J2.

## B-J3 — Mise à jour happy-dom + retrait @anthropic-ai/claude-code de dependencies

### Contexte

Publication Replit Autoscale bloquée par le scan sécurité avec le verdict
`Deployment blocked: found 1 critical vulnerabilities`. Diagnostic local
confirmé via le scan Replit (`.cache/replit/security-scan/dependencyAudit.json`)
et `npm audit`.

### Vulnérabilités traitées

**`happy-dom` 15.11.7 → 20.9.0** (devDependency, env Vitest pour `client/**`) :

| Sévérité | ID GHSA | Titre | Fix |
| --- | --- | --- | --- |
| **Critical** | GHSA-37j7-fg3j-429f | VM Context Escape → Remote Code Execution | ≥ 20.0.0 |
| High | GHSA-6q6h-j7hj-3r64 | ECMAScriptModuleCompiler interpole code exécutable | ≥ 20.8.8 |
| High | GHSA-w4gp-fjgq-3q4g | `fetch credentials` utilise cookies page-origin au lieu de target-origin | ≥ 20.8.9 |

Le saut majeur 15 → 20 (cinq versions) est **forcé** par le fix de la
Critical (`requiresMajorUpdate: true` dans le scan). Choix de la latest
20.9.0 pour couvrir les trois CVE en un seul bump. Engines `node >=20.0.0`,
compatible avec le module `nodejs-20` du `.replit`.

**`@anthropic-ai/claude-code` 2.1.72** (anomalie : déclaré en
`dependencies` au lieu de devDependencies, probable `npm install` accidentel) :

| Sévérité | ID GHSA | Titre |
| --- | --- | --- |
| High | GHSA-q5hj-mxqh-vv77 | Trust Dialog Bypass via Git Worktree Spoofing → arbitrary code execution |
| High | GHSA-5cwg-9f6j-9jvx | Insecure System-Wide Configuration Loading (Windows priv-esc) |

Vérification d'usage avant retrait :

```bash
grep -rn "@anthropic-ai/claude-code" --include="*.ts" --include="*.tsx" \
  --include="*.js" --include="*.mjs" --include="*.cjs" \
  --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=.git \
  --exclude-dir=.cache --exclude-dir=.config .
# → 0 fichier consommateur (présent uniquement dans package.json + lock)
```

Désinstallation propre (`npm uninstall @anthropic-ai/claude-code`),
**pas de réinstall en devDep** : aucune ligne du projet n'importe ce
module — c'est un CLI Replit-side, pas un module npm consommé par le
runtime ni les tests.

### Commandes appliquées

```bash
npm install --save-dev happy-dom@20.9.0
npm uninstall @anthropic-ai/claude-code
```

### Diff package.json

- `dependencies."@anthropic-ai/claude-code"` supprimé.
- `devDependencies."happy-dom"` : `^15.11.7` → `^20.9.0`.
- Aucune autre dep modifiée.

Diff `package-lock.json` : 21 ins + 21 del pour la bascule happy-dom
(transitive deps quasi-inchangées) + 21 ins + 349 del pour le retrait
de la sous-arborescence claude-code.

### Validations B-J3 acquises au commit

- `npm test` : **1575 passed / 12 skipped** (baseline strictement
  inchangée). Le saut majeur happy-dom 15 → 20 ne casse aucun des
  9 tests `client/src/**.test.{ts,tsx}` qui s'exécutent dans cet env.
- `npm run build` : succès, `dist/index.js` 1.3 MB + `dist/public/`
  générés. `grep "happy-dom"` et `grep "@anthropic-ai/claude-code"` dans
  `dist/index.js` : **0 occurrence** chacun (devDeps non bundlées).
- `npm run start` (court) : `[stationsService] 288 stations indexées
  depuis 14 fichiers.` + `[express] serving on port 5000`. Garde
  fail-fast non déclenchée.
- `npm run check` : 8 erreurs préexistantes (target ES5/iterators),
  aucune nouvelle.
- `npm audit --omit=dev` : **0 Critical** (cible blocking déploiement
  Autoscale levée). 7 High résiduelles côté prod (voir dette technique
  ci-dessous).
- `npm audit | grep -i critical` : **0 ligne**.

### Dette technique acceptée (hors scope B-J3)

CVE résiduelles signalées par `npm audit --omit=dev` post-B-J3, **toutes
de sévérité ≤ High**, donc non bloquantes pour le déploiement Autoscale
(qui ne bloque que sur Critical) :

- `fast-xml-parser` (high) — via `@aws-sdk/xml-builder`. Fix possible via
  `npm audit fix` simple.
- `lodash` + `lodash-es` (high) — Prototype Pollution / Code Injection.
  Fix possible via `npm audit fix`.
- `node-forge` (high) — basicConstraints bypass + Ed25519 forgery.
- `path-to-regexp` (high) — ReDoS via wildcards / sequential optional
  groups.
- `qs` (high) — DoS via `arrayLimit` bypass.
- `tmp` (low → high suivant chemin).
- `elliptic` (high, devDep) + `esbuild` (moderate, devDep) — fixes
  nécessitent `--force` et breakings (`vite-plugin-node-polyfills@0.2.0`,
  `vitest@4.1.5`). Reportés.

À traiter dans un Axe B-J4 ultérieur si le seuil de criticité du scan
Replit évolue, ou si l'audit interne le requiert. Aucun n'est exploitable
dans le contexte d'un déploiement Autoscale fermé par mot de passe (pas
de surface d'attaque non authentifiée).
