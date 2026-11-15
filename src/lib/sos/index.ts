import type { Bilingual, Lang } from "../types";

/**
 * SOS to Earth: one urgent alert for the ground console, raised only by the crew member's own action (the SOS button)
 * or own words ("tell Earth", "дэлхий рүү мэдэгд", see match.ts), with one still of the face taken by the browser.
 * Shared by the server (src/server/sos.ts, the routes) and the client (src/components/sos). No I/O here.
 */

export type SosReason = "button" | "voice";
export type SosPhotoStatus = "pending" | "attached" | "denied" | "unavailable";
export const SOS_PHOTO_STATUSES: readonly SosPhotoStatus[] = ["pending", "attached", "denied", "unavailable"];

/** a second SOS from the same crew member within this window is the same incident: no second alert */
export const SOS_DEDUP_WINDOW_MS = 30_000;
/** the face still: JPEG, at most this many bytes (the server refuses anything larger) */
export const SOS_PHOTO_MAX_BYTES = 150 * 1024;
/** longest side of the still, in pixels */
export const SOS_PHOTO_MAX_SIDE = 640;
export const SOS_PHOTO_QUALITY = 0.7;
/** how often the Earth console asks for new SOS alerts */
export const SOS_POLL_MS = 3_000;
/**
 * how long the Earth console waits for the face still before saying that none arrived (the permission prompt may
 * wait 30 s, then the capture and the upload). A crew tab closed mid-capture never reports back, and "photo on its
 * way" must not stay on the console for ever.
 */
export const SOS_PHOTO_WAIT_MS = 90_000;

/** what the Earth console shows in place of the photo */
export type GroundPhotoView = "attached" | "pending" | "missing" | "denied" | "unavailable";

/** `asOfMs`: the console's "now" (minus the simulated delay) */
export function groundPhotoView(alert: Pick<SosAlert, "photoStatus" | "createdAt">, asOfMs: number): GroundPhotoView {
  if (alert.photoStatus !== "pending") return alert.photoStatus;
  const raised = Date.parse(alert.createdAt);
  return Number.isFinite(raised) && asOfMs - raised > SOS_PHOTO_WAIT_MS ? "missing" : "pending";
}

/** an SOS alert as its crew member and the ground console see it (never the photo bytes) */
export interface SosAlert {
  id: string;
  crewId: string;
  createdAt: string;
  reason: SosReason;
  /** the trigger words that were heard ("tell Earth"), never the rest of the utterance; null for the button */
  phrase: string | null;
  photoStatus: SosPhotoStatus;
  photoBytes: number | null;
  photoAt: string | null;
  /** when the ground console marked it seen */
  seenAt: string | null;
}

/** the ground console's row: the crew member's name is joined in */
export interface GroundSosAlert extends SosAlert {
  crewName: string;
}

/** POST /api/sos */
export interface SosRaiseResult {
  alert: SosAlert;
  /** true when this press joined an incident raised less than SOS_DEDUP_WINDOW_MS ago */
  duplicate: boolean;
  /** what Cosmo says now; turnId is set when it was stored as a turn of the check-in (its audio route voices it) */
  spoken: { text: string; language: Lang; turnId: string | null };
}

/**
 * What Cosmo says. "sent" and "duplicate" are said only after the server has stored the alert; "failed" when storing
 * it did not work, pointing to the station's own comms.
 */
export const SOS_SPOKEN: Record<"sent" | "duplicate" | "failed", Bilingual> = {
  sent: {
    en: "I've sent an urgent alert to Earth. Your emergency signal is on the ground console now. If the camera allows, I'll send them one photo of your face.",
    mn: "Дэлхий рүү яаралтай мэдэгдэл илгээлээ. Таны яаралтай дохио газрын удирдлагын дэлгэц дээр гарлаа. Камер зөвшөөрвөл нүүрний тань нэг зургийг хамт илгээнэ.",
  },
  duplicate: {
    en: "Earth already has your urgent alert from a moment ago, so I haven't sent a second one. Stay with me.",
    mn: "Таны яаралтай мэдэгдэл саяхан Дэлхийд очсон тул дахин илгээгээгүй. Надтай хамт байгаарай.",
  },
  // worded so that, heard back by the microphone, it is not itself a request to alert Earth (match.ts)
  failed: {
    en: "I couldn't send the alert to Earth. Please use the station's own comms right now to reach the ground.",
    mn: "Дэлхий рүү мэдэгдэл илгээж чадсангүй. Станцын өөрийн холбоог яг одоо ашиглаарай.",
  },
};

export function sosSpoken(kind: keyof typeof SOS_SPOKEN, lang: Lang): string {
  return SOS_SPOKEN[kind][lang];
}

/** JPEG files start with FF D8 FF */
export function looksLikeJpeg(bytes: Uint8Array): boolean {
  return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

export { matchSosRequest } from "./match";
