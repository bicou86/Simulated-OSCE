// Phase 11 J2 — schéma Zod pour le bloc pédagogique additif `pedagogicalContent`.
//
// Décrit les 4 sous-blocs pédagogiques que pourra exposer chaque station ECOS
// dans le rapport PDF (Phase 11 J3-J4) : résumé clinique, présentation
// type, théorie cadrée, iconographie. Aucun de ces sous-blocs n'est
// obligatoire — tout est strictement optionnel à tous les niveaux pour
// préserver la rétrocompatibilité avec les 285 stations actuelles
// (aucune station ne porte ce champ en J2).
//
// INVARIANTS RAPPELÉS
//   • I13 — Cloisonnement LLM patient : `pedagogicalContent` est strippé
//     du JSON `<station_data>` injecté au prompt LLM patient via
//     `META_FIELDS_TO_STRIP` (cf. patientService.ts). Le contenu
//     pédagogique ne doit JAMAIS être injecté au LLM patient simulé
//     (sinon le candidat verrait des indices factuels durant la
//     consultation).
//   • I14 — Isolation heuristique vs pédagogie : `pedagogicalContent`
//     n'est pas remonté par `/api/patient/:id/brief` ; il est exposé
//     UNIQUEMENT via l'endpoint dédié `/api/patient/:id/pedagogy`
//     (Phase 11 J2). Aucune logique heuristique, zéro LLM dans le
//     service de lecture.
//   • I16 — Hébergement local des images : les chemins `images[].data`
//     pointent vers `/pedagogical-images/<slug>.jpg` (servi par Vite
//     publicDir, symétrie avec `/medical-images/`). Aucune URL externe
//     n'est tolérée — le schéma rejette tout préfixe différent.
//
// Aucune dépendance à `station-schema.ts` (le branchement se fait dans
// station-schema, pas l'inverse — évite tout cycle d'import).

import { z } from "zod";

// Regex stricte sur les chemins d'images pédagogiques :
//   • préfixe obligatoire `/pedagogical-images/`
//   • slug en kebab-case ASCII : `[a-z0-9]+(?:-[a-z0-9]+)*`
//   • extension `.jpg` lowercase obligatoire
// Toute violation (URL externe, chemin medical-images, casse, espace,
// extension différente) est rejetée par Zod avant injection PDF.
export const pedagogicalImagePathSchema = z
  .string()
  .regex(
    /^\/pedagogical-images\/[a-z0-9]+(?:-[a-z0-9]+)*\.jpg$/,
    "Chemin image pédagogique invalide : doit matcher /pedagogical-images/<slug>.jpg",
  );

// Bloc résumé clinique : titre + corps en plain text (pas de markdown
// avant J5 — cf. arbitrage A7).
export const pedagogicalResumeSchema = z.object({
  title: z.string().min(1).optional(),
  body: z.string().min(1).optional(),
});
export type PedagogicalResume = z.infer<typeof pedagogicalResumeSchema>;

// Bloc présentation type : narratif type d'un cas clinique de référence
// (anamnèse + examen + paraclinique attendus). Plain text.
export const pedagogicalPresentationSchema = z.object({
  title: z.string().min(1).optional(),
  body: z.string().min(1).optional(),
});
export type PedagogicalPresentation = z.infer<typeof pedagogicalPresentationSchema>;

// Bloc théorie : rappels physiopathologiques, scores, drapeaux rouges.
// Plain text. Sera enrichi en markdown structuré en Phase 12+ si besoin.
export const pedagogicalTheorySchema = z.object({
  title: z.string().min(1).optional(),
  body: z.string().min(1).optional(),
});
export type PedagogicalTheory = z.infer<typeof pedagogicalTheorySchema>;

// Bloc iconographique : une entrée = une image avec sa légende.
//   • `data` : chemin local validé par `pedagogicalImagePathSchema`
//   • `caption` : description plain text affichée sous l'image
//   • `alt` : texte alternatif pour accessibilité (PDF + a11y)
// Tous les champs sont optionnels — une entrée vide reste valide
// (l'UI/PDF gérera le rendu dégradé). En J2 aucun consommateur ne
// rendra encore ce bloc (cf. J4 pour la mise en page PDF).
export const pedagogicalImageSchema = z.object({
  data: pedagogicalImagePathSchema.optional(),
  caption: z.string().min(1).optional(),
  alt: z.string().min(1).optional(),
});
export type PedagogicalImage = z.infer<typeof pedagogicalImageSchema>;

// Bloc racine : agrégation des 4 sous-blocs. Tout est optionnel pour
// permettre une adoption progressive station par station (J3 fera la
// migration des fixtures depuis les sources annotées).
export const pedagogicalContentSchema = z.object({
  resume: pedagogicalResumeSchema.optional(),
  presentation: pedagogicalPresentationSchema.optional(),
  theory: pedagogicalTheorySchema.optional(),
  images: z.array(pedagogicalImageSchema).optional(),
});
export type PedagogicalContent = z.infer<typeof pedagogicalContentSchema>;
