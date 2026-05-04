// Phase 11 J2bis — schéma Zod élargi pour le bloc pédagogique additif
// `pedagogicalContent`, capable d'absorber les arborescences récursives
// observées dans les 285 fichiers `tmp/phase11-pedagogy-source/*.json`
// (8 variantes `theoriePratique` recensées : sections + champs libres
// `examensComplementaires`, `rappelsTherapeutiques`, `evidenceSDM`,
// `outilsCoordination`, `phrasesCles`, `techniquesEmpathie`,
// `optionsTherapeutiques`, `examensDifferentiels`, `questionsEchelles`,
// `rappelsOrganisationnels`).
//
// PRINCIPE D'ÉLARGISSEMENT (A17, Phase 11 J3) :
//   • Récursivité via `z.lazy()` sur `subsections[]`.
//   • `.passthrough()` à TOUS les niveaux : on accepte n'importe quel
//     champ supplémentaire en plus de la structure canonique
//     (titre, contenu, points, subsections, sections), sans casser la
//     validation. Pas de schéma fermé : la richesse pédagogique source
//     est préservée pour le rendu PDF Phase 11 J4.
//   • Backward compat 100 % avec les tests J2 : la racine accepte
//     toujours `resume` / `presentation` / `theory` (anciens noms J2)
//     ainsi que les nouveaux noms `presentationPatient` /
//     `theoriePratique` alignés sur le format source. Les anciens
//     champs `title` / `body` plain text restent acceptés via
//     passthrough — un sous-bloc legacy `{ title, body }` continue de
//     parser sans modification.
//
// INVARIANTS RAPPELÉS (J2 inchangés)
//   • I13 — Cloisonnement LLM patient : `pedagogicalContent` est strippé
//     du JSON `<station_data>` injecté au prompt LLM patient via
//     `META_FIELDS_TO_STRIP` (cf. patientService.ts).
//   • I14 — Isolation heuristique vs pédagogie : `pedagogicalContent`
//     n'est pas remonté par `/api/patient/:id/brief` ; exposé
//     UNIQUEMENT via `/api/patient/:id/pedagogy`.
//   • I16 — Hébergement local des images : les chemins `images[].data`
//     pointent vers `/pedagogical-images/<slug>.jpg`. Regex stricte
//     `pedagogicalImagePathSchema` INCHANGÉE depuis J2.
//
// Aucune dépendance à `station-schema.ts` (le branchement se fait dans
// station-schema, pas l'inverse — évite tout cycle d'import).

import { z } from "zod";

// Regex stricte sur les chemins d'images pédagogiques — INCHANGÉE J2 :
//   • préfixe obligatoire `/pedagogical-images/`
//   • slug en kebab-case ASCII : `[a-z0-9]+(?:-[a-z0-9]+)*`
//   • extension `.jpg` lowercase obligatoire
export const pedagogicalImagePathSchema = z
  .string()
  .regex(
    /^\/pedagogical-images\/[a-z0-9]+(?:-[a-z0-9]+)*\.jpg$/,
    "Chemin image pédagogique invalide : doit matcher /pedagogical-images/<slug>.jpg",
  );

// Sous-section pédagogique récursive — la brique élémentaire des
// arborescences `resume`, `presentationPatient`, `theoriePratique`.
//
// Champs canoniques observés dans le corpus source :
//   • `titre`        : intitulé de la sous-section
//   • `contenu`      : paragraphe d'introduction (souvent absent quand
//                      points[] est présent)
//   • `points`       : liste de puces narratives
//   • `subsections`  : récursif, pour les arborescences imbriquées
//                      (ex. resume → sections[].subsections[])
//
// `.passthrough()` permet de conserver tout autre champ rencontré dans
// la source (ex. `niveau`, `references`, `tableau`, etc.) sans
// rejet. Le PDF Phase 11 J4 décidera quels champs rendre.
export const pedagogicalSubsectionSchema: z.ZodType<PedagogicalSubsection> = z.lazy(() =>
  z
    .object({
      titre: z.string().optional(),
      contenu: z.string().optional(),
      points: z.array(z.string()).optional(),
      subsections: z.array(pedagogicalSubsectionSchema).optional(),
    })
    .passthrough(),
);

