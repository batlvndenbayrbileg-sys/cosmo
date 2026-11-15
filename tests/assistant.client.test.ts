import { describe, expect, it } from "vitest";
import { checkInReducer, freshCrewLines, initialCheckInState } from "@/components/checkin/state";
import { parseTurnEvent } from "@/components/checkin/sse";
import { checkupButtonState } from "@/components/assistant/AssistantControls";
import type { CheckInCreated } from "@/lib/types";

/** The assistant screen's client state: the mode flag follows the server's switches only, and the button's words. */

const created = (over: Partial<CheckInCreated> = {}): CheckInCreated => ({
  checkInId: "c1",
  state: "GREETING",
  language: "mn",
  greeting: { turnId: "t1", text: "Сайн уу, Сараа!" },
  resumed: false,
  ...over,
});

describe("assistant mode in the client reducer", () => {
  it("starts from the created conversation and changes only on an assistant switch", () => {
    let s = checkInReducer(initialCheckInState(), { type: "CREATED", created: created({ assistant: true }) });
    expect(s.assistant).toBe(true);
    // a check-up state event without the flag leaves it as it was
    s = checkInReducer(s, { type: "TURN_EVENT", event: { type: "state", state: "GREETING", expectedQuestion: null, companion: false } });
    expect(s.assistant).toBe(true);
    s = checkInReducer(s, { type: "TURN_EVENT", event: { type: "state", state: "GREETING", expectedQuestion: null, companion: false, assistant: false } });
    expect(s.assistant).toBe(false);
    s = checkInReducer(s, { type: "TURN_EVENT", event: { type: "state", state: "KPI_CAPTURE", expectedQuestion: null, companion: false, assistant: true } });
    expect(s).toMatchObject({ assistant: true, conversation: "KPI_CAPTURE" });
    // an action is for the screen, not for the reducer
    const same = checkInReducer(s, { type: "TURN_EVENT", event: { type: "action", action: { kind: "assistant" } } });
    expect(same).toEqual(s);
    // the plain check-in screen never turns it on
    expect(checkInReducer(initialCheckInState(), { type: "CREATED", created: created() }).assistant).toBe(false);
  });

  it("the stream reader keeps the mode flag and the actions (and drops malformed ones)", () => {
    const parse = (o: unknown) => parseTurnEvent({ event: "message", data: JSON.stringify(o), id: null });
    expect(parse({ type: "state", state: "KPI_CAPTURE", expectedQuestion: null, companion: false, assistant: true })).toMatchObject({ assistant: true });
    expect(parse({ type: "state", state: "KPI_CAPTURE", expectedQuestion: null })).not.toHaveProperty("assistant");
    expect(parse({ type: "action", action: { kind: "dashboard", checkInId: "c9" } })).toEqual({ type: "action", action: { kind: "dashboard", checkInId: "c9" } });
    expect(parse({ type: "action", action: { kind: "identity", crewId: "mira" } })).toEqual({ type: "action", action: { kind: "identity", crewId: "mira" } });
    expect(parse({ type: "action", action: { kind: "identity", crewId: null } })).toEqual({ type: "action", action: { kind: "identity", crewId: null } });
    expect(parse({ type: "action", action: { kind: "assistant" } })).toEqual({ type: "action", action: { kind: "assistant" } });
    expect(parse({ type: "action", action: { kind: "dashboard" } })).toBeNull();
    expect(parse({ type: "action", action: { kind: "launch" } })).toBeNull();
  });

  it("a resumed conversation's history never reopens an emergency guide; words said now do", () => {
    let s = checkInReducer(initialCheckInState(), { type: "CREATED", created: created({ assistant: true, resumed: true }) });
    s = checkInReducer(s, {
      type: "SNAPSHOT",
      snapshot: {
        checkIn: { id: "c1", state: "GREETING", language: "en", confirmedAt: null },
        measurements: [],
        turns: [
          { id: "h1", speaker: "cosmo", text: "Hi Mira!", language: "en", createdAt: "2026-11-15T08:00:00.000Z" },
          { id: "h2", speaker: "crew", text: "I have chest pain", language: "en", createdAt: "2026-11-15T08:00:01.000Z" },
        ],
      },
    });
    expect(s.transcript.map((l) => [l.id, l.history])).toEqual([["h1", true], ["h2", true]]);
    expect(freshCrewLines(s.transcript, 0)).toEqual([]);
    const before = s.transcript.length;
    s = checkInReducer(s, { type: "SEND_START", text: "I have chest pain again" });
    s = checkInReducer(s, { type: "TURN_EVENT", event: { type: "transcript", turnId: "n1", text: "I have chest pain again", language: "en" } });
    expect(freshCrewLines(s.transcript, before).map((l) => l.text)).toEqual(["I have chest pain again"]);
  });

  it("the button says start, continue or results from where the check-up stands", () => {
    expect(checkupButtonState(null)).toBe("start");
    expect(checkupButtonState("GREETING")).toBe("start");
    expect(checkupButtonState("SMALL_TALK")).toBe("continue");
    expect(checkupButtonState("KPI_CAPTURE")).toBe("continue");
    expect(checkupButtonState("CONFIRM")).toBe("continue");
    expect(checkupButtonState("DONE")).toBe("done");
  });
});
