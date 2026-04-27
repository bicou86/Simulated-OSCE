// Phase 4 J2 — tests du routeur d'adresse heuristique.
//
// Couverture (≥30 cas) :
//   • a) tag explicite [À X]            : 6 cas (override, mismatch, lowercase…)
//   • b) vocatif nominatif              : 5 cas (prénom, nom, prénom-nom)
//   • c) préfixe rôle                   : 5 cas (maman, madame, monsieur+nom)
//   • d) marqueur de bascule (et vous)  : 4 cas
//   • e) sticky                         : 3 cas (3 tours sans marqueur)
//   • ambiguïté                         : 4 cas (no-current, ex æquo)
//   • mono-patient                      : 5 cas (5 stations témoins légales)
//
// Aucun LLM : tests purs sur des fixtures Participant[].

import { describe, expect, it } from "vitest";
import {
  routeAddress,
  type RouteResult,
} from "../services/addressRouter";
import type { Participant } from "@shared/station-schema";

// ─── Fixtures multi-profils (miroirs des stations annotées en J1) ─────────

const RESCOS_70: Participant[] = [
  {
    id: "emma",
    role: "patient",
    name: "Emma Delacroix",
    age: 16,
    vocabulary: "lay",
    knowledgeScope: ["self.symptoms"],
  },
  {
    id: "mother",
    role: "accompanying",
    name: "Mère d'Emma Delacroix",
    vocabulary: "lay",
    knowledgeScope: ["family.history"],
  },
];

const RESCOS_71: Participant[] = [
  {
    id: "louis",
    role: "patient",
    name: "M. Louis Bettaz",
    age: 78,
    vocabulary: "lay",
    knowledgeScope: ["self.symptoms.partial"],
  },
  {
    id: "martine",
    role: "accompanying",
    name: "Martine Bettaz",
    age: 52,
    vocabulary: "lay",
    knowledgeScope: ["caregiver.observations"],
  },
];

const RESCOS_9b: Participant[] = [
  {
    id: "charlotte",
    role: "patient",
    name: "Charlotte Borloz",
    age: 2,
    vocabulary: "lay",
    knowledgeScope: ["self.symptoms.observable"],
  },
  {
    id: "parent",
    role: "accompanying",
    name: "Parent de Charlotte Borloz",
    vocabulary: "lay",
    knowledgeScope: ["child.history"],
  },
];

const RESCOS_13: Participant[] = [
  {
    id: "patient",
    role: "patient",
    name: "Anne/Steve Peters",
    age: 20,
    vocabulary: "lay",
    knowledgeScope: ["self.symptoms"],
  },
  {
    id: "mother",
    role: "accompanying",
    name: "Mère d'Anne/Steve",
    vocabulary: "lay",
    knowledgeScope: ["patient.behavior-change"],
  },
];

const RESCOS_63: Participant[] = [
  {
    id: "liam",
    role: "patient",
    name: "Liam Lambretta",
    age: 0,
    vocabulary: "lay",
    knowledgeScope: ["self.symptoms.observable"],
  },
  {
    id: "parent",
    role: "accompanying",
    name: "Parent de Liam",
    vocabulary: "lay",
    knowledgeScope: ["infant.history"],
  },
];

// Fixture mono-patient (toute station Phase 1/2 non annotée).
const MONO_PATIENT: Participant[] = [
  {
    id: "patient",
    role: "patient",
    name: "Jean Dupont",
    age: 45,
    vocabulary: "lay",
    knowledgeScope: ["self.history", "self.symptoms"],
  },
];

// ─── Helpers d'assertion ───────────────────────────────────────────────────

function expectTarget(r: RouteResult, id: string, conf?: RouteResult["confidence"]) {
  expect(r.targetId).toBe(id);
  if (conf) expect(r.confidence).toBe(conf);
}

// ─── a) Tag explicite ─────────────────────────────────────────────────────

