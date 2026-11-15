import { z } from "zod";

/**
 * Emergency guidance format. Two sources share it:
 *  - the built-in guides that ship with the app (src/lib/emergency/guides.ts, typed data, works with no network);
 *  - the team's optional folder COSMO_EMERGENCY_DIR (default C:/dev/cosmo-assets/emergency, outside the repo):
 *      <id>/scenario.json   validated by scenarioSchema below
 *      <id>/step-1.png ...  optional image per step (the app's visual style)
 *    A team scenario with the id of a built-in guide replaces it; other ids are added.
 * Content comes from cited lay first-aid sources and must be reviewed by a medically qualified person; until then
 * reviewedBy is "PENDING" and the app shows a "not yet reviewed" label.
 */

const bilingual = z.object({
  en: z.string().trim().min(1).max(400),
  mn: z.string().trim().min(1).max(400),
});

export const STEP_IMAGE_RE = /^step-\d{1,2}\.(png|jpg|jpeg|webp)$/;
export const SCENARIO_ID_RE = /^[a-z0-9-]{2,40}$/;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** inline-SVG illustrations available to a step (src/components/emergency/illustrations.tsx draws each one) */
export const STEP_ARTS = [
  "call",
  "stay-with",
  "lying",
  "legs-raised",
  "sit-up",
  "recovery",
  "check-breathing",
  "hands-chest",
  "compressions",
  "aed",
  "cough",
  "back-blows",
  "abdominal-thrusts",
  "press-wound",
  "press-sides",
  "bandage",
  "cool-water",
  "remove-rings",
  "cover-burn",
  "no-ice",
  "clear-space",
  "cushion-head",
  "hands-off",
  "timer",
  "sit-supported",
  "reassure",
  "watch",
  "auto-injector",
  "cold-pack",
  "stay-still",
] as const;
export type StepArt = (typeof STEP_ARTS)[number];

/** icons of the scenario grid */
export const GUIDE_ICONS = [
  "siren",
  "person",
  "heart",
  "wind",
  "drop",
  "flame",
  "zap",
  "pulse",
  "injector",
  "brain",
] as const;
export type GuideIcon = (typeof GUIDE_ICONS)[number];

export const scenarioSchema = z.object({
  id: z.string().regex(SCENARIO_ID_RE),
  title: bilingual,
  icon: z.enum(GUIDE_ICONS).optional(),
  /** one short line under the title on the grid card */
  summary: bilingual.optional(),
  /** a note about the space setting (on the station / after landing), shown above the steps */
  context: bilingual.optional(),
  triggers: z
    .object({
      en: z.array(z.string().trim().min(2).max(60)).max(40).default([]),
      mn: z.array(z.string().trim().min(2).max(60)).max(40).default([]),
    })
    .default({ en: [], mn: [] }),
  steps: z
    .array(
      z.object({
        text: bilingual,
        image: z.string().regex(STEP_IMAGE_RE).optional(),
        art: z.enum(STEP_ARTS).optional(),
        /** CPR: show the compression-rhythm metronome and the running timer on this step */
        metronome: z.boolean().optional(),
        /** another guide this step points to ("start CPR"): shown as a button */
        link: z.string().regex(SCENARIO_ID_RE).optional(),
      }),
    )
    .min(1)
    .max(10),
  sources: z
    .array(
      z.object({
        title: z.string().trim().min(1).max(200),
        url: z.url().max(500),
        /** the day the page was read and compared with the steps (YYYY-MM-DD) */
        checked: z.string().regex(ISO_DATE_RE).optional(),
      }),
    )
    .max(10)
    .default([]),
  reviewedBy: z.string().trim().max(200).default("PENDING"),
});

export type EmergencyScenarioFile = z.infer<typeof scenarioSchema>;
export type EmergencyStepFile = EmergencyScenarioFile["steps"][number];

/** what the client receives: image file names are turned into URLs served by /api/emergency/:id/image/:file */
export interface EmergencyScenario extends EmergencyScenarioFile {
  builtIn: boolean;
  steps: Array<EmergencyStepFile & { imageUrl: string | null }>;
}

export function isReviewed(s: Pick<EmergencyScenarioFile, "reviewedBy">): boolean {
  const r = s.reviewedBy.trim();
  return r !== "" && !/pending/i.test(r);
}

/**
 * The one card that is always available, with no medical content of its own: get help, stay together, follow the
 * crew's procedures. Shown last in the grid and opened when serious words match no specific guide.
 */
export const BUILTIN_CALL_FOR_HELP: EmergencyScenario = {
  id: "call-for-help",
  builtIn: true,
  icon: "siren",
  title: { en: "Get help now", mn: "Яг одоо тусламж дууд" },
  summary: { en: "Something else is wrong", mn: "Өөр зүйл болсон" },
  triggers: { en: [], mn: [] },
  steps: [
    {
      text: {
        en: "Get help now. Tell your crew medical officer, the flight surgeon and ground right now; on Earth, call your local emergency number.",
        mn: "Яг одоо тусламж дууд. Багийн эмч, нислэгийн эмч болон газрын хяналтад яг одоо мэдэгд; Дэлхий дээр бол яаралтай тусламжийн дугаарт залга.",
      },
      art: "call",
      imageUrl: null,
    },
    {
      text: {
        en: "Stay with your crewmate and follow your crew's medical procedures.",
        mn: "Багийн гишүүнтэйгээ хамт байж, багийнхаа эмнэлгийн журмыг дагаарай.",
      },
      art: "stay-with",
      imageUrl: null,
    },
  ],
  sources: [],
  reviewedBy: "PENDING",
};
