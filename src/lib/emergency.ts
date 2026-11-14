import { z } from "zod";
import type { Lang } from "./types";
import { SERIOUS_WORDS_EN, SERIOUS_WORDS_MN } from "./health/flags";

/**
 * Emergency guidance content (prepared IN ADVANCE by the team, never generated at runtime).
 *
 * One folder per scenario under AEGIS_EMERGENCY_DIR (default C:/dev/aegis-assets/emergency):
 *   <id>/scenario.json   validated by scenarioSchema below
 *   <id>/step-1.png ...  one image per step (transparent PNG, the app's visual style)
 * Content must come from cited first-aid sources and be reviewed by a medically qualified person; until then
 * reviewedBy is "PENDING" and the app shows a "not yet reviewed" label.
 */

const bilingual = z.object({
  en: z.string().trim().min(1).max(400),
  mn: z.string().trim().min(1).max(400),
});

export const STEP_IMAGE_RE = /^step-\d{1,2}\.(png|jpg|jpeg|webp)$/;
export const SCENARIO_ID_RE = /^[a-z0-9-]{2,40}$/;

export const scenarioSchema = z.object({
  id: z.string().regex(SCENARIO_ID_RE),
  title: bilingual,
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
      }),
    )
    .min(1)
    .max(10),
  sources: z
    .array(z.object({ title: z.string().trim().min(1).max(200), url: z.url().max(500) }))
    .max(10)
    .default([]),
  reviewedBy: z.string().trim().max(200).default("PENDING"),
});

export type EmergencyScenarioFile = z.infer<typeof scenarioSchema>;

/** what the client receives: image file names are turned into URLs served by /api/emergency/:id/image/:file */
export interface EmergencyScenario extends EmergencyScenarioFile {
  builtIn: boolean;
  steps: Array<{ text: { en: string; mn: string }; image?: string; imageUrl: string | null }>;
}

export function isReviewed(s: Pick<EmergencyScenarioFile, "reviewedBy">): boolean {
  const r = s.reviewedBy.trim();
  return r !== "" && !/pending/i.test(r);
}

/**
 * The one card that is always available, with no medical content of its own: get help, stay together, follow the
 * crew's procedures. Shown first when nothing else matches, and alone until the team's content is in place.
 */
export const BUILTIN_CALL_FOR_HELP: EmergencyScenario = {
  id: "call-for-help",
  builtIn: true,
  title: { en: "Get help now", mn: "Яг одоо тусламж дууд" },
  triggers: { en: [], mn: [] },
  steps: [
    {
      text: {
        en: "Tell your crew medical officer and ground right now.",
        mn: "Багийн эмч болон Дэлхийд яг одоо мэдэгд.",
      },
      imageUrl: null,
    },
    {
      text: {
        en: "Stay with your crewmate and follow your crew's medical procedures.",
        mn: "Багийн гишүүнтэйгээ хамт байж, багийнхаа эмнэлгийн журмыг дагаарай.",
      },
      imageUrl: null,
    },
  ],
  sources: [],
  reviewedBy: "PENDING",
};

function normalise(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * Does this utterance call for emergency guidance? The team's trigger words of each scenario (both languages - speech
 * recognition mixes them) are checked first, in list order; then the app's serious-symptom words, which open the
 * built-in "get help" card. Returns null when nothing matches. Negations ("no chest pain") are left to the caller's
 * judgement: guidance opening by mistake is safer than staying closed.
 */
export function matchEmergency(
  text: string,
  scenarios: ReadonlyArray<Pick<EmergencyScenario, "id" | "triggers">>,
): { scenarioId: string; matched: string } | null {
  const t = normalise(text);
  if (t.length === 0) return null;
  for (const s of scenarios) {
    for (const lang of ["en", "mn"] as Lang[]) {
      for (const word of s.triggers[lang]) {
        const w = normalise(word);
        if (w.length >= 2 && t.includes(w)) return { scenarioId: s.id, matched: word };
      }
    }
  }
  for (const word of [...SERIOUS_WORDS_EN, ...SERIOUS_WORDS_MN]) {
    const w = normalise(word);
    if (w.length >= 2 && t.includes(w)) return { scenarioId: BUILTIN_CALL_FOR_HELP.id, matched: word };
  }
  return null;
}
