/** What electron/preload.cjs gives the pet page (src/app/pet) as `window.cosmoPet`; absent in a normal browser tab. */
export interface CosmoPetBridge {
  resize(w: number, h: number): void;
  openDashboard(path: string): void;
  moveBy(dx: number): void;
  goTo(frac: number): void;
  /** each on* returns its unsubscribe */
  onDir(cb: (d: number) => void): () => void;
  onMoving(cb: (m: boolean) => void): () => void;
  showMenu(info: PetMenuInfo): void;
  onAction(cb: (action: string) => void): () => void;
}

/** the right-click menu (built in the main process): what the page knows, and the labels in its language */
export interface PetMenuInfo {
  crew: { id: string; name: string }[];
  current: string | null;
  active: boolean;
  typing: boolean;
  camera: boolean;
  canDashboard: boolean;
  labels: Record<"talk" | "stop" | "write" | "camera" | "dashboard" | "profile" | "noProfiles" | "quit", string>;
}

declare global {
  interface Window {
    cosmoPet?: CosmoPetBridge;
  }
}
