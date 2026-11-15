import type { AreaDicts } from "../types";

/**
 * The listening pill on the check-in stage (src/components/checkin/ListeningPill.tsx). Part of the "checkin" area
 * (merged in dictionary.ts), so the keys are prefixed "checkin.listen.".
 */
export const listenStrings: AreaDicts = {
  en: {
    "checkin.listen.listening": "Listening…",
    "checkin.listen.done": "Done",
    "checkin.listen.doneLabel": "I'm done speaking: send it now",
    "checkin.listen.writing": "Got it, writing it down…",
    "checkin.listen.thinking": "Thinking…",
  },
  mn: {
    "checkin.listen.listening": "Сонсож байна…",
    "checkin.listen.done": "Болсон",
    "checkin.listen.doneLabel": "Ярьж дууслаа: одоо илгээх",
    "checkin.listen.writing": "Ойлголоо, бичиж байна…",
    "checkin.listen.thinking": "Бодож байна…",
  },
};
