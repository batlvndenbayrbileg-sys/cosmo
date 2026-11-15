"use client";

import { use, useSyncExternalStore } from "react";
import { petCrewParam } from "@/lib/pet/link";
import { DesktopPet } from "./DesktopPet";
import { PetPreview } from "./PetPreview";

const subscribeNever = () => () => {};

/**
 * /pet: lil cosmo, the desktop pet (docs/lil-cosmo.md).
 *  - Inside the desktop app (electron/preload.cjs gives the page `window.cosmoPet`): the pet itself, talking as the
 *    crew member in `?crew=` (none: she sleeps until the website's "lil cosmo" button sends someone).
 *  - In a normal browser tab: a preview of her with a short explanation, and nothing is started (no session, no
 *    check-in, no microphone or camera).
 */
export default function PetPage({ searchParams }: { searchParams: Promise<{ crew?: string | string[] }> }) {
  const crewId = petCrewParam(use(searchParams).crew);
  // the server cannot know: render nothing until the client says which one it is
  const inApp = useSyncExternalStore(subscribeNever, () => window.cosmoPet !== undefined, () => null);
  if (inApp === null) return null;
  return inApp ? <DesktopPet crewId={crewId} /> : <PetPreview />;
}
