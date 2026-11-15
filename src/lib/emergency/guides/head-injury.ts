import { HELP_STEP, SOURCE, defineGuide } from "./common";

/** St John Ambulance "Head injury" (minor and serious) */
export const HEAD_INJURY = defineGuide({
  id: "head-injury",
  icon: "brain",
  title: { en: "Head injury", mn: "Толгойн гэмтэл" },
  summary: { en: "A blow to the head", mn: "Толгойгоо цохиулсан" },
  triggers: {
    en: ["hit his head", "hit her head", "hit my head", "hit their head", "head injury", "banged his head", "banged my head", "concussion"],
    mn: ["толгойгоо цохи", "толгойгоо гэмтэ", "толгой гэмт", "толгойгоо мөргө", "тархи доргилт", "тархины доргилт"],
  },
  steps: [
    HELP_STEP,
    {
      art: "cold-pack",
      text: {
        en: "If they are awake, help them sit down. Hold something cold, wrapped in a cloth, against the injury.",
        mn: "Ухаантай бол суулгаарай. Даавуунд ороосон хүйтэн зүйлийг гэмтсэн хэсэгт нь тулгаж барь.",
      },
    },
    {
      art: "press-wound",
      text: {
        en: "If there is a wound, press on it with a clean pad.",
        mn: "Шарх байвал цэвэр самбайгаар дарж барь.",
      },
    },
    {
      art: "reassure",
      text: {
        en: "Check how alert they are: are their eyes open, and can they answer simple questions? Stay with them and keep checking.",
        mn: "Хэр сэргэг байгааг шалга: нүдээ нээсэн үү, энгийн асуултад хариулж чадаж байна уу? Хажууд нь байж, шалгасаар бай.",
      },
    },
    {
      art: "watch",
      text: {
        en: "Tell the medical officer at once if they get drowsy or confused, are sick, have a headache that will not go, or double vision.",
        mn: "Нойрмоглох, ухаан самуурах, бөөлжих, намдахгүй толгой өвдөх, эсвэл давхар харагдах бол багийн эмчид даруй хэл.",
      },
    },
    {
      art: "stay-still",
      link: "not-breathing",
      text: {
        en: "If it may be serious, do not move them unless they are in danger, and keep checking their breathing. If they are not breathing normally, start CPR.",
        mn: "Ноцтой байж болзошгүй бол аюулд ороогүй л бол бүү хөдөлгө, амьсгалыг нь шалгасаар бай. Хэвийн амьсгалахгүй бол CPR эхлүүл.",
      },
    },
  ],
  sources: [SOURCE.headInjury],
});
