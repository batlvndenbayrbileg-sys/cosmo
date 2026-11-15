// lil cosmo: the only bridge between the pet page (src/app/pet) and the main process. Runs sandboxed with context
// isolation: the page gets `window.cosmoPet` with these fixed calls and nothing else (no ipcRenderer, no Node).
"use strict";

const { contextBridge, ipcRenderer } = require("electron");

/** subscribe to a main-process message; returns the unsubscribe (React effects run twice in dev and must clean up) */
function on(channel, cb) {
  if (typeof cb !== "function") return () => {};
  const listener = (_e, v) => cb(v);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

const num = (v) => typeof v === "number" && Number.isFinite(v);

contextBridge.exposeInMainWorld("cosmoPet", {
  resize: (w, h) => num(w) && num(h) && ipcRenderer.send("pet:resize", w, h),
  moveBy: (dx) => num(dx) && ipcRenderer.send("pet:move", dx),
  goTo: (frac) => num(frac) && ipcRenderer.send("pet:goto", frac),
  onDir: (cb) => on("pet:dir", cb),
  onMoving: (cb) => on("pet:moving", cb),
  openDashboard: (path) => typeof path === "string" && ipcRenderer.send("pet:dashboard", path),
  showMenu: (info) => typeof info === "object" && info !== null && ipcRenderer.send("pet:menu", info),
  onAction: (cb) => on("pet:action", cb),
});
