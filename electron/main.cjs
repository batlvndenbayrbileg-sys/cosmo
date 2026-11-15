// lil cosmo: a frameless, transparent, always-on-top window showing /pet from the AEGIS website (ORIGIN).
// Cosmo lives on the bottom edge of the screen (just above the taskbar): she only ever moves sideways, either dragged
// by the user or running to where the camera sees them (the page sends "pet:goto"). docs/lil-cosmo.md has the how-to.
//
// Security: the window only ever shows ORIGIN (navigation, redirects and pop-ups elsewhere are refused; links to
// other sites open in the normal browser), runs sandboxed with context isolation and no Node in the page, answers
// IPC only from ORIGIN, grants camera / microphone only to ORIGIN, and accepts `lilcosmo://crew/<id>` links only with
// a plain crew id (electron/pet-core.cjs, tested in tests/pet.core.test.ts).
"use strict";

const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
const { app, BrowserWindow, Menu, Tray, nativeImage, session, ipcMain, screen, shell, systemPreferences } = require("electron");
const core = require("./pet-core.cjs");

const MAC = process.platform === "darwin";
const DEFAULT_ORIGIN = "http://localhost:3000";
const TICK_MS = 16; // ~60 fps movement
const MAX_SPEED = 7; // px per tick at full run (~440 px/s)
const ACCEL = 0.45; // px per tick, per tick

// The website to show: COSMO_ORIGIN, else the "cosmoOrigin" baked into package.json at build time
// (`pnpm pet:build -c.extraMetadata.cosmoOrigin=https://<site>`), else the local dev server.
const configured = process.env.COSMO_ORIGIN || require("../package.json").cosmoOrigin || DEFAULT_ORIGIN;
const ORIGIN = core.normalizeOrigin(configured);

// its own name and profile folder (not "aegis" from package.json), so the single-instance lock and cookies are ours
app.setName("lil cosmo");
app.setPath("userData", path.join(app.getPath("appData"), "lil cosmo"));

// one pet only: a second launch (another profile's button) switches the running pet to that profile
const firstInstance = ORIGIN !== null && app.requestSingleInstanceLock();
if (ORIGIN === null) {
  console.error(`[pet] refusing to start: "${configured}" is not an https:// address (http:// only for localhost)`);
  app.exit(1);
} else if (!firstInstance) {
  app.quit();
}

let win = null;
/** a profile that arrived before the window existed (macOS sends the link that started the app this way) */
let pendingCrew = null;
function showCrew(crew) {
  if (!crew) return;
  if (win && !win.isDestroyed()) win.loadURL(core.petUrl(ORIGIN, crew));
  else pendingCrew = crew;
}

if (firstInstance) {
  // let the website's button reach us. A portable .exe runs from a temp copy, so register the file the user has.
  // A packaged macOS app is registered by its Info.plist (electron-builder "protocols"), nothing to do at runtime.
  // dev (`pnpm pet`): a link starts this script with the Electron from node_modules
  if (!app.isPackaged) app.setAsDefaultProtocolClient(core.PROTOCOL, process.execPath, [path.join(__dirname, "main.cjs")]);
  else if (!MAC) app.setAsDefaultProtocolClient(core.PROTOCOL, process.env.PORTABLE_EXECUTABLE_FILE || process.execPath, []);
  // Windows / Linux: the link comes as a command-line argument of a second launch
  app.on("second-instance", (_e, argv) => showCrew(core.crewFromArgs(argv)));
  // macOS: the link comes as an event, also for the launch it started
  app.on("open-url", (e, url) => {
    e.preventDefault();
    showCrew(core.crewFromArg(url));
  });
}

/** Is a server answering at ORIGIN? (any HTTP status counts) */
const isUp = () => fetch(ORIGIN).then(
  () => true,
  () => false,
);

/** Dev only (`pnpm pet`) with no server running: start `next dev` ourselves and stop it with the pet. */
let server = null;
async function ensureServer() {
  if (app.isPackaged || (await isUp())) return;
  const url = new URL(ORIGIN);
  if (url.protocol !== "http:") return; // a remote site is not ours to start
  const root = path.join(__dirname, "..");
  // system node, not Electron's: better-sqlite3 is built for it. Same steps as `pnpm dev` (MediaPipe runtime first).
  spawnSync("node", [path.join(root, "scripts", "copy-mediapipe-wasm.mjs")], { cwd: root, stdio: "ignore" });
  server = spawn("node", [path.join(root, "node_modules", "next", "dist", "bin", "next"), "dev", "-p", url.port || "3000"], {
    cwd: root,
    stdio: "ignore",
  });
  server.on("error", (e) => console.error("[pet] could not start the server:", e.message));
  // a cold `next dev` compile can take a while; after 3 minutes load anyway (Next's own error page explains)
  for (let i = 0; i < 180 && !(await isUp()); i++) await new Promise((r) => setTimeout(r, 1000));
}
app.on("before-quit", () => {
  if (server && !server.killed) server.kill();
});

