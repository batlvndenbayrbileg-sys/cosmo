import { HELP_STEP, SOURCE, defineGuide } from "./common";

/** St John Ambulance "Burns and scalds" */
export const BURNS = defineGuide({
  id: "burns",
  icon: "flame",
  title: { en: "Burns and scalds", mn: "Түлэгдэлт" },
  summary: { en: "Heat, steam or hot liquid", mn: "Халуун зүйл, уур, халуун шингэн" },
  context: {
    en: "On the station there is no running tap, so follow the station's procedure for cooling a burn. These are the lay steps used on Earth.",
    mn: "Станц дээр урсгал усны цорго байхгүй тул түлэгдэлтийг хөргөх станцын журмыг дагаарай. Эдгээр нь Дэлхий дээр хэрэглэдэг энгийн алхмууд юм.",
  },
  triggers: {
    en: ["burned", "burnt", "got a burn", "bad burn", "scald", "on fire"],
    mn: ["түлэгд", "түлэнх", "халуун ус асга", "буцалсан ус"],
  },
  steps: [
    HELP_STEP,
    {
      art: "cool-water",
      text: {
        en: "Cool the burn under cool running water for at least 20 minutes, or until the pain feels better.",
        mn: "Түлэгдсэн хэсгийг сэрүүн урсгал усан дор дор хаяж 20 минут, эсвэл өвдөлт намдах хүртэл хөргө.",
      },
    },
    {
      art: "remove-rings",
      text: {
        en: "Take off rings, watches and clothing near the burn before it swells, unless they are stuck to the skin.",
        mn: "Хавдахаас өмнө түлэгдсэн хэсгийн ойролцоох бөгж, цаг, хувцсыг авч хая, гэхдээ арьсанд наалдсан бол бүү хөдөлгө.",
      },
    },
    {
      art: "cover-burn",
      text: {
        en: "Once cooled, cover it loosely with cling film or a clean plastic bag. Do not wrap it tightly.",
        mn: "Хөргөсний дараа хүнсний нимгэн хальс эсвэл цэвэр гялгар уутаар сул хучаарай. Чанга ороож болохгүй.",
      },
    },
    {
      art: "no-ice",
      text: {
        en: "Do not use ice, creams or gels, and do not burst blisters.",
        mn: "Мөс, тос, гель бүү хэрэглэ, цэврүүг бүү хагал.",
      },
    },
    {
      art: "watch",
      text: {
        en: "Stay with them and keep watching how they are until help arrives.",
        mn: "Тусламж ирэх хүртэл хажууд нь байж, биеийн байдлыг нь ажигласаар бай.",
      },
    },
  ],
  sources: [SOURCE.burns],
});
