import { SOURCE, defineGuide } from "./common";

/** adult lay CPR: St John Ambulance "How to do CPR" + American Red Cross "CPR steps" (rate 100-120 a minute) */
export const NOT_BREATHING = defineGuide({
  id: "not-breathing",
  icon: "heart",
  title: { en: "Not breathing: CPR", mn: "Амьсгалахгүй байна: CPR" },
  summary: { en: "No response, no normal breathing", mn: "Хариу өгөхгүй, хэвийн амьсгалгүй" },
  context: {
    en: "On the station, the crew's own CPR procedure decides how to hold the person in place. These are the lay steps used on Earth.",
    mn: "Станц дээр хүнийг хэрхэн бэхлэхийг багийн CPR журам шийднэ. Эдгээр нь Дэлхий дээр хэрэглэдэг энгийн алхмууд юм.",
  },
  triggers: {
    en: [
      "not breathing",
      "isn't breathing",
      "is not breathing",
      "stopped breathing",
      "no pulse",
      "cardiac arrest",
      "needs cpr",
      "start cpr",
    ],
    mn: ["амьсгалахгүй", "амьсгал нь зогс", "амьсгалгүй", "зүрх нь зогс", "амьсгал авахгүй"],
  },
  steps: [
    {
      art: "call",
      text: {
        en: "Shout for help. Ask a crewmate to call the crew medical officer and the flight surgeon and to bring the defibrillator (AED); on Earth, call your local emergency number on speaker.",
        mn: "Чангаар тусламж дууд. Багийн гишүүнээр багийн эмч, нислэгийн эмчид мэдэгдүүлж, дефибриллятор (AED) авчруул; Дэлхий дээр бол яаралтай тусламжийн дугаарт утсаа чанга яригчаар залга.",
      },
    },
    {
      art: "check-breathing",
      text: {
        en: "Shake their shoulders and ask loudly if they are all right. Tilt the head back, lift the chin, and look and listen for normal breathing for up to 10 seconds.",
        mn: "Мөрнөөс нь зөөлөн сэгсэрч, зүгээр үү гэж чангаар асуу. Толгойг нь арагш хазайлгаж, эрүүг нь өргөөд, 10 секунд хүртэл хэвийн амьсгалж байгааг харж, чагна.",
      },
    },
    {
      art: "hands-chest",
      text: {
        en: "Kneel beside them on a firm surface. Put the heel of one hand on the centre of the chest and the other hand on top.",
        mn: "Хатуу гадаргуу дээр хажууд нь өвдөг сөгд. Нэг гарынхаа алгын ёроолыг цээжний голд тавьж, нөгөө гараа дээр нь давхарла.",
      },
    },
    {
      art: "compressions",
      metronome: true,
      text: {
        en: "Push hard and fast, 5 to 6 cm deep, 100 to 120 times a minute. Let the chest come back up after each push.",
        mn: "Хүчтэй, хурдан, 5-6 см гүн, минутад 100-120 удаа дар. Дарах бүрийн дараа цээжийг буцаж өргөгдөхийг хүлээ.",
      },
    },
    {
      art: "compressions",
      metronome: true,
      text: {
        en: "If you are trained, give 2 rescue breaths after every 30 pushes. If not, keep pushing without stopping.",
        mn: "Хэрэв сурсан бол 30 удаа дарсны дараа 2 удаа амьсгал үлээ. Сураагүй бол зогсолтгүй дарсаар бай.",
      },
    },
    {
      art: "aed",
      text: {
        en: "As soon as the defibrillator arrives, switch it on and follow its voice. Keep pushing until it tells you to stop.",
        mn: "Дефибриллятор ирмэгц асаагаад, түүний дуут зааврыг дага. Зогс гэж хэлэх хүртэл дарсаар бай.",
      },
    },
    {
      art: "compressions",
      metronome: true,
      text: {
        en: "Keep going until help takes over or they start breathing normally. Swap with a helper every 1 to 2 minutes.",
        mn: "Тусламж ирж орлох хүртэл эсвэл хэвийн амьсгалж эхлэх хүртэл үргэлжлүүл. Туслагчтайгаа 1-2 минут тутам солигд.",
      },
    },
  ],
  sources: [SOURCE.cpr, SOURCE.redCrossCpr],
});
