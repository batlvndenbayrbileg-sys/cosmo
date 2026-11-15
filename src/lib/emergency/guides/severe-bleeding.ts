import { HELP_STEP, SOURCE, defineGuide } from "./common";

/** St John Ambulance "Severe bleeding" */
export const SEVERE_BLEEDING = defineGuide({
  id: "severe-bleeding",
  icon: "drop",
  title: { en: "Severe bleeding", mn: "Их хэмжээний цус алдалт" },
  summary: { en: "Blood that will not stop", mn: "Зогсохгүй цус гарч байна" },
  triggers: {
    en: ["bleeding a lot", "bleeding heavily", "bleeding badly", "severe bleeding", "lot of blood", "won't stop bleeding", "losing blood"],
    mn: ["цус их гар", "их цус", "цус алдаж", "цус зогсохгүй", "цус шүршиж", "цус гоожи"],
  },
  steps: [
    HELP_STEP,
    {
      art: "press-wound",
      text: {
        en: "Press firmly on the wound with a clean pad or cloth. Wear gloves if you have them.",
        mn: "Цэвэр самбай эсвэл даавуугаар шархан дээр хүчтэй дар. Бээлий байвал өмс.",
      },
    },
    {
      art: "press-sides",
      text: {
        en: "If something is stuck in the wound, do not pull it out. Press on both sides of it instead.",
        mn: "Шарханд ямар нэг зүйл орсон бол сугалж болохгүй. Харин түүний хоёр талаас дар.",
      },
    },
    {
      art: "bandage",
      text: {
        en: "Tie a bandage firmly over the pad to keep the pressure on. It should be firm, but not so tight that it stops the blood flow beyond it.",
        mn: "Даралтыг хадгалахын тулд самбайн дээгүүр боолтыг чанга боо. Чанга боловч цаашаа цусны урсгалыг зогсоохоор хэт чанга байж болохгүй.",
      },
    },
    {
      art: "press-wound",
      text: {
        en: "If blood comes through, take the pad off and press again with a new one.",
        mn: "Цус нэвчиж гарвал самбайг авч, шинэ самбайгаар дахин дар.",
      },
    },
    {
      art: "legs-raised",
      link: "not-breathing",
      text: {
        en: "Help them lie down, raise their legs and keep them warm. If they stop responding and are not breathing normally, start CPR.",
        mn: "Хэвтэхэд нь тусалж, хөлийг нь өргөж, дулаан байлга. Хариу өгөхгүй болж, хэвийн амьсгалахгүй бол CPR эхлүүл.",
      },
    },
  ],
  sources: [SOURCE.bleeding],
});
