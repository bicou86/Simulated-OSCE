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
| `npm run build` | Build du client (Vite) + du serveur (esbuild bundle) dans `dist/` |
| `npm run start` | Lance le build de production (nécessite `npm run build` d'abord) |
| `npm run check` | Vérification TypeScript (aucun emit) |
| `npm run test` | Suite vitest (client + serveur, SDK mockés) |
| `npm run test:watch` | Mode watch vitest |

## Architecture

```
server/
  index.ts              # Bootstrap Express + HMR Vite
  routes.ts             # Monte les routeurs /api/*
  routes/
    settings.ts         # POST /api/settings, GET /api/settings/status
    patient.ts          # POST /api/patient/{chat, stt, tts}
    evaluator.ts        # POST /api/evaluator/evaluate
  lib/
    config.ts           # Clés API en mémoire + .env.local optionnel
    errors.ts           # Enveloppe d'erreurs { error, code, hint }
    prompts.ts          # Loader markdown avec substitution {{variable}}
  prompts/
    patient.md          # Rôle-play patient francophone
    evaluator.md        # Grille OSCE pondérée + contrat JSON

client/src/
  pages/                # Library, Simulation, Evaluation, Settings
  components/           # shadcn/ui + AppLayout (bannière clés manquantes)
  hooks/
    useMediaRecorder.ts # Push-to-talk (webm + fallback mp4 Safari)
    useKeyStatus.ts     # Ping /api/settings/status
  lib/
    api.ts              # Client typé (ApiError normalisé)
    preferences.ts      # Voix TTS préférée (localStorage)
    mockData.ts         # 4 stations : RESCOS / AMBOSS / USMLE / Triage
```

## Gestion des clés API

- Les clés ne sont **jamais** exposées au client. Seuls `/api/settings/status` renvoie des booléens `openai_ok` / `anthropic_ok`.
- Par défaut, une clé soumise via l'écran Paramètres reste **en mémoire** le temps de la session serveur.
- Si la case *"Persister dans `.env.local`"* est cochée, la clé est écrite dans `.env.local` (permissions `0600`, `.env.local` est listé dans `.gitignore`).
- Au démarrage, le serveur lit d'abord `process.env`, puis `.env.local` en complément.

## Flux d'une simulation

1. **Bibliothèque** → choix d'une station (scénario + signes vitaux + contexte caché).
2. **Simulation** → bouton *Démarrer* lance le timer de 13 min et lit la phrase d'ouverture via TTS.
3. Push-to-talk : clic sur le micro pour enregistrer, clic à nouveau pour envoyer. Audio → Whisper → message "étudiant" → Chat → message "patient" → TTS.
4. Alternative clavier : champ texte en bas de l'interface.
5. Bouton *Évaluer* à la fin → navigation vers la page Évaluation.
6. **Évaluation** → le transcript est envoyé à Claude Sonnet 4.5 via `/api/evaluator/evaluate`, qui renvoie un rapport JSON strict (scores pondérés, points forts, omissions critiques, priorités, verdict).

## Compatibilité navigateurs

- **Chrome / Firefox** : `MediaRecorder` avec `audio/webm;codecs=opus`.
- **Safari** : bascule automatique sur `audio/mp4`. Whisper accepte les deux formats.
- **Autoplay TTS** : le premier clic sur *Démarrer* est considéré comme interaction utilisateur et autorise la lecture automatique du patient.

## Tests

```bash
npm run test
```

- `client/src/lib/api.test.ts` : client API côté navigateur (fetch mocké, 11 cas).
- `server/__tests__/*.test.ts` : routes supertest + SDK OpenAI/Anthropic mockés (19 cas).
- Environnement : `happy-dom` pour le client, `node` pour le serveur.

## Sécurité

- `.env`, `.env.local` et `.env.*.local` sont ignorés par git.
- Les clés persistées sur disque ont les droits `0600` (lecture/écriture propriétaire uniquement).
- Aucune clé n'est loggée. Les erreurs upstream n'exposent que `status` + message générique.
- La limite d'upload Whisper est plafonnée à 25 Mo côté serveur (multer memory storage).
