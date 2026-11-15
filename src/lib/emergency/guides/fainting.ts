import { HELP_STEP, SOURCE, defineGuide } from "./common";

/** St John Ambulance "Fainting"; the recovery-position line is from its CPR page */
export const FAINTING = defineGuide({
  id: "fainting",
  icon: "person",
  title: { en: "Fainting or feeling faint", mn: "Ухаан алдах, муужрах" },
  summary: { en: "Collapsed, dizzy, pale or sweaty", mn: "Унасан, толгой эргэсэн, цайсан, хөлөрсөн" },
  context: {
    en: "After landing, or after a long time in weightlessness, the body is not used to gravity, so standing up can make a person feel faint. Sit or lie down at the first sign and stand up slowly.",
    mn: "Газардсаны дараа, эсвэл удаан хугацаанд жингүйдэлд байсны дараа бие хүндийн хүчинд дасаагүй байдаг тул босоход муужирч болно. Анхны шинж илэрмэгц сууж эсвэл хэвтээд, аажмаар бос.",
  },
  triggers: {
    en: ["fainted", "faint", "passed out", "blacked out", "unconscious", "collapsed"],
    mn: ["ухаан алд", "ухаан балар", "ухаан балр", "ухаангүй", "муужир", "унаж ухаан"],
  },
  steps: [
    HELP_STEP,
    {
      art: "lying",
      text: {
        en: "Help them lie down on their back.",
        mn: "Нуруугаараа хэвтэхэд нь туслаарай.",
      },
    },
    {
      art: "legs-raised",
      text: {
        en: "Raise their legs a little on something soft. Give them fresh air and ask others to step back.",
        mn: "Хөлийг нь зөөлөн зүйл дээр бага зэрэг өргөж тавь. Цэвэр агаар оруулж, бусдыг холдохыг хүс.",
      },
    },
    {
      art: "sit-up",
      text: {
        en: "Reassure them. When they feel better, help them sit up slowly over a few minutes.",
        mn: "Тайвшруулж, урам өг. Биеэ сайжирсан гэвэл хэдэн минутын турш аажмаар суухад нь тусал.",
      },
    },
    {
      art: "recovery",
      link: "not-breathing",
      text: {
        en: "If they stay unresponsive, check their breathing. Breathing normally: turn them on their side in the recovery position. Not breathing normally: start CPR.",
        mn: "Хэрэв ухаан орохгүй бол амьсгалыг нь шалга. Хэвийн амьсгалж байвал: хажуу тийш нь эргүүлж, сэргээх байрлалд хэвтүүл. Хэвийн амьсгалахгүй бол: CPR эхлүүл.",
      },
    },
  ],
  sources: [SOURCE.fainting, SOURCE.cpr],
});
