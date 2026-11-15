import { SOURCE, defineGuide, startCprStep } from "./common";

/**
 * St John Ambulance "Anaphylaxis". The one place the app mentions a medicine: the person's OWN adrenaline
 * auto-injector, as the source says. No dose and no repeat timing (the medical officer decides).
 */
export const ANAPHYLAXIS = defineGuide({
  id: "anaphylaxis",
  icon: "injector",
  title: { en: "Severe allergic reaction", mn: "Харшлын хүнд урвал" },
  summary: { en: "Swelling, wheezing, rash, collapse", mn: "Хавдах, амьсгал шуугих, тууралт, унах" },
  triggers: {
    en: ["anaphyla", "severe allergic", "allergic reaction", "throat is swelling", "throat swelling", "auto-injector"],
    mn: ["анафилакс", "харшлын хүнд", "хүчтэй харшил", "хоолой хавда", "хоолой нь хавда", "харшил хөдөл"],
  },
  steps: [
    {
      art: "call",
      text: {
        en: "Get help now. Call the crew medical officer and the flight surgeon and say you think it is a severe allergic reaction; on Earth, call your local emergency number.",
        mn: "Яг одоо тусламж дууд. Багийн эмч болон нислэгийн эмчид мэдэгдэж, харшлын хүнд урвал байж магадгүй гэж хэл; Дэлхий дээр бол яаралтай тусламжийн дугаарт залга.",
      },
    },
    {
      art: "auto-injector",
      text: {
        en: "If they have their own adrenaline auto-injector, help them use it now, or use it for them, following its instructions.",
        mn: "Хэрэв өөрийн адреналины автомат тариур байвал зааврынх нь дагуу яг одоо хэрэглэхэд нь тусал, эсвэл өөрөө хий.",
      },
    },
    {
      art: "legs-raised",
      text: {
        en: "Help them lie down with their legs raised. If breathing is hard, help them sit up instead.",
        mn: "Хөлийг нь өргөөд хэвтэхэд нь тусал. Амьсгалахад хэцүү байвал харин суулгаарай.",
      },
    },
    {
      art: "watch",
      text: {
        en: "Stay with them and keep watching their breathing and how they respond.",
        mn: "Хажууд нь байж, амьсгал, хариу үйлдлийг нь ажигласаар бай.",
      },
    },
    startCprStep(),
  ],
  sources: [SOURCE.anaphylaxis],
});
