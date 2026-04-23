import { describe, expect, it } from "vitest";
import {
  classifyDoctorIntent,
  detectPatientFindingLeaks,
  detectCaregiverFindingLeaks,
  PATIENT_FINDING_BLACKLIST,
  CAREGIVER_EXTRA_BLACKLIST,
  CAREGIVER_FINDING_BLACKLIST,
} from "./intentRouter";

describe("classifyDoctorIntent — gestes d'examen", () => {
  const examinerCases: Array<[string, string]> = [
    ["je palpe l'abdomen", "palpation abdominale"],
    ["Je palpe l'hypocondre droit", "palpation hypocondre"],
    ["j'ausculte le cœur", "auscultation cardiaque"],
    ["J'ausculte les poumons en inspiration profonde", "auscultation pulmonaire"],
    ["je percute le thorax", "percussion"],
    ["j'examine les sclérotiques", "examen sclérotiques"],
    ["je cherche le signe de Murphy", "recherche signe de Murphy"],
    ["Je teste le signe de Lasègue", "test Lasègue"],
    ["j'inspecte la peau", "inspection peau"],
    ["je regarde les tympans à l'otoscopie", "otoscopie"],
    ["au toucher rectal", "toucher rectal"],
    ["à l'auscultation cardiaque", "auscultation forme nominale"],
    ["à la palpation du foie", "palpation forme nominale"],
    ["au fond d'œil", "fond d'œil"],
    ["manœuvre de Dix-Hallpike", "manœuvre éponyme"],
    ["épreuve de Rinne", "Rinne"],
    ["je mesure la TA", "mesure TA"],
    ["je prends les constantes", "prise constantes"],
    ["quelle est l'auscultation pulmonaire ?", "demande de finding"],
    ["y a-t-il un souffle cardiaque ?", "demande directe souffle"],
    ["Glasgow ?", "score neuro"],
    ["auscultation", "simple mention"],
    ["Je réalise l'examen abdominal", "réalise + examen"],
  ];

  for (const [utterance, label] of examinerCases) {
    it(`"${utterance}" → examiner (${label})`, () => {
      expect(classifyDoctorIntent(utterance)).toBe("examiner");
    });
  }
});

describe("classifyDoctorIntent — verbalisation patient", () => {
  const patientCases: Array<[string, string]> = [
    ["Bonjour, comment allez-vous ?", "salutation"],
    ["Depuis quand avez-vous cette douleur ?", "anamnèse"],
    ["Pouvez-vous me décrire la douleur ?", "ouverture"],
    ["Avez-vous des nausées ?", "symptôme"],
    ["Qu'est-ce qui aggrave cette douleur ?", "facteur modulant"],
    ["Je suis désolé pour votre situation", "empathie"],
    ["Je comprends, c'est difficile", "empathie 2"],
    ["Avez-vous des antécédents cardiaques ?", "antécédents (cardiaques n'est pas un geste)"],
    ["Prenez-vous des médicaments ?", "traitement"],
    ["Vous fumez ?", "habitudes"],
  ];

  for (const [utterance, label] of patientCases) {
    it(`"${utterance}" → patient (${label})`, () => {
      expect(classifyDoctorIntent(utterance)).toBe("patient");
    });
  }
});

describe("classifyDoctorIntent — guard anamnèse (passé / conditionnel)", () => {
  const anamnesisCases: Array<[string, string]> = [
    ["Avez-vous déjà eu une auscultation anormale ?", "passé"],
    ["Auriez-vous déjà eu une palpation thyroïdienne anormale ?", "conditionnel"],
    ["Avez-vous déjà subi une percussion abdominale ?", "passé subi"],
    ["Avez-vous eu un souffle cardiaque par le passé ?", "passé"],
    ["Est-ce qu'un médecin vous a déjà dit que vous aviez un signe de Murphy ?", "passé 3e personne"],
    ["On vous a déjà fait une otoscopie ?", "passé impersonnel"],
    ["As-tu déjà eu une auscultation pulmonaire ?", "tutoiement passé"],
    ["Quand était votre dernière auscultation ?", "dernier"],
  ];
  for (const [utterance, label] of anamnesisCases) {
    it(`"${utterance}" → patient (${label})`, () => {
      expect(classifyDoctorIntent(utterance)).toBe("patient");
    });
  }
});

describe("classifyDoctorIntent — guard questions 3e personne (symptômes)", () => {
  const thirdPersonCases: Array<[string, string]> = [
    ["A-t-elle mal quand on lui touche la jambe ?", "douleur 3e personne"],
    ["Est-elle douloureuse à la marche ?", "douloureuse"],
    ["Est-ce douloureux pour elle ?", "est-ce douloureux"],
    ["Pleure-t-elle quand vous la bougez ?", "pleure-t-elle"],
    ["Est-elle gênée par cette douleur ?", "gênée"],
    ["A-t-elle déjà eu des douleurs similaires ?", "3e pers + déjà"],
    ["Crie-t-il lorsque vous la bougez ?", "crie-t-il"],
    ["A-t-il de la fièvre ?", "fièvre 3e personne"],
    ["Est-il inconfortable en position debout ?", "inconfortable"],
  ];
  for (const [utterance, label] of thirdPersonCases) {
    it(`"${utterance}" → patient (${label})`, () => {
      expect(classifyDoctorIntent(utterance)).toBe("patient");
    });
  }
});