describe("routeAddress — a) tag explicite [À …]", () => {
  it("[À Emma] route vers Emma (high)", () => {
    const r = routeAddress({
      message: "[À Emma] comment vous sentez-vous depuis l'arrêt du sport ?",
      participants: RESCOS_70,
    });
    expectTarget(r, "emma", "high");
    expect(r.reason).toMatch(/tag explicite/i);
  });

  it("[à maman] (lowercase) route vers la mère", () => {
    const r = routeAddress({
      message: "[à maman] et chez vous, des migraines en famille ?",
      participants: RESCOS_70,
    });
    expectTarget(r, "mother", "high");
  });

  it("[À Martine] route vers Martine (RESCOS-71)", () => {
    const r = routeAddress({
      message: "[À Martine] votre père prend-il encore ses médicaments ?",
      participants: RESCOS_71,
    });
    expectTarget(r, "martine", "high");
  });

  it("[À louis] (lowercase prénom) route vers Louis", () => {
    const r = routeAddress({
      message: "[À louis] où avez-vous mal exactement ?",
      participants: RESCOS_71,
    });
    expectTarget(r, "louis", "high");
  });

  it("[À Inconnu] sur multi-profils → ambigu (mismatch)", () => {
    const r = routeAddress({
      message: "[À Inconnu] bonjour",
      participants: RESCOS_70,
    });
    expect(r.targetId).toBeNull();
    expect(r.confidence).toBe("ambiguous");
    expect(r.reason).toMatch(/ne correspond/i);
  });

  it("[À Emma] override : 'Maman' dans le corps n'écrase PAS le tag", () => {
    // Cas critique du spec J2 : le tag prend toujours la priorité absolue.
    const r = routeAddress({
      message: "[À Emma] Maman me disait que tu es fatiguée — comment tu te sens ?",
      participants: RESCOS_70,
    });
    expectTarget(r, "emma", "high");
    expect(r.reason).toMatch(/tag explicite/i);
  });
});

// ─── b) Vocatif nominatif ─────────────────────────────────────────────────

describe("routeAddress — b) vocatif nominatif (prénom/nom)", () => {
  it("« Emma, comment ça va ? » → Emma (high)", () => {
    const r = routeAddress({
      message: "Emma, comment ça va depuis la dernière fois ?",
      participants: RESCOS_70,
    });
    expectTarget(r, "emma", "high");
  });

  it("« Martine, votre père a-t-il dormi ? » → Martine (high)", () => {
    const r = routeAddress({
      message: "Martine, votre père a-t-il dormi cette nuit ?",
      participants: RESCOS_71,
    });
    expectTarget(r, "martine", "high");
  });

  it("« Louis, où avez-vous mal ? » → Louis (high)", () => {
    const r = routeAddress({
      message: "Louis, pouvez-vous me montrer où vous avez mal ?",
      participants: RESCOS_71,
    });
    expectTarget(r, "louis", "high");
  });

  it("« Charlotte ne marche pas du tout ? » → Charlotte (high)", () => {
    const r = routeAddress({
      message: "Charlotte ne pose pas du tout le pied gauche ?",
      participants: RESCOS_9b,
    });
    expectTarget(r, "charlotte", "high");
  });

  it("« Mademoiselle Delacroix, vos règles ? » → Emma via nom de famille", () => {
    const r = routeAddress({
      message: "Mademoiselle Delacroix, vos règles sont-elles régulières ?",
      participants: RESCOS_70,
    });
    expectTarget(r, "emma", "high");
  });
});

// ─── c) Préfixe rôle ──────────────────────────────────────────────────────

describe("routeAddress — c) préfixe rôle (maman, madame, monsieur+nom)", () => {
  it("« Maman, depuis quand ? » → mère (medium, role-only)", () => {
    const r = routeAddress({
      message: "Maman, depuis quand Emma se plaint-elle ?",
      participants: RESCOS_70,
    });
    expectTarget(r, "mother", "medium");
  });

  it("« Madame, votre fille… » → mère via alias rôle", () => {
    const r = routeAddress({
      message: "Madame, vous avez remarqué un changement chez votre fille ?",
      participants: RESCOS_70,
    });
    expectTarget(r, "mother", "medium");
  });

  it("« Monsieur Bettaz, vous avez mal ? » → Louis (monsieur + bettaz)", () => {
    const r = routeAddress({
      message: "Monsieur Bettaz, vous avez mal en ce moment ?",
      participants: RESCOS_71,
    });
    expectTarget(r, "louis", "high");
  });

  it("« Parent, vous avez observé Liam tousser ? » → parent (RESCOS-63)", () => {
    const r = routeAddress({
      message: "Parent, vous avez observé Liam tousser plutôt la nuit ?",
      participants: RESCOS_63,
    });
    // « parent » est dans les role-tokens du parent ET son id ; aussi,
    // « Liam » apparaît dans la tête → Liam = score 3, parent = score 5.
    // En réalité le routeur préfère ici le parent grâce au cumul role+id.
    expectTarget(r, "parent");
  });

  it("« Et toi maman, tu as remarqué quelque chose ? » → mère", () => {
    const r = routeAddress({
      message: "Et toi maman, tu as remarqué quelque chose à la maison ?",
      participants: RESCOS_70,
      currentSpeaker: "emma",
    });
    expectTarget(r, "mother");
  });
});

