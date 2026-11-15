import { HELP_STEP, SOURCE, defineGuide } from "./common";

/** St John Ambulance "Seizures" */
export const SEIZURE = defineGuide({
  id: "seizure",
  icon: "zap",
  title: { en: "Seizure", mn: "Таталт" },
  summary: { en: "Jerking, stiff body, not responding", mn: "Чичирч татах, бие хөших, хариу өгөхгүй" },
  triggers: {
    en: ["seizure", "having a fit", "convulsing", "convulsion", "fitting"],
    mn: ["таталт", "таталда", "татаад байна", "уналт өг", "уналтаар"],
  },
  steps: [
    HELP_STEP,
    {
      art: "clear-space",
      text: {
        en: "Note the time it started. Move hard or sharp things away and ask others to step back.",
        mn: "Эхэлсэн цагийг тэмдэглэ. Хатуу, хурц зүйлсийг холдуулж, бусдыг холдохыг хүс.",
      },
    },
    {
      art: "cushion-head",
      text: {
        en: "Put something soft under their head and loosen clothing around the neck.",
        mn: "Толгойн доор нь зөөлөн зүйл тавьж, хүзүүний орчмын хувцсыг сулла.",
      },
    },
    {
      art: "hands-off",
      text: {
        en: "Do not hold them down, and do not put anything in their mouth.",
        mn: "Хүчээр бүү барь, аманд нь юу ч бүү хий.",
      },
    },
    {
      art: "recovery",
      text: {
        en: "When the jerking stops, check their breathing. If they are breathing, turn them on their side in the recovery position.",
        mn: "Татал зогсмогц амьсгалыг нь шалга. Амьсгалж байвал хажуу тийш нь эргүүлж, сэргээх байрлалд хэвтүүл.",
      },
    },
    {
      art: "timer",
      link: "not-breathing",
      text: {
        en: "Stay with them until they are fully awake, and tell the medical officer how long it lasted. It is urgent if it lasts more than 5 minutes, if it is their first seizure, or if they are not breathing normally.",
        mn: "Бүрэн сэртлээ хажууд нь байж, хэр удаан үргэлжилснийг багийн эмчид хэл. Хэрэв 5 минутаас удаан үргэлжилсэн, анх удаагийн таталт, эсвэл хэвийн амьсгалахгүй бол яаралтай.",
      },
    },
  ],
  sources: [SOURCE.seizure],
});
