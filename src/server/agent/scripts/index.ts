/**
 * Scripted demo check-in (docs/DASHBOARD_PLAN.md section 6): the astronaut side of one complete conversation with
 * Bat's demo values. The server plays these lines as if they had been spoken, so the demo works with no microphone,
 * no STT and no network. Every line is interpretable by the rule-based interpreter (tests/demo-scripts.test.ts).
 */

import type { KpiKey, Lang, MeasurementValue, QuestionId } from "@/lib/types";
import { DEMO_SCRIPT_EN } from "./demo.en";
import { DEMO_SCRIPT_MN } from "./demo.mn";

/**
 * One thing the astronaut says. `expect` names the step it answers:
 *  - smalltalk / start: the opening chat and the agreement to log the measurements
 *  - a QuestionId: the answer to that question
 *  - confirm: the reply to the first read-back (here a "No" that carries a correction)
 *  - correction: a stand-alone correction line (unused by the shipped scripts, available for variants)
 *  - confirm2: the final "Yes" after the corrected read-back
 */
export type DemoLine = {
  say: string;
  expect: "smalltalk" | "start" | QuestionId | "confirm" | "correction" | "confirm2";
};

export type DemoScript = {
  language: Lang;
  /** the expected FINAL stored values after the whole script has been played */
  values: Partial<Record<KpiKey, MeasurementValue>>;
  lines: DemoLine[];
};

export const DEMO_SCRIPTS: Record<Lang, DemoScript> = {
  en: DEMO_SCRIPT_EN,
  mn: DEMO_SCRIPT_MN,
};
