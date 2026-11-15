import { describe, expect, it } from "vitest";
import {
  handsFreeAllowed,
  listeningPillMode,
  pillQuoteSource,
  quoteForPill,
  type ListeningPillInput,
} from "@/components/checkin/listening";
import { checkInReducer, initialCheckInState } from "@/components/checkin/state";

const idle: ListeningPillInput = { recording: false, heard: false, busy: false, speech: "idle", transcribing: false };

describe("listeningPillMode: the person always sees what happens with their voice", () => {
  it("shows nothing when nothing is going on", () => {
    expect(listeningPillMode(idle)).toBeNull();
  });

  it("listening while the mic waits, 'heard' (with Done) once the person speaks", () => {
    expect(listeningPillMode({ ...idle, recording: true })).toBe("listening");
    expect(listeningPillMode({ ...idle, recording: true, heard: true })).toBe("heard");
  });

  it("no listening sign under Cosmo's own voice (barge-in recording), but 'heard' when the person talks over her", () => {
    expect(listeningPillMode({ ...idle, recording: true, speech: "playing" })).toBeNull();
    expect(listeningPillMode({ ...idle, recording: true, heard: true, speech: "playing" })).toBe("heard");
  });

  it("the moment the utterance is sent it says 'writing it down', then 'thinking' until Cosmo's voice plays", () => {
    expect(listeningPillMode({ ...idle, busy: true, transcribing: true })).toBe("writing");
    expect(listeningPillMode({ ...idle, busy: true })).toBe("thinking");
    expect(listeningPillMode({ ...idle, speech: "loading" })).toBe("thinking");
    expect(listeningPillMode({ ...idle, speech: "playing" })).toBeNull();
  });

  it("follows the reducer: the recording ends and the send starts in the same tick, so there is no blank moment", () => {
    let s = checkInReducer(initialCheckInState(), { type: "RECORDING", recording: true });
    s = checkInReducer(s, { type: "RECORDING", recording: false });
    s = checkInReducer(s, { type: "SEND_START" }); // useRecorder publishes both in one onstop tick
    const transcribing = s.pendingCrew?.source === "voice" && s.pendingCrew.text === "";
    expect(listeningPillMode({ recording: s.recording, heard: false, busy: s.busy, speech: s.speech, transcribing })).toBe(
      "writing",
    );
  });
});

describe("quoteForPill", () => {
  it("returns short words unchanged and nothing for empty text", () => {
    expect(quoteForPill("8 цаг унтсан")).toBe("8 цаг унтсан");
    expect(quoteForPill("   ")).toBeNull();
    expect(quoteForPill(null)).toBeNull();
  });

  it("shortens long words at a word boundary with an ellipsis", () => {
    const q = quoteForPill("I slept about seven hours but I woke up twice because the station was noisy", 40);
    expect(q).not.toBeNull();
    expect(q!.length).toBeLessThanOrEqual(40);
    expect(q!.endsWith("…")).toBe(true);
    expect(q).toBe("I slept about seven hours but I woke up…");
  });
});

describe("handsFreeAllowed: the barge-in recording becomes normal listening only when hands-free listening may go on", () => {
  const ok = {
    conversationMode: true,
    micUsable: true,
    ready: true,
    canTalk: true,
    keyboardOpen: false,
    blocked: false,
    finished: false,
    busy: false,
    demoRunning: false,
  };

  it("allows it in an ordinary hands-free check-in", () => {
    expect(handsFreeAllowed(ok)).toBe(true);
  });

  it("not with the text field open, hands-free off, a finished check-in, a demo, a blocked player or a turn in flight", () => {
    expect(handsFreeAllowed({ ...ok, keyboardOpen: true })).toBe(false);
    expect(handsFreeAllowed({ ...ok, conversationMode: false })).toBe(false);
    expect(handsFreeAllowed({ ...ok, finished: true })).toBe(false);
    expect(handsFreeAllowed({ ...ok, demoRunning: true })).toBe(false);
    expect(handsFreeAllowed({ ...ok, blocked: true })).toBe(false);
    expect(handsFreeAllowed({ ...ok, busy: true })).toBe(false);
    expect(handsFreeAllowed({ ...ok, micUsable: false })).toBe(false);
    expect(handsFreeAllowed({ ...ok, canTalk: false })).toBe(false);
    expect(handsFreeAllowed({ ...ok, ready: false })).toBe(false);
  });
});

describe("pillQuoteSource: the pill quotes the words of the turn in flight", () => {
  it("typed text in flight wins over an older crew line at the end of the transcript", () => {
    expect(pillQuoteSource({ text: "how much water should I drink?" }, { speaker: "crew", text: "8 hours" })).toBe(
      "how much water should I drink?",
    );
  });

  it("a voice turn still being transcribed quotes nothing; once transcribed, its line is quoted", () => {
    expect(pillQuoteSource({ text: "" }, { speaker: "crew", text: "an older line" })).toBeNull();
    expect(pillQuoteSource(null, { speaker: "crew", text: "1.5 литр" })).toBe("1.5 литр");
  });

  it("never quotes Cosmo's own words", () => {
    expect(pillQuoteSource(null, { speaker: "cosmo", text: "How did you sleep?" })).toBeNull();
    expect(pillQuoteSource(null, null)).toBeNull();
  });
});
