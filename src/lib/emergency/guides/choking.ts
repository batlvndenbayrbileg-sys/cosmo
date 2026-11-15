import { HELP_STEP, SOURCE, defineGuide, startCprStep } from "./common";

/** St John Ambulance "Choking" (adult): cough it out, hit it out (5 back blows), squeeze it out (5 thrusts) */
export const CHOKING = defineGuide({
  id: "choking",
  icon: "wind",
  title: { en: "Choking", mn: "Хахах" },
  summary: { en: "Cannot breathe, cough or speak", mn: "Амьсгалж, ханиалгаж, ярьж чадахгүй" },
  triggers: {
    en: ["choking", "choked", "something stuck in", "can't swallow", "food stuck"],
    mn: ["хахаж", "хахсан", "хахлаа", "хахчихлаа", "хоолой нь бөглөр", "хоолойд гацс", "хоолойд тээгл"],
  },
  steps: [
    HELP_STEP,
    {
      art: "cough",
      text: {
        en: "Ask if they are choking. If they can cough, tell them to keep coughing.",
        mn: "Хахаж байна уу гэж асуу. Ханиалгаж чадаж байвал ханиалгасаар байхыг хэл.",
      },
    },
    {
      art: "back-blows",
      text: {
        en: "If they cannot cough, breathe or speak, help them lean forward. Give up to 5 sharp blows between the shoulder blades with the heel of your hand.",
        mn: "Ханиалгаж, амьсгалж, ярьж чадахгүй бол урагш бөхийхөд нь тусал. Алгын ёроолоороо далны завсар 5 хүртэл удаа хүчтэй цохи.",
      },
    },
    {
      art: "abdominal-thrusts",
      text: {
        en: "Still blocked: stand behind them and put a fist between the belly button and the bottom of the chest. Hold it with your other hand and pull sharply in and up, up to 5 times.",
        mn: "Бөглөрөл арилахгүй бол: ард нь зогсоод, нударгаа хүйс болон цээжний доод хэсгийн хооронд тавь. Нөгөө гараараа нударгаа бариад, дотогш, дээш 5 хүртэл удаа огцом тат.",
      },
    },
    {
      art: "back-blows",
      text: {
        en: "Check the mouth after each blow and each pull. Repeat 5 back blows and 5 pulls until help arrives.",
        mn: "Цохилт, татал бүрийн дараа амыг нь шалга. Тусламж ирэх хүртэл 5 цохилт, 5 таталтыг ээлжлэн давт.",
      },
    },
    startCprStep("lying"),
  ],
  sources: [SOURCE.choking],
});
