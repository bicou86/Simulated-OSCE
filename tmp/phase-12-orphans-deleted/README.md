# Corbeille Phase 12 — orphelines `delete_safe`

## Origine

Audit J4 Phase 12 — voir [`docs/phase-12-orphans-audit.md`](../../docs/phase-12-orphans-audit.md).

## Catégorie

`delete_safe` : 71 fichiers avec **0 référence** dans le repo (vérifié par recherche
brute-force du *stem* sur 14 233 fichiers, hors `node_modules/`, `.git/`, `dist/`,
`.cache/`, `.upm/`, `client/public/pedagogical-images/`,
`docs/phase-11-migration-report.json`).

Les 26 fichiers `manual_review` (référencés via `filename` legacy dans
`tmp/phase11-pedagogy-source/*.json`) ne sont **pas** ici — ils restent en place sur
disque et sont tracés comme dette éditoriale dans
[`docs/phase-12-stations-non-applicables.md`](../../docs/phase-12-stations-non-applicables.md)
(section « Iconographie RESCOS non migrée »).

## Réversibilité

Restauration possible via :

```bash
git mv tmp/phase-12-orphans-deleted/<filename> client/public/pedagogical-images/<filename>
```

L'historique `git` conserve la trace du déplacement (le commit J4bis utilise `git mv`,
pas `mv` simple).

## Date et SHA déclencheur

- Date du déplacement : 2026-05-05
- SHA HEAD avant J4bis : `f920327748d9aba6595f1c3e3d16c955b57991e6`
- Branche : `main`

## Justification du split (Q-P12-A-12 = (d))

Cette corbeille héberge **uniquement** les 71 orphelines à 0 référence. Les 26
`manual_review` ont été conservées sur disque parce que leur référence `filename`
dans `tmp/phase11-pedagogy-source/*.json` les rend récupérables via une extension
future du script de migration (J4ter — fallback `filename → basename → slug → lookup
disque`). Cf. arbitrage Q-P12-A-13 = oui.
