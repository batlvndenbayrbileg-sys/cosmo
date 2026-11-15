import { describe, expect, it } from "vitest";
import { detectPetPlatform, pickPetDownloads, safeDownloadUrl } from "@/lib/pet/download";
import { explainLines } from "@/lib/pet/explain";
import { petCrewParam } from "@/lib/pet/link";
import { RUN_FPS, RUN_FRAME_COUNT, RUN_FRAMES, runFrameAt } from "@/lib/pet/sprite";
import type { ExplainEvent } from "@/lib/explain";

const EXE = "https://files.example.org/lil-cosmo.exe";
const DMG = "https://files.example.org/lil-cosmo.dmg";

const WIN_CHROME = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36";
const MAC_SAFARI = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.0 Safari/605.1.15";
const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148";
const LINUX = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36";
const ANDROID = "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Mobile Safari/537.36";

describe("lil cosmo download: which computer", () => {
  it("recognises Windows and macOS", () => {
    expect(detectPetPlatform({ userAgent: WIN_CHROME, platform: "Win32" })).toBe("windows");
    expect(detectPetPlatform({ uaPlatform: "Windows" })).toBe("windows");
    expect(detectPetPlatform({ userAgent: MAC_SAFARI, platform: "MacIntel", maxTouchPoints: 0 })).toBe("mac");
    expect(detectPetPlatform({ uaPlatform: "macOS" })).toBe("mac");
  });

  it("counts phones, iPads (which claim to be a Mac), Linux and unknown as other", () => {
    expect(detectPetPlatform({ userAgent: IPHONE, platform: "iPhone", maxTouchPoints: 5 })).toBe("other");
    expect(detectPetPlatform({ userAgent: MAC_SAFARI, platform: "MacIntel", maxTouchPoints: 5 })).toBe("other");
    expect(detectPetPlatform({ userAgent: ANDROID, platform: "Linux armv81", uaPlatform: "Android" })).toBe("other");
    expect(detectPetPlatform({ userAgent: LINUX, platform: "Linux x86_64" })).toBe("other");
    expect(detectPetPlatform({})).toBe("other");
  });
});

describe("lil cosmo download: which file", () => {
  it("offers this computer's build first and the other one as a side link", () => {
    expect(pickPetDownloads({ windows: EXE, mac: DMG }, "windows")).toEqual({
      primary: { platform: "windows", url: EXE },
      others: [{ platform: "mac", url: DMG }],
    });
    expect(pickPetDownloads({ windows: EXE, mac: DMG }, "mac")).toEqual({
      primary: { platform: "mac", url: DMG },
      others: [{ platform: "windows", url: EXE }],
    });
  });

  it("never gives a Mac the .exe as its own download", () => {
    expect(pickPetDownloads({ windows: EXE, mac: null }, "mac")).toEqual({
      primary: null,
      others: [{ platform: "windows", url: EXE }],
    });
  });

  it("has nothing to offer when no build is configured (the button says 'coming soon')", () => {
    for (const platform of ["windows", "mac", "other"] as const) {
      expect(pickPetDownloads({ windows: undefined, mac: "" }, platform)).toEqual({ primary: null, others: [] });
      expect(pickPetDownloads({ windows: "javascript:alert(1)", mac: "   " }, platform)).toEqual({ primary: null, others: [] });
    }
  });

  it("accepts https, a file of this site, and http on this computer only", () => {
    expect(safeDownloadUrl(` ${EXE} `)).toBe(EXE);
    expect(safeDownloadUrl("/lil-cosmo.exe")).toBe("/lil-cosmo.exe");
    expect(safeDownloadUrl("http://localhost:3000/lil-cosmo.exe")).toBe("http://localhost:3000/lil-cosmo.exe");
    for (const bad of ["http://files.example.org/x.exe", "//evil.example/x.exe", "/\\evil", "data:text/html,x", "ftp://x/y", "https://u:p@x.example/y", "lil-cosmo.exe", undefined, null, ""]) {
      expect(safeDownloadUrl(bad), String(bad)).toBeNull();
    }
  });
});

describe("lil cosmo page: ?crew=", () => {
  it("takes one plain id, or none (she sleeps)", () => {
    expect(petCrewParam("bat")).toBe("bat");
    expect(petCrewParam(undefined)).toBeNull();
    expect(petCrewParam(["bat", "mira"])).toBeNull();
    expect(petCrewParam("../api")).toBeNull();
    expect(petCrewParam("")).toBeNull();
  });
});

describe("lil cosmo run sprite timing", () => {
  it("has 12 frames, in order", () => {
    expect(RUN_FRAMES).toHaveLength(RUN_FRAME_COUNT);
    expect(RUN_FRAMES[0]).toBe("/mascot/run/run-01.png");
    expect(RUN_FRAMES[11]).toBe("/mascot/run/run-12.png");
  });

  it("picks the frame from the time since the run began, so slow frames never shift the stride", () => {
    const frameMs = 1000 / RUN_FPS;
    expect(runFrameAt(0)).toBe(0);
    expect(runFrameAt(frameMs - 1)).toBe(0);
    expect(runFrameAt(frameMs)).toBe(1);
    expect(runFrameAt(frameMs * 11.5)).toBe(11);
    expect(runFrameAt(frameMs * 12)).toBe(0); // the cycle wraps
    // a long hitch (a busy computer) lands where the clock says, not one frame later
    expect(runFrameAt(frameMs * 125)).toBe(125 % 12);
    // one full stride lasts 0.6 s at 20 fps
    expect(runFrameAt(599)).toBe(11);
    expect(runFrameAt(600)).toBe(0);
  });

  it("is safe with odd input and holds still under reduced motion", () => {
    expect(runFrameAt(-50)).toBe(0);
    expect(runFrameAt(Number.NaN)).toBe(0);
    expect(runFrameAt(1000, { fps: 0 })).toBe(0);
    expect(runFrameAt(1234, { fps: 10, count: 4 })).toBe(12 % 4);
    const still = runFrameAt(0, { reducedMotion: true });
    for (const ms of [0, 50, 333, 5000]) expect(runFrameAt(ms, { reducedMotion: true })).toBe(still);
    expect(still).toBeGreaterThan(0); // mid-stride: she visibly runs, without moving
    expect(still).toBeLessThan(RUN_FRAME_COUNT);
  });
});

describe("lil cosmo says a walkthrough out loud", () => {
  it("speaks every beat with its own audio part, then the resume line", () => {
    const explain = {
      type: "explain",
      intent: "today",
      turnId: "t1",
      language: "mn",
      beats: [
        { id: "a", part: 0, caption: "Нойр сайн байна.", panel: {} },
        { id: "b", part: 1, caption: "  ", panel: {} },
        { id: "c", part: 2, caption: "Даралт хэвийн.", panel: {} },
      ],
      resume: { part: 3, text: "Хэдэн цаг унтсан бэ?" },
    } as unknown as ExplainEvent;
    expect(explainLines(explain, "c1")).toEqual([
      { checkInId: "c1", turnId: "t1", language: "mn", part: 0, text: "Нойр сайн байна." },
      { checkInId: "c1", turnId: "t1", language: "mn", part: 2, text: "Даралт хэвийн." },
      { checkInId: "c1", turnId: "t1", language: "mn", part: 3, text: "Хэдэн цаг унтсан бэ?" },
    ]);
    expect(explainLines({ ...explain, resume: null }, "c1")).toHaveLength(2);
  });
});
