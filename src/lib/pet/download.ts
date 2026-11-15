/**
 * Which lil cosmo download the website offers (docs/lil-cosmo.md). The builds are ~110 MB and git-ignored, so they
 * are hosted elsewhere and named by two public env vars:
 *   NEXT_PUBLIC_LIL_COSMO_URL      the Windows portable .exe
 *   NEXT_PUBLIC_LIL_COSMO_MAC_URL  the macOS .dmg
 * Unset (or not a usable address): Windows falls back to the build on the project's GitHub Releases
 * (DEFAULT_WINDOWS_PET_URL); macOS has no download and the button says "coming soon" instead of linking to a file that
 * is not there.
 */

export type PetPlatform = "windows" | "mac" | "other";

export interface PetDownload {
  platform: Exclude<PetPlatform, "other">;
  url: string;
}

export interface PetDownloads {
  /** the build for this computer, when there is one */
  primary: PetDownload | null;
  /** the other builds (another computer, or this one is neither Windows nor a Mac) */
  others: PetDownload[];
}

/**
 * The address of a build, or null. https anywhere; http only for this computer (a local build served from public/);
 * a root-relative path ("/lil-cosmo.exe") for a file served by this site. Anything else (javascript:, a typo) is null.
 */
export function safeDownloadUrl(raw: string | undefined | null): string | null {
  const value = raw?.trim();
  if (!value) return null;
  if (value.startsWith("/") && !value.startsWith("//") && !value.includes("\\")) return value;
  try {
    const url = new URL(value);
    if (url.username || url.password) return null;
    if (url.protocol === "https:") return url.href;
    if (url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) return url.href;
  } catch {
    // not an address
  }
  return null;
}

/**
 * This computer, from what the browser says about itself. iPhones and iPads report "Mac" in some fields but cannot run
 * a .dmg, so a touch screen that claims to be a Mac counts as "other"; so do phones, Linux and anything unknown.
 */
export function detectPetPlatform(input: {
  userAgent?: string;
  platform?: string;
  /** navigator.userAgentData.platform (Chromium) */
  uaPlatform?: string;
  maxTouchPoints?: number;
}): PetPlatform {
  const hints = [input.uaPlatform, input.platform, input.userAgent].filter(Boolean).join(" ");
  if (/android|iphone|ipad|ipod/i.test(hints)) return "other";
  if (/win/i.test(hints)) return "windows";
  if (/mac/i.test(hints)) return (input.maxTouchPoints ?? 0) > 1 ? "other" : "mac";
  return "other";
}

/** the downloads to offer on `platform`, given the configured addresses */
export function pickPetDownloads(urls: { windows?: string | null; mac?: string | null }, platform: PetPlatform): PetDownloads {
  const all: PetDownload[] = [];
  const windows = safeDownloadUrl(urls.windows);
  const mac = safeDownloadUrl(urls.mac);
  if (windows) all.push({ platform: "windows", url: windows });
  if (mac) all.push({ platform: "mac", url: mac });
  const primary = all.find((d) => d.platform === platform) ?? null;
  return { primary, others: all.filter((d) => d !== primary) };
}

/**
 * The Windows build published on the project's GitHub Releases ("latest" always points at the newest release, so a new
 * build needs no code change). Used when NEXT_PUBLIC_LIL_COSMO_URL is not set. There is no macOS default: a .dmg can
 * only be built on a Mac, and none is published yet.
 */
export const DEFAULT_WINDOWS_PET_URL = "https://github.com/batlvndenbayrbileg-sys/cosmo/releases/latest/download/lil-cosmo.exe";

/** the configured addresses (inlined at build time: NEXT_PUBLIC_* must be read by their full names) */
export function configuredPetUrls(): { windows: string | null; mac: string | null } {
  return {
    windows: safeDownloadUrl(process.env.NEXT_PUBLIC_LIL_COSMO_URL) ?? DEFAULT_WINDOWS_PET_URL,
    mac: safeDownloadUrl(process.env.NEXT_PUBLIC_LIL_COSMO_MAC_URL),
  };
}