export interface PedagogicalSubsection {
  titre?: string;
  contenu?: string;
  points?: string[];
  subsections?: PedagogicalSubsection[];
  [extra: string]: unknown;
}

// Arborescence pédagogique racine (resume / presentationPatient /
// theoriePratique). Compose un titre + une liste de sous-sections.
//
// Backward-compat J2 : on déclare aussi `title` et `body` (anciens
// champs J2 plain text) en optionnels, plus `.passthrough()` qui
// absorbe les variantes spécifiques `theoriePratique`
// (`examensComplementaires`, `rappelsTherapeutiques`, `evidenceSDM`,
// `outilsCoordination`, `phrasesCles`, `techniquesEmpathie`,
// `optionsTherapeutiques`, `examensDifferentiels`, `questionsEchelles`,
// `rappelsOrganisationnels`).
export const pedagogicalTreeSchema = z
  .object({
    titre: z.string().optional(),
    sections: z.array(pedagogicalSubsectionSchema).optional(),
    title: z.string().optional(),
    body: z.string().optional(),
  })
  .passthrough();
export type PedagogicalTree = z.infer<typeof pedagogicalTreeSchema>;

// Aliases de type pour compat avec l'usage J2 (les exports
// `PedagogicalResume` / `PedagogicalPresentation` / `PedagogicalTheory`
// restent disponibles, pointant vers le même schéma récursif).
export const pedagogicalResumeSchema = pedagogicalTreeSchema;
export const pedagogicalPresentationSchema = pedagogicalTreeSchema;
export const pedagogicalTheorySchema = pedagogicalTreeSchema;
export type PedagogicalResume = PedagogicalTree;
export type PedagogicalPresentation = PedagogicalTree;
export type PedagogicalTheory = PedagogicalTree;

// Bloc iconographique : entrée image avec sa légende.
//   • `data`        : chemin local validé par `pedagogicalImagePathSchema`
//   • `caption`     : description plain text affichée sous l'image (J2)
//   • `alt`         : texte alternatif accessibilité (J2)
//   • `title`       : titre source (présent dans 280/280 entrées sources)
//   • `description` : description source longue (souvent corps PDF
//                     préféré au caption)
//   • `id`          : identifiant intra-source (img1, img2, …)
// `.passthrough()` accepte tout champ source supplémentaire.
export const pedagogicalImageSchema = z
  .object({
    data: pedagogicalImagePathSchema.optional(),
    caption: z.string().min(1).optional(),
    alt: z.string().min(1).optional(),
    title: z.string().optional(),
    description: z.string().optional(),
    id: z.string().optional(),
  })
  .passthrough();
export type PedagogicalImage = z.infer<typeof pedagogicalImageSchema>;

// Bloc racine — agrégation des sous-blocs pédagogiques. Tous optionnels.
//
// Champs racine acceptés (alignés sur le format source) :
//   • `resume`              : arborescence récapitulative (corpus 115/285)
//   • `presentationPatient` : narratif présentation type (corpus 98/285,
//                              + 1 occurrence top-level dans la source)
//   • `theoriePratique`     : théorie + 8 variantes passthrough (189/285)
//   • `images`              : iconographie (68/285 sources, 280 images)
//
// Backward-compat J2 :
//   • `presentation` (ancien nom J2) et `theory` (ancien nom J2) restent
//     déclarés en option pour que les tests J2 et les payloads
//     hérités continuent à parser sans modification.
//   • `.passthrough()` capture tout autre champ racine inattendu sans
//     rejet (zéro régression sur les fixtures legacy).
export const pedagogicalContentSchema = z
  .object({
    resume: pedagogicalTreeSchema.optional(),
    presentationPatient: pedagogicalTreeSchema.optional(),
    theoriePratique: pedagogicalTreeSchema.optional(),
    presentation: pedagogicalTreeSchema.optional(),
    theory: pedagogicalTreeSchema.optional(),
    images: z.array(pedagogicalImageSchema).optional(),
  })
  .passthrough();
export type PedagogicalContent = z.infer<typeof pedagogicalContentSchema>;
