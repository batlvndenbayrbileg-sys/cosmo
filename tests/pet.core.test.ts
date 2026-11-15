import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { PET_CREW_ID, petLink } from "@/lib/pet/link";

/** electron/pet-core.cjs: the desktop pet's main-process decisions (plain CommonJS, loaded the way Electron does) */
interface PetCore {
  PROTOCOL: string;
  CREW_ID: RegExp;
  crewFromArg(arg: unknown): string | null;
  crewFromArgs(argv: unknown): string | null;
  normalizeOrigin(raw: unknown): string | null;
  sameOrigin(url: unknown, origin: unknown): boolean;
  petUrl(origin: string, crew: string | null): string;
  dashboardUrl(origin: string, path: unknown): string | null;
  petSize(w: unknown, h: unknown): { w: number; h: number } | null;
  clampFrac(v: unknown): number | null;
  nextSpeed(speed: number, distance: number, accel: number, max: number): number;
  menuLabels(raw: unknown): Record<string, string>;
  menuCrew(raw: unknown): { id: string; name: string }[];
}

const core = createRequire(import.meta.url)("../electron/pet-core.cjs") as PetCore;
const ORIGIN = "https://aegis.example.app";

describe("lil cosmo links (lilcosmo://crew/<id>)", () => {
  it("reads the crew id from a link or --crew=, last valid one wins", () => {
    expect(core.crewFromArg("lilcosmo://crew/bat")).toBe("bat");
    expect(core.crewFromArg("lilcosmo://crew/mira_2/")).toBe("mira_2"); // trailing slash some browsers add
    expect(core.crewFromArg("LILCOSMO://crew/Bat")).toBe("Bat");
    expect(core.crewFromArg("--crew=dorj-1")).toBe("dorj-1");
    expect(core.crewFromArgs(["C:\\lil cosmo.exe", "--crew=bat", "lilcosmo://crew/mira"])).toBe("mira");
    expect(core.crewFromArgs(["electron", "main.cjs"])).toBeNull();
    expect(core.crewFromArgs(undefined)).toBeNull();
  });

  it("refuses anything that is not a plain id", () => {
    for (const bad of [
      "lilcosmo://crew/",
      "lilcosmo://crew/../../etc",
      "lilcosmo://crew/bat?x=1",
      "lilcosmo://crew/bat#x",
      "lilcosmo://crew/bat/extra",
      "lilcosmo://crew/bat%2F..",
      "lilcosmo://crew/<script>",
      "lilcosmo://crew/" + "a".repeat(101),
      "lilcosmo://evil/bat",
      "https://crew/bat",
      "--crew=bat;rm",
      "--crew=",
      "xlilcosmo://crew/bat",
    ]) {
      expect(core.crewFromArg(bad), bad).toBeNull();
    }
    // an invalid later argument does not erase a valid earlier one
    expect(core.crewFromArgs(["lilcosmo://crew/bat", "lilcosmo://crew/../x"])).toBe("bat");
  });

  it("uses the same id rule and link shape as the website's button", () => {
    expect(core.PROTOCOL).toBe("lilcosmo");
    expect(core.CREW_ID.source).toBe(PET_CREW_ID.source);
    for (const id of ["bat", "mira_2", "A-b_9", "x".repeat(100)]) {
      const link = petLink(id);
      expect(link).not.toBeNull();
      expect(core.crewFromArg(link)).toBe(id);
    }
    for (const id of ["", "a b", "a/b", "x".repeat(101), "../x"]) expect(petLink(id)).toBeNull();
  });
});