/** IPC is answered only for our own page (not a frame from anywhere else) */
const fromOrigin = (e) => core.sameOrigin(e.senderFrame?.url ?? "", ORIGIN);

/** the hardening every window of this app gets: stay on ORIGIN, nothing opens inside the app */
function lockToOrigin(w) {
  const keepOut = (e, url) => {
    if (core.sameOrigin(url, ORIGIN)) return;
    e.preventDefault();
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url); // a normal web link: the user's own browser
  };
  w.webContents.on("will-navigate", keepOut);
  w.webContents.on("will-redirect", keepOut);
  w.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url) && !core.sameOrigin(url, ORIGIN)) void shell.openExternal(url);
    return { action: "deny" };
  });
  w.webContents.on("will-attach-webview", (e) => e.preventDefault());
}

const SAFE_PREFS = {
  contextIsolation: true,
  nodeIntegration: false,
  nodeIntegrationInSubFrames: false,
  sandbox: true,
  webSecurity: true,
  allowRunningInsecureContent: false,
  webviewTag: false,
  spellcheck: false,
};

app.whenReady().then(async () => {
  if (!firstInstance) return;

  // the voice check-in needs the microphone (and "follow me" the camera): our own origin only, nothing else ever
  session.defaultSession.setPermissionRequestHandler((wc, permission, cb, details) =>
    cb(permission === "media" && core.sameOrigin(details?.requestingUrl || wc.getURL(), ORIGIN)),
  );
  session.defaultSession.setPermissionCheckHandler(
    (_wc, permission, requestingOrigin) => permission === "media" && requestingOrigin === ORIGIN,
  );

  if (MAC) {
    app.dock?.hide(); // like skipTaskbar on Windows: she lives on the screen and in the menu bar, not the Dock
    // macOS asks once per app; without a yes getUserMedia fails even though the page is allowed
    await Promise.all([systemPreferences.askForMediaAccess("microphone"), systemPreferences.askForMediaAccess("camera")]).catch(() => {});
  }
  await ensureServer();

  // the size is kept here, not read back from getBounds(): on scaled displays Windows can round the size a pixel
  // differently on every setBounds, and a 60 fps loop would make the window creep
  let size = { w: 140, h: 140 };
  const startArea = screen.getPrimaryDisplay().workArea;
  win = new BrowserWindow({
    width: size.w,
    height: size.h,
    x: startArea.x + startArea.width - size.w - 40,
    y: startArea.y + startArea.height - size.h,
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    alwaysOnTop: true,
    resizable: false,
    skipTaskbar: true,
    hasShadow: false,
    title: "lil cosmo",
    webPreferences: {
      ...SAFE_PREFS,
      autoplayPolicy: "no-user-gesture-required", // she answers out loud after a spoken question, not only a click
      preload: path.join(__dirname, "preload.cjs"),
      backgroundThrottling: false, // keep the sprite and the camera running while other windows have focus
    },
  });
  lockToOrigin(win);
  win.setAlwaysOnTop(true, "screen-saver");
  if (MAC) win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true }); // stay with the user across Spaces
  win.loadURL(core.petUrl(ORIGIN, pendingCrew || core.crewFromArgs(process.argv)));
  pendingCrew = null;

  // every move goes through here: x clamped to the screen, y always on the bottom edge
  let x = win.getBounds().x;
  function place(nextX) {
    if (win.isDestroyed()) return;
    const wa = screen.getDisplayNearestPoint({ x: Math.round(nextX + size.w / 2), y: startArea.y }).workArea;
    x = Math.min(Math.max(nextX, wa.x), wa.x + wa.width - size.w);
    win.setBounds({ x: Math.round(x), y: wa.y + wa.height - size.h, width: size.w, height: size.h });
  }

  // the page grows the window upward for its text box; the horizontal centre stays put
  ipcMain.on("pet:resize", (e, w, h) => {
    if (!fromOrigin(e)) return;
    const next = core.petSize(w, h);
    if (!next) return;
    const cx = x + size.w / 2;
    size = next;
    win.setResizable(true);
    place(cx - size.w / 2);
    win.setResizable(false);
  });

  // dragging: sideways only
  ipcMain.on("pet:move", (e, dx) => {
    if (!fromOrigin(e) || typeof dx !== "number" || !Number.isFinite(dx)) return;
    stopRun();
    place(x + Math.max(-400, Math.min(400, dx)));
  });

  // follow the user: run to where the page says they stand, with an ease-in / ease-out speed
  let targetFrac = null;
  let timer = null;
  let speed = 0;
  let dir = 1;
  const send = (ch, v) => {
    if (win && !win.isDestroyed()) win.webContents.send(ch, v);
  };
  function stopRun() {
    if (!timer) return;
    clearInterval(timer);
    timer = null;
    speed = 0;
    send("pet:moving", false);
  }
  function step() {
    if (win.isDestroyed()) return stopRun();
    const wa = screen.getDisplayNearestPoint({ x: Math.round(x + size.w / 2), y: startArea.y }).workArea;
    const d = wa.x + targetFrac * (wa.width - size.w) - x;
    if (Math.abs(d) < 1) return stopRun();
    const nd = d > 0 ? 1 : -1;
    if (nd !== dir) {
      dir = nd;
      speed = 0;
      send("pet:dir", dir);
    }
    speed = core.nextSpeed(speed, d, ACCEL, MAX_SPEED);
    place(x + nd * speed);
  }
  // a new page (profile switch, reload) mid-run would show her standing while the window slides
  win.webContents.on("did-finish-load", () => {
    send("pet:dir", dir);
    send("pet:moving", timer !== null);
  });
  ipcMain.on("pet:goto", (e, frac) => {
    if (!fromOrigin(e)) return;
    const f = core.clampFrac(frac);
    if (f === null) return;
    targetFrac = f;
    if (timer) return;
    send("pet:dir", dir);
    send("pet:moving", true);
    timer = setInterval(step, TICK_MS);
  });

  ipcMain.on("pet:dashboard", (e, p) => {
    if (!fromOrigin(e)) return;
    const url = core.dashboardUrl(ORIGIN, p);
    if (!url) return;
    const dash = new BrowserWindow({ width: 1280, height: 820, autoHideMenuBar: true, title: "AEGIS", webPreferences: { ...SAFE_PREFS } });
    lockToOrigin(dash);
    dash.loadURL(url);
  });

  // right-click on Cosmo: the only menu (no buttons on screen). The page sends what it knows (and the labels in its
  // language); picks come back as "pet:action", except a profile switch (a reload as that crew member) and quitting.
  ipcMain.on("pet:menu", (e, info) => {
    if (!fromOrigin(e) || typeof info !== "object" || info === null) return;
    const label = core.menuLabels(info.labels);
    const crew = core.menuCrew(info.crew);
    const current = typeof info.current === "string" ? info.current : null;
    const action = (a) => () => send("pet:action", a);
    Menu.buildFromTemplate([
      { label: info.active ? label.stop : label.talk, enabled: current !== null, click: action("talk") },
      { label: label.write, type: "checkbox", checked: Boolean(info.typing), enabled: current !== null, click: action("write") },
      { label: label.camera, type: "checkbox", checked: Boolean(info.camera), enabled: current !== null, click: action("camera") },
      { label: label.dashboard, enabled: Boolean(info.canDashboard), click: action("dashboard") },
      {
        label: label.profile,
        submenu: crew.length
          ? crew.map((c) => ({
              label: c.name,
              type: "radio",
              checked: c.id === current,
              click: () => c.id !== current && showCrew(c.id),
            }))
          : [{ label: label.noProfiles, enabled: false }],
      },
      { type: "separator" },
      { label: label.quit, click: () => app.quit() },
    ]).popup({ window: win });
  });

  // frameless + no taskbar entry: a tray icon is the other way back and out
  const icon = nativeImage.createFromPath(path.join(__dirname, "..", "public", "mascot", "cosmo-front.png"));
  const tray = new Tray(icon.resize({ height: 16 })); // the render is not square: keep its proportions
  tray.setToolTip("lil cosmo");
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "Show lil cosmo", click: () => win && !win.isDestroyed() && win.show() },
      { label: "Quit lil cosmo", click: () => app.quit() },
    ]),
  );
});

app.on("window-all-closed", () => app.quit());