// ─── d) Marqueur de bascule ────────────────────────────────────────────────

describe("routeAddress — d) marqueur de bascule (et vous / et de votre côté)", () => {
  it("« Et vous ? » avec currentSpeaker=emma → mère (medium)", () => {
    const r = routeAddress({
      message: "Et vous ?",
      participants: RESCOS_70,
      currentSpeaker: "emma",
    });
    expectTarget(r, "mother", "medium");
    expect(r.reason).toMatch(/bascule/i);
  });

  it("« Et de votre côté ? » avec currentSpeaker=mother → Emma", () => {
    const r = routeAddress({
      message: "Et de votre côté, comment vivez-vous tout cela ?",
      participants: RESCOS_70,
      currentSpeaker: "mother",
    });
    expectTarget(r, "emma", "medium");
  });

  it("« Et vous Maman ? » → vocatif role bat la bascule (mère, medium)", () => {
    const r = routeAddress({
      message: "Et vous Maman, est-ce qu'elle se plaint le soir ?",
      participants: RESCOS_70,
      currentSpeaker: "emma",
    });
    expectTarget(r, "mother");
    // Reason = vocatif/role, pas bascule (priorité b/c > d).
    expect(r.reason).toMatch(/vocatif|r[oô]le/i);
  });

  it("« Et vous ? » sans currentSpeaker (T0) → ambigu (rien à basculer)", () => {
    const r = routeAddress({
      message: "Et vous ?",
      participants: RESCOS_70,
    });
    expect(r.targetId).toBeNull();
    expect(r.confidence).toBe("ambiguous");
  });
});

// ─── e) Sticky : aucun marqueur ⇒ on garde l'interlocuteur courant ────────

describe("routeAddress — e) sticky entre tours", () => {
  it("3 tours consécutifs sans marqueur → reste sur emma", () => {
    const turns = [
      "Comment décririez-vous la douleur ?",
      "Est-ce que ça vous gêne pour dormir ?",
      "Avez-vous pris quelque chose pour vous soulager ?",
    ];
    let current: string = "emma";
    for (const message of turns) {
      const r = routeAddress({
        message,
        participants: RESCOS_70,
        currentSpeaker: current,
      });
      expectTarget(r, "emma", "low");
      expect(r.reason).toMatch(/sticky/i);
      current = r.targetId!;
    }
    expect(current).toBe("emma");
  });

  it("sticky sur Martine (RESCOS-71, accompagnante par défaut)", () => {
    const r = routeAddress({
      message: "Pouvez-vous me décrire ce que vous avez observé ?",
      participants: RESCOS_71,
      currentSpeaker: "martine",
    });
    expectTarget(r, "martine", "low");
  });

  it("sticky avec currentSpeaker invalide (id absent) → ambigu", () => {
    // Si le caller passe un currentSpeaker qui n'existe plus dans
    // participants (ex. station rechargée), on doit retomber en ambigu plutôt
    // que de faire silencieusement confiance à un id obsolète.
    const r = routeAddress({
      message: "Comment vous sentez-vous ?",
      participants: RESCOS_70,
      currentSpeaker: "ghost",
    });
    expect(r.targetId).toBeNull();
    expect(r.confidence).toBe("ambiguous");
  });
});

// ─── Ambiguïté ────────────────────────────────────────────────────────────

describe("routeAddress — cas ambigus", () => {
  it("« Comment ça va ? » sur multi-profils sans currentSpeaker (T0)", () => {
    const r = routeAddress({
      message: "Comment ça va aujourd'hui ?",
      participants: RESCOS_70,
    });
    expect(r.targetId).toBeNull();
    expect(r.confidence).toBe("ambiguous");
    expect(r.candidateIds).toEqual(expect.arrayContaining(["emma", "mother"]));
  });

  it("nom de famille seul partagé (« Bettaz ? ») → ex æquo, ambigu", () => {
    // Louis ET Martine partagent « Bettaz » dans leurs proper-tokens. Sans
    // titre désambiguant, l'adresse est inrésolvable.
    const r = routeAddress({
      message: "Bettaz ? je vous écoute.",
      participants: RESCOS_71,
    });
    expect(r.targetId).toBeNull();
    expect(r.confidence).toBe("ambiguous");
    expect(r.candidateIds).toEqual(expect.arrayContaining(["louis", "martine"]));
  });

  it("aucun participant déclaré → ambigu", () => {
    const r = routeAddress({
      message: "Bonjour",
      participants: [],
    });
    expect(r.targetId).toBeNull();
    expect(r.confidence).toBe("ambiguous");
  });

  it("message vide multi-profils sans currentSpeaker → ambigu", () => {
    const r = routeAddress({
      message: "",
      participants: RESCOS_70,
    });
    expect(r.targetId).toBeNull();
    expect(r.confidence).toBe("ambiguous");
  });
});

