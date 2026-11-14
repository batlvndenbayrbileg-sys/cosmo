/**
 * The "Cosmo looks at you" choice (camera face following), remembered per browser in localStorage.
 *
 * OFF unless the person turned it on here before. Only the on/off choice is stored, never anything from
 * the camera. Storage can be missing or throw (private window, blocked site data, server render): reads
 * then fall back to the choice made in this tab, writes still take effect for this tab. Pure apart from
 * the injected storage getter; unit-tested in tests/face-follow.test.ts.
 */

export const FACE_FOLLOW_STORAGE_KEY = "aegis.cosmo.faceFollow";

export type StorageLike = Pick<Storage, "getItem" | "setItem">;

export interface FaceFollowPref {
  /** current choice; false by default */
  read(): boolean;
  write(on: boolean): void;
  /** for useSyncExternalStore: called after every write */
  subscribe(onChange: () => void): () => void;
}

export function parseFaceFollow(raw: string | null | undefined): boolean {
  return raw === "1" || raw === "true";
}

export function createFaceFollowPref(getStorage: () => StorageLike | null | undefined): FaceFollowPref {
  /** the choice made in this tab, used when storage is unavailable */
  let memory: boolean | null = null;
  const listeners = new Set<() => void>();

  const storage = (): StorageLike | null => {
    try {
      return getStorage() ?? null;
    } catch {
      return null;
    }
  };

  return {
    read() {
      try {
        const s = storage();
        const raw = s ? s.getItem(FACE_FOLLOW_STORAGE_KEY) : null;
        if (raw !== null) return parseFaceFollow(raw);
      } catch {
        // fall through to this tab's choice
      }
      return memory ?? false;
    },
    write(on) {
      memory = on;
      try {
        storage()?.setItem(FACE_FOLLOW_STORAGE_KEY, on ? "1" : "0");
      } catch {
        // storage full or blocked: the choice still holds for this tab
      }
      for (const l of [...listeners]) l();
    },
    subscribe(onChange) {
      listeners.add(onChange);
      return () => {
        listeners.delete(onChange);
      };
    },
  };
}

/** the app's instance, backed by window.localStorage */
export const faceFollowPref: FaceFollowPref = createFaceFollowPref(() =>
  typeof window === "undefined" ? null : window.localStorage,
);
