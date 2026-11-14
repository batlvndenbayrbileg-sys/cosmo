import "server-only";
import type { AlertRow, Bilingual, RedFlagRule, SummaryFindings } from "@/lib/types";
import { insertAlert, listAlerts } from "@/server/db/repos/alert";

/**
 * Alerts for a confirmed check-in (docs/DASHBOARD_PLAN.md section 5): when the overall status is red, one alert per
 * red-flag rule, in calm wording that says "alert" and never claims a diagnosis. Idempotent per (check-in, rule): a
 * second call for the same check-in creates nothing new.
 *
 * The text comes from the red-flag texts computed by code (src/lib/health/flags.ts). None of them quotes the crew
 * member's free text, so the ground role may read alerts without ever seeing a note.
 */

const OVERALL_TEXT: Bilingual = {
  en: "Alert: some readings are in the alert range of the demo parameters. Please tell your crew medical officer; ground is being informed too.",
  mn: "Анхааруулга: зарим заалт демо параметрийн анхааруулах түвшинд байна. Багийн эмнэлгийн офицерт мэдэгдээрэй, газрын хяналтад мөн мэдэгдэнэ.",
};

/**
 * What Cosmo says whenever an alert exists for the check-in: the astronaut is told that the medical officer and ground
 * are informed. The wording equals templates.redFlagNotice (a test keeps the two in step); it is used for an overall
 * red status that has no red-flag rule (low sleep, mood 2), where templates.summarySpeech adds no notice of its own.
 */
export const ALERT_SPOKEN_NOTICE: Bilingual = {
  en: "I've marked this as an alert. Your crew medical officer and ground are being informed, and I'd suggest speaking with the medical officer soon.",
  mn: "Энэ нь анхааруулга. Багийн эмнэлгийн офицер болон газрын хяналтад мэдэгдэж байна, эмнэлгийн офицертойгоо удахгүй ярилцахыг зөвлөе.",
};

/** returns every alert of this check-in that belongs to the red rules (existing and newly created) */
export function createAlertsForCheckIn(crewId: string, checkInId: string, summary: SummaryFindings): AlertRow[] {
  if (summary.overall !== "red") return [];

  const wanted: Array<{ rule: RedFlagRule | "OVERALL"; text: Bilingual }> =
    summary.redFlags.length > 0
      ? summary.redFlags.map((f) => ({ rule: f.rule, text: f.text }))
      : [{ rule: "OVERALL", text: OVERALL_TEXT }];

  // listAlerts is crew-scoped, so another member's alerts can never be matched here
  const existing = listAlerts(crewId).filter((a) => a.checkInId === checkInId);
  const have = new Set<string>(existing.map((a) => a.rule));

  const created: AlertRow[] = [];
  for (const { rule, text } of wanted) {
    if (have.has(rule)) continue;
    have.add(rule);
    created.push(insertAlert(crewId, { checkInId, level: "red", rule, text }));
  }
  const rules = new Set<string>(wanted.map((w) => w.rule));
  return [...existing.filter((a) => rules.has(a.rule)), ...created];
}