// ─── f) Mono-patient : routage trivial vers l'unique participant ──────────

describe("routeAddress — f) mono-patient (rétrocompat 100 %)", () => {
  // 5 stations témoins au sens du spec : on rejoue le même schéma sur
  // 5 fixtures mono-patient de profils variés, pour vérifier qu'aucun
  // marqueur ne fait dévier le routeur d'un mono.
  const MONO_FIXTURES: Array<{ name: string; participants: Participant[] }> = [
    {
      name: "adulte sans marqueur",
      participants: MONO_PATIENT,
    },
    {
      name: "adulte avec marqueur 'Madame' (ignoré)",
      participants: [
        {
          id: "patient",
          role: "patient",
          name: "Mme Sophie Mercier",
          age: 38,
          vocabulary: "lay",
          knowledgeScope: ["self.history"],
        },
      ],
    },
    {
      name: "adolescent",
      participants: [
        {
          id: "patient",
          role: "patient",
          name: "Théo Martin",
          age: 15,
          vocabulary: "lay",
          knowledgeScope: ["self.history"],
        },
      ],
    },
    {
      name: "personne âgée",
      participants: [
        {
          id: "patient",
          role: "patient",
          name: "M. Robert Lemoine",
          age: 82,
          vocabulary: "lay",
          knowledgeScope: ["self.history"],
        },
      ],
    },
    {
      name: "soignant·e (vocabulaire medical)",
      participants: [
        {
          id: "patient",
          role: "patient",
          name: "Dr. Claire Vasseur",
          age: 41,
          vocabulary: "medical",
          knowledgeScope: ["self.history"],
        },
      ],
    },
  ];

  it.each(MONO_FIXTURES)("$name → toujours le patient unique (high)", ({ participants }) => {
    const r = routeAddress({
      message: "Comment ça va aujourd'hui ?",
      participants,
    });
    expectTarget(r, participants[0].id, "high");
    expect(r.reason).toMatch(/mono/i);
  });

  it("mono-patient ignore tag explicite mismatched (et reste sur l'unique)", () => {
    // Sur mono, le routeur retourne l'unique participant sans même évaluer
    // le tag — c'est l'intention rétrocompat. « [À X] » devient inerte.
    const r = routeAddress({
      message: "[À UneAutrePersonne] bonjour",
      participants: MONO_PATIENT,
    });
    expectTarget(r, "patient", "high");
  });

  it("mono-patient + 'Et vous ?' → patient (pas de bascule possible)", () => {
    const r = routeAddress({
      message: "Et vous, comment vous sentez-vous ?",
      participants: MONO_PATIENT,
      currentSpeaker: null,
    });
    expectTarget(r, "patient", "high");
  });
});

// ─── Tests d'intégration : alternance complète sur RESCOS-70 ──────────────

describe("routeAddress — scénario E2E synthétique RESCOS-70", () => {
  it("séquence 5 tours : T0 ambigu, vocatif Emma, sticky, bascule, vocatif mère", () => {
    let current: string | null = null;

    // T0 — pas de currentSpeaker, pas de marqueur ⇒ ambigu
    const t0 = routeAddress({
      message: "Bonjour, je suis le Dr Martin.",
      participants: RESCOS_70,
      currentSpeaker: current,
    });
    expect(t0.confidence).toBe("ambiguous");

    // T1 — vocatif Emma
    const t1 = routeAddress({
      message: "Emma, qu'est-ce qui vous amène ?",
      participants: RESCOS_70,
      currentSpeaker: current,
    });
    expectTarget(t1, "emma", "high");
    current = t1.targetId;

    // T2 — sticky (pas de marqueur)
    const t2 = routeAddress({
      message: "Pouvez-vous décrire la douleur ?",
      participants: RESCOS_70,
      currentSpeaker: current,
    });
    expectTarget(t2, "emma", "low");
    current = t2.targetId;

    // T3 — bascule explicite
    const t3 = routeAddress({
      message: "Et vous ?",
      participants: RESCOS_70,
      currentSpeaker: current,
    });
    expectTarget(t3, "mother", "medium");
    current = t3.targetId;

    // T4 — vocatif mère via préfixe rôle
    const t4 = routeAddress({
      message: "Madame, depuis quand a-t-elle ces symptômes ?",
      participants: RESCOS_70,
      currentSpeaker: current,
    });
    expectTarget(t4, "mother");
    current = t4.targetId;

    expect(current).toBe("mother");
  });
});