describe("classifyDoctorIntent — blacklist fallback", () => {
  for (const term of PATIENT_FINDING_BLACKLIST) {
    it(`"${term}" isolé → examiner (liste noire)`, () => {
      expect(classifyDoctorIntent(term)).toBe("examiner");
    });
  }
});

describe("detectPatientFindingLeaks", () => {
  it("détecte un signe éponyme dans une réponse patient", () => {
    const reply = "Le signe de Murphy est positif, le patient a mal.";
    expect(detectPatientFindingLeaks(reply)).toContain("murphy");
  });

  it("détecte plusieurs leaks cumulés", () => {
    const reply = "L'auscultation retrouve un souffle systolique, palpation normale.";
    const leaks = detectPatientFindingLeaks(reply);
    expect(leaks).toContain("auscultation");
    expect(leaks).toContain("souffle systolique");
    expect(leaks).toContain("palpation");
  });

  it("ne produit aucun faux positif sur une réponse subjective", () => {
    const reply = "J'ai mal quand vous appuyez, ça me serre la poitrine, j'ai du mal à respirer.";
    expect(detectPatientFindingLeaks(reply)).toHaveLength(0);
  });

  it("tolère les accents absents", () => {
    expect(detectPatientFindingLeaks("Defense abdominale")).toContain("defense abdominale");
    expect(detectPatientFindingLeaks("Défense abdominale")).toContain("defense abdominale");
  });

  it("la blacklist patient ne contient PAS les verbes de mesure soignant (reste permissive)", () => {
    // "Saturation" peut légitimement sortir d'une bouche de patient adulte qui
    // rapporte un finding antérieur ("on m'a dit que ma saturation baissait").
    // Le filtrage caregiver est plus strict.
    expect(detectPatientFindingLeaks("Ma saturation était basse")).toHaveLength(0);
    expect(detectPatientFindingLeaks("J'ai une tachycardie connue")).toHaveLength(0);
  });
});

describe("CAREGIVER blacklist — invariants", () => {
  it("CAREGIVER_FINDING_BLACKLIST est l'union patient + extras sans doublon", () => {
    for (const term of PATIENT_FINDING_BLACKLIST) {
      expect(CAREGIVER_FINDING_BLACKLIST).toContain(term);
    }
    for (const term of CAREGIVER_EXTRA_BLACKLIST) {
      expect(CAREGIVER_FINDING_BLACKLIST).toContain(term);
    }
  });
  it("CAREGIVER_EXTRA_BLACKLIST couvre les mesures instrumentales clés", () => {
    const must = [
      "saturation",
      "spo2",
      "tachypnee",
      "tachycardie",
      "dyspnee",
      "cyanose",
      "febrile",
      "j'ai mesure",
      "murmure vesiculaire",
    ];
    for (const term of must) {
      expect(CAREGIVER_EXTRA_BLACKLIST).toContain(term);
    }
  });
});

describe("detectCaregiverFindingLeaks", () => {
  it("détecte les verbes de mesure qu'un parent ne devrait pas produire", () => {
    const reply = "J'ai mesuré sa saturation, elle est à 94%.";
    const leaks = detectCaregiverFindingLeaks(reply);
    expect(leaks).toContain("j'ai mesure");
    expect(leaks).toContain("saturation");
  });
  it("détecte le jargon clinique (tachypnée, cyanose, fébrile) et leurs variantes", () => {
    // Les formes dérivées (tachypnéique, cyanosée) doivent matcher leur
    // variante en blacklist, pas la racine.
    expect(detectCaregiverFindingLeaks("Elle est tachypnéique")).toContain("tachypneique");
    expect(detectCaregiverFindingLeaks("Elle a une tachypnée marquée")).toContain("tachypnee");
    expect(detectCaregiverFindingLeaks("Je la trouve cyanosée")).toContain("cyanosee");
    expect(detectCaregiverFindingLeaks("Cyanose périphérique")).toContain("cyanose");
    expect(detectCaregiverFindingLeaks("Elle est fébrile à 39")).toContain("febrile");
  });
  it("détecte le murmure vésiculaire (finding auscultatoire inventé)", () => {
    expect(detectCaregiverFindingLeaks("Le murmure vésiculaire est symétrique"))
      .toContain("murmure vesiculaire");
  });
  it("ne produit AUCUN leak sur le registre naïf attendu du parent", () => {
    const goodReplies = [
      "Elle est toute molle, elle ne tient pas droite.",
      "Elle a chaud au front, j'ai pris 39,2 avec le thermomètre.",
      "Elle respire vite et elle tire sur ses côtes.",
      "Elle pleure dès que je la bouge, elle se tient la jambe gauche.",
      "Son cœur bat vite, je le sens contre ma poitrine quand je la porte.",
      "Je ne saurais pas vous dire docteur, moi je vois juste qu'elle mange moins.",
    ];
    for (const r of goodReplies) {
      expect(detectCaregiverFindingLeaks(r)).toEqual([]);
    }
  });
  it("détecte aussi les leaks de la blacklist patient (signe éponyme)", () => {
    // La caregiver blacklist inclut patient blacklist → Murphy reste interdit.
    expect(detectCaregiverFindingLeaks("Le signe de Murphy est positif"))
      .toContain("murphy");
  });
});
