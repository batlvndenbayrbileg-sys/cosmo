/**
 * NASA Human Research Program (HRP) sources.
 *
 * Fetched on 2026-11-14 from the three pages listed in NASA_SOURCES (WebFetch, then re-checked
 * against the raw HTML with curl). English hazard NAMES are the names used on
 * https://www.nasa.gov/hrp/hazards/ ("5 Hazards of Human Spaceflight"). The one-line summaries
 * are our own paraphrases (max 25 words), not copied text. Mongolian names/summaries are our
 * renderings (workbook wording for gravity, closed environment, isolation) and need native review.
 *
 * Hazard links to the indicators are suggested, not official NASA mappings.
 * None of the three pages states an Earth-Mars communication delay (see MARS_COMM_DELAY).
 */
import type { Bilingual, HazardKey } from "../types";

export interface NasaHazard {
  name: Bilingual;
  /** paraphrased, at most 25 words per language */
  summary: Bilingual;
  url: string;
  /** true only when the EN name and summary were taken from a page that was actually fetched */
  verified: boolean;
}

const HAZARDS_URL = "https://www.nasa.gov/hrp/hazards/";
const RISKS_URL = "https://www.nasa.gov/hrp/risks/";
const RESEARCH_URL = "https://www.nasa.gov/hrp/ongoing-hrp-research/";

export const NASA_HAZARDS: Record<HazardKey, NasaHazard> = {
  radiation: {
    name: { en: "Space Radiation", mn: "Сансрын цацраг" },
    summary: {
      en: "Radiation that cannot be seen ranks among the most serious threats to crews in space.",
      mn: "Нүдэнд харагддаггүй цацраг нь сансар дахь багийнханд учрах хамгийн ноцтой аюулын нэг юм.",
    },
    url: HAZARDS_URL,
    verified: true,
  },
  isolation_confinement: {
    name: { en: "Isolation and Confinement", mn: "Тусгаарлалт ба хязгаарлалт" },
    summary: {
      en: "Living in tight quarters, far from home, for a long time can change how crew members feel and behave.",
      mn: "Явцуу орчинд, гэрээсээ хол удаан байх нь багийн гишүүдийн сэтгэл санаа, зан байдалд нөлөөлж болно.",
    },
    url: HAZARDS_URL,
    verified: true,
  },
  distance_from_earth: {
    name: { en: "Distance from Earth", mn: "Дэлхийгээс алслагдсан байдал" },
    summary: {
      en: "The farther a crew travels, the harder it is to get supplies, guidance from the ground and medical help.",
      mn: "Дэлхийгээс хол явах тусам хангамж, чиглэл, эмнэлгийн тусламж авах нь улам хэцүү болно.",
    },
    url: HAZARDS_URL,
    verified: true,
  },
  gravity: {
    name: { en: "Gravity Fields", mn: "Таталцал" },
    summary: {
      en: "The body has to adapt to different levels of gravity, in space and again after returning to Earth.",
      mn: "Бие нь сансар дахь болон Дэлхийд буцаж ирсний дараах өөр өөр таталцалд дасан зохицох хэрэгтэй.",
    },
    url: HAZARDS_URL,
    verified: true,
  },
  hostile_closed_environment: {
    name: { en: "Hostile/Closed Environments", mn: "Хаалттай орчин" },
    summary: {
      en: "Keeping a spacecraft's temperature, pressure, lighting, noise and microbes under control is a constant challenge.",
      mn: "Сансрын хөлгийн температур, даралт, гэрэлтүүлэг, дуу чимээ, нян бичил биетнийг хяналтдаа байлгах нь байнгын сорилт юм.",
    },
    url: HAZARDS_URL,
    verified: true,
  },
};

export interface NasaSource {
  title: string;
  url: string;
  fetchedOn: string;
  ok: boolean;
}

export const NASA_SOURCES: NasaSource[] = [
  { title: "5 Hazards of Human Spaceflight - NASA", url: HAZARDS_URL, fetchedOn: "2026-11-14", ok: true },
  { title: "Risks of Human Spaceflight - NASA", url: RISKS_URL, fetchedOn: "2026-11-14", ok: true },
  { title: "Ongoing HRP Research - NASA", url: RESEARCH_URL, fetchedOn: "2026-11-14", ok: true },
];

/**
 * Earth-Mars communication delay. NONE of the three NASA HRP pages states a figure, so this is
 * null and unverified: the UI must not present "20 min" (workbook R-30) as a NASA number.
 */
export const MARS_COMM_DELAY: { minutes: number | null; note: string; verified: boolean } = {
  minutes: null,
  note: "Not stated on the NASA HRP hazards, risks or ongoing-research pages (checked 2026-11-14). The Live / 3 min / 20 min link selector is a simulation setting, not a NASA figure.",
  verified: false,
};
