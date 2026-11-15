import type { EmergencyScenario, EmergencyScenarioFile, EmergencyStepFile } from "../schema";

/**
 * Shared pieces of the built-in guides. Rules for every guide (tests/emergency-guides.test.ts checks them):
 *  - step 1 is getting help: the crew medical officer and the flight surgeon on the station, the local emergency
 *    number on Earth;
 *  - lay first aid only, taken from the cited pages; never a diagnosis, never a medicine or a dose (the one exception:
 *    the person's own adrenaline auto-injector in the allergy guide, as the source says);
 *  - English and Mongolian steps have the same structure (same steps, same number of sentences);
 *  - reviewedBy stays "PENDING" until a medical professional has reviewed the text.
 */

/** the day the cited pages were read and compared with the steps */
export const CHECKED = "2026-11-15";

export const SOURCE = {
  cpr: {
    title: "St John Ambulance: How to do CPR (nhs.uk first-aid link redirects here)",
    url: "https://www.sja.org.uk/first-aid-advice/cpr/",
    checked: CHECKED,
  },
  redCrossCpr: {
    title: "American Red Cross: CPR steps",
    url: "https://www.redcross.org/take-a-class/cpr/performing-cpr/cpr-steps",
    checked: CHECKED,
  },
  fainting: { title: "St John Ambulance: Fainting", url: "https://www.sja.org.uk/first-aid-advice/fainting/", checked: CHECKED },
  choking: { title: "St John Ambulance: Choking", url: "https://www.sja.org.uk/first-aid-advice/choking/", checked: CHECKED },
  bleeding: {
    title: "St John Ambulance: Severe bleeding",
    url: "https://www.sja.org.uk/first-aid-advice/severe-bleeding/",
    checked: CHECKED,
  },
  burns: {
    title: "St John Ambulance: Burns and scalds",
    url: "https://www.sja.org.uk/first-aid-advice/burns-and-scalds/",
    checked: CHECKED,
  },
  seizure: { title: "St John Ambulance: Seizures", url: "https://www.sja.org.uk/first-aid-advice/seizure/", checked: CHECKED },
  heartAttack: {
    title: "St John Ambulance: Heart attack",
    url: "https://www.sja.org.uk/first-aid-advice/heart-attack/",
    checked: CHECKED,
  },
  anaphylaxis: {
    title: "St John Ambulance: Anaphylaxis (severe allergic reaction)",
    url: "https://www.sja.org.uk/first-aid-advice/anaphylaxis/",
    checked: CHECKED,
  },
  headInjury: {
    title: "St John Ambulance: Head injury",
    url: "https://www.sja.org.uk/first-aid-advice/head-injury/",
    checked: CHECKED,
  },
} as const;

/** step 1 of most guides */
export const HELP_STEP: EmergencyStepFile = {
  art: "call",
  text: {
    en: "Get help now. Call the crew medical officer and the flight surgeon; on Earth, call your local emergency number.",
    mn: "Яг одоо тусламж дууд. Багийн эмч болон нислэгийн эмчид мэдэгд; Дэлхий дээр бол яаралтай тусламжийн дугаарт залга.",
  },
};

/** the last step of several guides: the person stops responding */
export function startCprStep(art: EmergencyStepFile["art"] = "check-breathing"): EmergencyStepFile {
  return {
    art,
    link: "not-breathing",
    text: {
      en: "If they stop responding and are not breathing normally, start CPR now.",
      mn: "Хэрэв хариу өгөхгүй болж, хэвийн амьсгалахгүй бол яг одоо сэхээн амьдруулалт (CPR) эхлүүл.",
    },
  };
}

type GuideInput = Omit<EmergencyScenarioFile, "reviewedBy" | "triggers"> & {
  triggers: { en: string[]; mn: string[] };
};

/** a built-in guide as the client receives it (no images: every step has an inline illustration) */
export function defineGuide(input: GuideInput): EmergencyScenario {
  return {
    ...input,
    builtIn: true,
    reviewedBy: "PENDING",
    steps: input.steps.map((s) => ({ ...s, imageUrl: null })),
  };
}
