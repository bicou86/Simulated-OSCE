# Tests — répertoire racine `tests/`

Trois rôles distincts :

```
tests/
  fixtures/              # Données figées (transcripts, fixtures spécialités)
    transcripts/         # Phase 2 — 8 transcriptions gold-standard pour
                         # tests évaluateur non-régression
    specialties/         # Phase 3 J3-J4 — 4 fixtures spécialités (gyneco /
                         # ado / palliatif / parent-insistant branched)
    __snapshots__/       # Snapshots déterministes (checksums Phase 2…)
  integration/           # Tests intégration gated par env var, hors-CI
```

## Tests unitaires (CI par défaut)

`npm run test` exécute :
- `client/src/**/*.test.{ts,tsx}` (happy-dom)
- `server/**/*.test.ts` (node, SDKs OpenAI/Anthropic mockés)
- `tests/integration/**/*.test.ts` (déclarés mais skippés sans env var)

Total : 570+ tests, ~7 s, 0 appel LLM.

## Tests d'intégration LLM (hors-CI, locaux)

Les tests dans `tests/integration/` font des appels réels OpenAI / Anthropic
et coûtent. Ils sont **désactivés par défaut** via un gate `describe.skip`.

Pour les exécuter :

```bash
RUN_LLM_INTEGRATION=1 \
  OPENAI_API_KEY=sk-... \
  ANTHROPIC_API_KEY=sk-ant-... \
  npx vitest run tests/integration/ecos-invariants.test.ts
```

3 invariants ECOS testés sur 3 stations pilotes (5 runs chacun) :
1. **Identification T0** — la première réponse identifie clairement
   l'interlocuteur (regex match).
2. **Réussite & échec atteignables** — bonne vs mauvaise trajectoire candidat
   produisent deux verdicts Sonnet 4.5 distincts (ou un écart score ≥ 15).
3. **Zéro invention** — aucune valeur numérique produite par le patient
   n'apparaît hors des champs station documentés (vitals,
   examens_complementaires, antécédents chiffrés).

Coût indicatif par run complet (3 stations × 3 invariants) : ~5 minutes
wall-clock, ~50 k tokens cumulés OpenAI + ~30 k tokens Sonnet (cache hits).

## Snapshots `__snapshots__/`

- `phase2-checksum.json` — SHA-256 des 283 stations Phase 2 non touchées par
  J3, sérialisation déterministe (clés JSON triées récursivement). Lock
  byte-stability lors du merge final Phase 3 → main.

Pour regénérer après une modification Phase 2 *intentionnelle*, supprimer le
fichier et relancer le test (cf. `server/__tests__/phase2Checksum.test.ts`).
