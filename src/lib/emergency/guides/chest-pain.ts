import { SOURCE, defineGuide, startCprStep } from "./common";

/**
 * St John Ambulance "Heart attack", lay steps only. The source's medicine steps are left out on purpose (the app never
 * names a medicine or a dose): the crew medical officer decides about any medicine.
 */
export const CHEST_PAIN = defineGuide({
  id: "chest-pain",
  icon: "pulse",
  title: { en: "Chest pain", mn: "Цээжний өвдөлт" },
  summary: { en: "Pressing pain, breathless, sweating", mn: "Шахаж өвдөх, амьсгаадах, хөлрөх" },
  triggers: {
    en: ["chest pain", "pain in my chest", "pain in his chest", "pain in her chest", "chest hurts", "heart attack"],
    mn: ["цээж өвд", "цээжээр өвд", "зүрх өвд", "зүрхний шигдээс", "цээж базла"],
  },
  steps: [
    {
      art: "call",
      text: {
        en: "Get help now. Call the crew medical officer and the flight surgeon and tell them about the chest pain; on Earth, call your local emergency number.",
        mn: "Яг одоо тусламж дууд. Багийн эмч болон нислэгийн эмчид мэдэгдэж, цээжний өвдөлтийн тухай хэл; Дэлхий дээр бол яаралтай тусламжийн дугаарт залга.",
      },
    },
    {
      art: "sit-supported",
      text: {
        en: "Help them into a comfortable position: on the floor, knees bent, head and shoulders supported. Cushions behind them or under the knees can help.",
        mn: "Тухтай байрлалд оруулахад нь тусал: шалан дээр, өвдгөө нугалсан, толгой мөрөө түшсэн байдлаар. Ар талд эсвэл өвдөгний доор нь дэр тавьж болно.",
      },
    },
    {
      art: "reassure",
      text: {
        en: "Keep them resting and calm, and stay with them.",
        mn: "Хөдөлгөөнгүй, тайван амраан, хажууд нь байгаарай.",
      },
    },
    {
      art: "watch",
      text: {
        en: "Keep watching their breathing and how they respond until help arrives.",
        mn: "Тусламж ирэх хүртэл амьсгал, хариу үйлдлийг нь ажигласаар бай.",
      },
    },
    startCprStep(),
  ],
  sources: [SOURCE.heartAttack],
});
