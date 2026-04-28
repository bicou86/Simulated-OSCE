# OSCE Sim

Simulateur de stations OSCE pour étudiants en médecine. Conversation orale avec un patient joué par GPT-4o-mini (voix OpenAI TTS, reconnaissance Whisper), rapport d'évaluation structuré généré par Claude Sonnet 4.5.

## Prérequis

- **Node.js ≥ 20**
- Une clé API **OpenAI** (plan payant pour activer Whisper + TTS)
- Une clé API **Anthropic** (plan avec accès à `claude-sonnet-4-5`)
- Un navigateur récent avec accès micro (Chrome, Firefox, Safari 14+)

## Installation

```bash
npm install
cp .env.example .env.local
# éditer .env.local et renseigner OPENAI_API_KEY et ANTHROPIC_API_KEY
```

Les clés peuvent aussi être saisies après-coup dans l'écran **Paramètres** de l'app — avec ou sans persistance dans `.env.local`.

## Lancer en dev

```bash
npm run dev
```

L'application est servie sur [http://localhost:5000](http://localhost:5000). Un seul serveur Express gère à la fois l'API (`/api/*`) et le client (HMR Vite intégré).

## Scripts

| Script | Description |
|---|---|
| `npm run dev` | Serveur complet (Express + Vite HMR) sur le port 5000 |
| `npm run dev:watch` | Idem `dev` mais avec `tsx watch` — relance auto à chaque modif d'un fichier `server/**` |
| `npm run build` | Build du client (Vite) + du serveur (esbuild bundle) dans `dist/` |
| `npm run start` | Lance le build de production (nécessite `npm run build` d'abord) |
| `npm run check` | Vérification TypeScript (aucun emit) |
| `npm run test` | Suite vitest (client + serveur, SDK mockés) |
| `npm run test:watch` | Mode watch vitest |

> ⚠️ **Restart manuel obligatoire avec `npm run dev`.** Le HMR Vite ne couvre QUE les
> fichiers du client (`client/src/**`). Toute modification côté serveur
> (`server/**`, `shared/**`) — par exemple ajout d'un router, d'une route, ou
> d'un service — exige de tuer le process tsx et de relancer `npm run dev`,
> sinon le bundle servi est l'ancien (route 404 surprise garantie).
> Pour automatiser, lance plutôt `npm run dev:watch`.

## Triage médico-légal Phase 6

Outil offline déterministe (zéro LLM) qui classe les 287 stations en 3
statuts (A/B/C) restreints aux 3 catégories Phase 5
(`secret_pro_levee`, `signalement_maltraitance`,
`certificat_complaisance`). Sortie : un CSV destiné à une relecture
pédagogique humaine par un médecin CH avant l'annotation effective des
fixtures.

```bash
npx tsx scripts/triage-medico-legal.ts
```

Génère `triage-output/phase-6-j1.csv` + résumé stdout (counts par
statut, par catégorie, par source, top 10 ambiguïtés). Le run de
référence J1 est commité ; les runs ultérieurs sont locaux (cf.
`.gitignore`). Voir [`triage-output/README.md`](triage-output/README.md)
pour le format CSV et le workflow de relecture.

## Architecture

> Phase 3 (images, labs, spécialités) est documentée séparément :
> [docs/architecture/phase-3.md](docs/architecture/phase-3.md).

```
server/
  index.ts              # Bootstrap Express + HMR Vite
  routes.ts             # Monte les routeurs /api/*
  routes/
    settings.ts         # POST /api/settings, GET /api/settings/status
    patient.ts          # POST /api/patient/{chat, chat/stream, stt, tts}
    evaluator.ts        # POST /api/evaluator/evaluate
    admin.ts            # GET  /api/admin/stats (X-Admin-Key requis)
    stations.ts         # GET  /api/stations, /api/stations/:id
  services/
    stationsService.ts  # Catalogue 285 stations en mémoire au boot
    patientService.ts   # Isolation patient + runPatientChat + streamPatientChat
    evaluatorService.ts # Isolation évaluateur + cache Anthropic ephemeral
  lib/
    config.ts           # Clés API + ADMIN_KEY (auto-générée) + .env.local
    errors.ts           # Enveloppe d'erreurs { error, code, hint }
    logger.ts           # JSONL request logger + estimation coût USD
    prompts.ts          # Loader markdown avec substitution {{variable}}
    textSanitize.ts     # Retire emojis avant TTS
  prompts/
    patient.md          # Rôle-play patient francophone
    evaluator.md        # Grille OSCE pondérée + contrat JSON
  logs/                 # (non versionné) requests.jsonl — 1 ligne par appel LLM

client/src/
  pages/                # Library, Simulation, Evaluation, Settings
  components/           # shadcn/ui + AppLayout (bannière clés manquantes)
  hooks/
    useMediaRecorder.ts # Push-to-talk (webm + fallback mp4 Safari)
    useKeyStatus.ts     # Ping /api/settings/status
    useStreamingChat.ts # SSE fetch + TTS chunké (file audio séquentielle)
  lib/
    api.ts              # Client typé (ApiError normalisé)
    preferences.ts      # Voix TTS préférée (localStorage)
```

## Gestion des clés API

- Les clés ne sont **jamais** exposées au client. Seuls `/api/settings/status` renvoie des booléens `openai_ok` / `anthropic_ok`.
- Par défaut, une clé soumise via l'écran Paramètres reste **en mémoire** le temps de la session serveur.
- Si la case *"Persister dans `.env.local`"* est cochée, la clé est écrite dans `.env.local` (permissions `0600`, `.env.local` est listé dans `.gitignore`).
- Au démarrage, le serveur lit d'abord `process.env`, puis `.env.local` en complément.

## Flux d'une simulation

1. **Bibliothèque** → choix d'une station (scénario + signes vitaux + contexte caché).
2. **Simulation** → bouton *Démarrer* lance le timer de 13 min et lit la phrase d'ouverture via TTS.
3. Push-to-talk : clic sur le micro pour enregistrer, clic à nouveau pour envoyer. Audio → Whisper → message "étudiant" → Chat streamé → message "patient" streamé + TTS progressif.
4. Alternative clavier : champ texte en bas de l'interface.
5. Bouton *Évaluer* à la fin → navigation vers la page Évaluation.
6. **Évaluation** → le transcript est envoyé à Claude Sonnet 4.5 via `/api/evaluator/evaluate`, qui renvoie un rapport JSON strict (scores pondérés, points forts, omissions critiques, priorités, verdict).

## Streaming SSE + TTS chunké

Pour réduire la latence perçue au premier mot du patient, `POST /api/patient/chat/stream` émet des events SSE :

| Event | Payload | Déclenchement |
|---|---|---|
| `delta` | `{ text }` | À chaque token reçu d'OpenAI |
| `sentence` | `{ text, index }` | Phrase complète détectée (ponctuation terminale, min 12 chars) |
| `done` | `{ fullText }` | Fin du stream |
| `error` | `{ code, message, hint? }` | Échec upstream (la connexion SSE se ferme juste après) |

Côté client, `useStreamingChat` lance le TTS de chaque `sentence` en parallèle et enfile les clips audio dans un `HTMLAudioElement` séquentiel. Si le stream échoue, `Simulation` bascule automatiquement sur l'endpoint `POST /api/patient/chat` non-streaming.

## Observabilité — /api/admin/stats

Chaque appel LLM (chat sync + stream, STT, TTS, evaluator) écrit une ligne dans `server/logs/requests.jsonl` avec latence, tokens in/out, tokens cachés (Anthropic) et coût estimé en USD (tarifs au 2026-04-22).

```bash
# La clé est auto-générée au premier démarrage et affichée dans les logs :
#   [admin] ADMIN_KEY générée : <hex>

curl -s -H "X-Admin-Key: <votre-clé>" http://localhost:5000/api/admin/stats?days=7
```

Réponse : `{ period, totals, byDay[], byRoute[], byModel[] }` — coûts agrégés + compteurs par dimension.

## Compatibilité navigateurs

- **Chrome / Firefox** : `MediaRecorder` avec `audio/webm;codecs=opus`.
- **Safari** : bascule automatique sur `audio/mp4`. Whisper accepte les deux formats.
- **Autoplay TTS** : le premier clic sur *Démarrer* est considéré comme interaction utilisateur et autorise la lecture automatique du patient.

## Tests

```bash
npm run test
```

- `client/src/lib/api.test.ts` : client API côté navigateur (fetch mocké, 10 cas).
- `server/__tests__/*.test.ts` : routes supertest + SDK OpenAI/Anthropic mockés (32 cas) — incluant SSE stream, aggregation stats et auth admin.
- Environnement : `happy-dom` pour le client, `node` pour le serveur.

## Sécurité

- `.env`, `.env.local` et `.env.*.local` sont ignorés par git.
- `server/logs/` (JSONL d'observabilité) est également ignoré par git.
- Les clés persistées sur disque (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `ADMIN_KEY`) ont les droits `0600`.
- Aucune clé n'est loggée. Les erreurs upstream n'exposent que `status` + message générique.
- `ADMIN_KEY` n'est jamais exposée via les API publiques — elle est consultée uniquement en lecture par `/api/admin/*`.
- La limite d'upload Whisper est plafonnée à 25 Mo côté serveur (multer memory storage).
