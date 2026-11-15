# lil cosmo (desktop pet)

A small Cosmo that lives on the bottom edge of the screen (Windows and macOS). She talks with the crew member hands-free
in the same assistant conversation as the "/" screen (the daily check-up starts when asked for), runs along the screen
edge to where the camera sees you (off unless turned on), and opens the dashboard in its own window.

It is an Electron shell around one page of the website: the app opens `<site>/pet?crew=<id>`. Everything else
(conversation, voice, data) is the normal Cosmo server.

| Part | Where |
| --- | --- |
| Window, tray, menu, `lilcosmo://` links | `electron/main.cjs`, `electron/preload.cjs`, `electron/pet-core.cjs` |
| The pet page | `src/app/pet/` (`DesktopPet.tsx` in the app, `PetPreview.tsx` in a normal browser tab) |
| Running sprite (12 frames) | `public/mascot/run/`, `src/app/pet/RunSprite.tsx`, `scripts/prepare-run-frames.ps1` |
| "lil cosmo" button on the Cosmo screen | `src/components/pet/LilCosmoControl.tsx` (top-right corner, hidden on phones) |
| Build config | `electron-builder.yml` |

## Run it in development

```sh
pnpm pet
```

The first run downloads the Electron binary (~100 MB, once; `pnpm install` never does, see below). If nothing answers
on `http://localhost:3000`, the pet starts `next dev` itself and stops it when you quit. To use another server:

```sh
COSMO_ORIGIN=http://localhost:3126 pnpm pet        # PowerShell: $env:COSMO_ORIGIN="http://localhost:3126"; pnpm pet
```

Without a crew member she sleeps. Open the "/" screen in the browser, click **lil cosmo** (top right) and
**Open as <name>**: the browser asks to open lil cosmo, and the pet switches to that person. `pnpm pet` registers the
`lilcosmo://` link for the dev build.

Using her: tap to talk (she listens again after each answer; tap or stay quiet to stop), drag sideways to move,
right-click for the menu (Talk, Write, Camera, Open dashboard, Switch profile, Quit). The tray icon has Show and Quit.

## Build the .exe / .dmg

Set the website the app opens (an `https://` address; plain `http://` is accepted only for localhost):

```sh
pnpm pet:build -c.extraMetadata.cosmoOrigin=https://<your-site>        # Windows portable -> dist-electron/lil-cosmo.exe
pnpm pet:build:mac -c.extraMetadata.cosmoOrigin=https://<your-site>    # on a Mac          -> dist-electron/lil-cosmo.dmg
```

Without `cosmoOrigin` the build opens `http://localhost:3000`, which is only useful on a developer's computer.
`dist-electron/` is git-ignored: never commit the builds. They are not code-signed, so Windows SmartScreen and macOS
Gatekeeper warn the first time (Windows: "More info" > "Run anyway"; macOS: right-click > Open).

## Host the files and show the download button

The builds are ~110 MB, too big for the repository or a Vercel deployment. Upload them anywhere that serves files over
https (a GitHub Release asset, Supabase Storage, S3 / R2, Google Drive direct link), then set on Vercel (and in
`.env.local` for local testing):

| Variable | Value |
| --- | --- |
| `NEXT_PUBLIC_LIL_COSMO_URL` | the Windows `.exe` address |
| `NEXT_PUBLIC_LIL_COSMO_MAC_URL` | the macOS `.dmg` address |

They are public build-time values: redeploy after changing them. The button offers the build for the visitor's
computer first (a Mac gets the `.dmg`, Windows the `.exe`) and the other one as a small link. A platform without an
address gets no link; with neither set the card says "Desktop app coming soon". Only `https://` addresses, a path on
this site (`/lil-cosmo.exe`, for a local copy in `public/`, which is git-ignored) or `http://localhost` are accepted.

## Installs, CI and Vercel

`electron` and `electron-builder` are devDependencies only; the website never imports them. `pnpm-workspace.yaml`
sets `allowBuilds: electron: false`, so `pnpm install` (Vercel, CI, everyone who only works on the website) never runs
Electron's postinstall and never downloads its binary. `pnpm pet` runs `node node_modules/electron/install.js` first,
which downloads the binary on first use and does nothing afterwards. (`electron-builder` downloads the Electron
build it packages by itself.) Behind a proxy or offline, set `ELECTRON_MIRROR` / `electron_config_cache` as described in
Electron's install docs.

## Security

- The window only shows the configured site: navigation, redirects and pop-ups to anywhere else are refused (normal web
  links open in the default browser). Sandboxed renderer, context isolation on, no Node in the page, no `<webview>`.
- The page reaches the main process only through the fixed calls in `preload.cjs`; the main process answers only
  messages from the site's own origin and checks every value (`pet-core.cjs`, tested in `tests/pet.core.test.ts`).
- Camera and microphone are granted only to the site's origin (exact origin match, not a prefix).
- `lilcosmo://crew/<id>` links are accepted only with a plain id (`[A-Za-z0-9_-]`, at most 100 characters); anything
  else is ignored. The dashboard window opens only `/dashboard` on the same site.
- The camera runs face detection locally (MediaPipe); no video leaves the computer.

## Not done yet

- Not code-signed or notarised; no auto-update.
- No custom app icon (the mascot render is not square); the tray uses the mascot scaled down.
- The macOS build has not been run on a real Mac.