describe("the website the pet shows", () => {
  it("keeps https origins and local http only", () => {
    expect(core.normalizeOrigin("https://aegis.example.app/some/path?q=1")).toBe(ORIGIN);
    expect(core.normalizeOrigin("http://localhost:3000")).toBe("http://localhost:3000");
    expect(core.normalizeOrigin("http://127.0.0.1:3126/")).toBe("http://127.0.0.1:3126");
    expect(core.normalizeOrigin("http://aegis.example.app")).toBeNull(); // plain http to another computer
    expect(core.normalizeOrigin("file:///C:/x.html")).toBeNull();
    expect(core.normalizeOrigin("javascript:alert(1)")).toBeNull();
    expect(core.normalizeOrigin("https://user:pw@aegis.example.app")).toBeNull();
    expect(core.normalizeOrigin("")).toBeNull();
    expect(core.normalizeOrigin(undefined)).toBeNull();
  });

  it("matches the exact origin, not a look-alike", () => {
    expect(core.sameOrigin(`${ORIGIN}/pet?crew=bat`, ORIGIN)).toBe(true);
    expect(core.sameOrigin("https://aegis.example.app.evil.example/pet", ORIGIN)).toBe(false);
    expect(core.sameOrigin("http://aegis.example.app/pet", ORIGIN)).toBe(false);
    expect(core.sameOrigin("https://evil.example/?u=https://aegis.example.app", ORIGIN)).toBe(false);
    expect(core.sameOrigin("not a url", ORIGIN)).toBe(false);
    expect(core.sameOrigin(undefined, ORIGIN)).toBe(false);
  });

  it("builds the pet page address and only opens dashboards on our own site", () => {
    expect(core.petUrl(ORIGIN, "bat")).toBe(`${ORIGIN}/pet?crew=bat`);
    expect(core.petUrl(ORIGIN, null)).toBe(`${ORIGIN}/pet`);
    expect(core.petUrl(ORIGIN, "a/../b")).toBe(`${ORIGIN}/pet`);
    expect(core.dashboardUrl(ORIGIN, "/dashboard?checkInId=abc")).toBe(`${ORIGIN}/dashboard?checkInId=abc`);
    expect(core.dashboardUrl(ORIGIN, "/dashboard")).toBe(`${ORIGIN}/dashboard`);
    for (const bad of ["//evil.example/dashboard", "/dashboardx", "/dashboard/../api/x", "https://evil.example/dashboard", "/", 42]) {
      expect(core.dashboardUrl(ORIGIN, bad), String(bad)).toBeNull();
    }
  });
});

describe("what the page sends over IPC", () => {
  it("accepts sane window sizes and screen positions only", () => {
    expect(core.petSize(140, 140)).toEqual({ w: 140, h: 140 });
    expect(core.petSize(249.6, 220.2)).toEqual({ w: 250, h: 220 });
    expect(core.petSize(5000, 140)).toBeNull();
    expect(core.petSize(0, 140)).toBeNull();
    expect(core.petSize(Number.NaN, 140)).toBeNull();
    expect(core.petSize("140", 140)).toBeNull();
    expect(core.clampFrac(0.4)).toBe(0.4);
    expect(core.clampFrac(-3)).toBe(0);
    expect(core.clampFrac(7)).toBe(1);
    expect(core.clampFrac(Number.POSITIVE_INFINITY)).toBeNull();
    expect(core.clampFrac("0.5")).toBeNull();
  });

  it("speeds up gently, caps the speed and slows down to stop on the spot", () => {
    const accel = 0.45;
    const max = 7;
    expect(core.nextSpeed(0, 500, accel, max)).toBeCloseTo(0.45);
    expect(core.nextSpeed(6.9, 500, accel, max)).toBe(7);
    // close to the target the speed drops, and a step never overshoots
    expect(core.nextSpeed(7, 3, accel, max)).toBeLessThanOrEqual(3);
    expect(core.nextSpeed(7, -3, accel, max)).toBeLessThanOrEqual(3);
    // run the whole approach: arrives exactly, never moving backwards
    let x = 0;
    let speed = 0;
    for (let i = 0; i < 1000 && Math.abs(300 - x) >= 1; i++) {
      speed = core.nextSpeed(speed, 300 - x, accel, max);
      expect(speed).toBeGreaterThanOrEqual(0);
      x += speed;
      expect(x).toBeLessThanOrEqual(300);
    }
    expect(Math.abs(300 - x)).toBeLessThan(1);
  });

  it("builds the menu from the page's labels and crew list, falling back to English", () => {
    const labels = core.menuLabels({ talk: "Ярих", quit: "", write: 5, camera: "x".repeat(61) });
    expect(labels.talk).toBe("Ярих");
    expect(labels.quit).toBe("Quit lil cosmo");
    expect(labels.write).toBe("Write");
    expect(labels.camera).toBe("Camera (follow me)");
    expect(core.menuLabels(null).talk).toBe("Talk");
    expect(
      core.menuCrew([{ id: "bat", name: "Бат" }, { id: "../x", name: "x" }, { id: "mira", name: "" }, null, { id: "dorj" }]),
    ).toEqual([{ id: "bat", name: "Бат" }]);
    expect(core.menuCrew("nope")).toEqual([]);
  });
});
