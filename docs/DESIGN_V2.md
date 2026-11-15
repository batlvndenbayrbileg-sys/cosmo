# Cosmo design v2 — "glass clinic" redesign (team direction, 2026-11-14)

The team supplied a reference dashboard shot (a light, clean medical dashboard: soft blue gradient, frosted-white glass panels, a large central human figure with hotspot dots, profile column on the left, cards on the right, a date timeline along the bottom) and asked for the same look and feel, **next level**, plus a new check-in experience where **only the big mascot is visible**. This file describes the reference precisely (the agents cannot see the image) and how Cosmo adapts it. It supersedes the visual parts of `docs/DASHBOARD_PLAN.md` §3; the data, status model and honesty rules of that document still apply unchanged.

We reproduce the **layout and visual language**, not the reference's content: no copied logo, photo, MRI image or brand names. The reference's "Medications" block becomes **Today's plan** (we never suggest drugs — guardrail R-21).

## 1. Visual language (tokens)

- **Page background:** soft diagonal gradient, top-left `#C9DCFF` → centre `#E6EFFF` → bottom-right `#F7FAFF`, plus two very blurred light blobs (white, 40% opacity) for depth. Never pure white, never dark.
- **Frame:** the whole dashboard sits in one large rounded "glass" frame: radius 32–36 px, background `rgba(255,255,255,0.55)`, `backdrop-filter: blur(24px) saturate(140%)`, 1 px border `rgba(255,255,255,0.8)`, shadow `0 30px 80px -30px rgba(40,80,160,0.25)`, inner padding 28–32 px. Max width 1280–1360 px, centred, 32 px margin.
- **Cards inside the frame:** white `rgba(255,255,255,0.85)`, radius 24 px, no visible border or a hairline `rgba(15,27,45,0.06)`, very soft shadow `0 8px 24px -12px rgba(40,80,160,0.18)`.
- **Pills:** fully rounded (999 px), white, hairline border, 36–40 px high, value in 17 px medium + unit in 11 px muted ("64 kg" style → ours "12 day", "85 readiness").
- **Icon chips:** 36–40 px **black** circles (`#0F1B2D`) with a white line icon (lucide), used before card titles exactly like the reference ("♥ Heart Rate").
- **Typography:** Inter (Latin + Cyrillic + cyrillic-ext). Titles regular/light 28–34 px, two-tone titles allowed ("Full Brain" light + "MRI" medium → ours "Health" light + "Radar" medium). Card titles 17–18 px regular. Big numbers 34–44 px regular with small 11–12 px uppercase units/labels ("AVG", "RANGE", "BPM"). Labels `#5B6678`. Tabular numerals for numbers.
- **Colour:** UI is white/blue-grey. Accent blue `#4F86F7` (charts, active states), light chart blue `#D6E4FF`, deep accent `#2F5BD3`. Pastel card fills: yellow `#FFF5C7`, blue `#DCE9FF`, mint `#DDF7EA`, lilac `#EDE3FF`. Status colours stay as in globals.css (ok / watch / alert / no-data) and status is never colour alone (glyph + word).
- **Motion:** framer-motion, calm springs (stiffness 120–180, damping 20–26), 200–450 ms; staggered card entrance; respect `prefers-reduced-motion`.

Implement these as CSS variables + utility classes in `src/app/globals.css`: `.cosmo-bg` (page gradient + blobs), `.glass-frame`, `.glass-card`, `.pill`, `.icon-chip`, `.pastel-yellow|blue|mint|lilac`, `.num-xl`, `.unit-label`.

## 2. Dashboard layout (desktop ≥ 1280 px), inside the glass frame

**Top bar (one row):**
- Left: round white 44 px logo button with the Cosmo mark.
- Centre: segmented pill nav in a light-grey rounded track; active item = slightly darker grey pill with icon + label. Items: **Overview** (active), **Vitals**, **Plan**, **Trends**, **Earth link** (scroll-to anchors or tabs; Overview shows everything).
- Right: crew avatar circle (crop of the mascot render, variant colour) + two-line "Welcome back" (11 px muted) / crew name (15 px medium); then two round 40 px icon buttons: **bell** (red dot when alerts exist; opens alerts popover) and **language** (EN / МН toggle). (The reference has a settings cog there.)

**Left column (~27%):**
1. Crew name, large, 2 lines (first name / role in lighter weight), with a small right-aligned label (mission day).
2. **Profile card**: the crew member's mascot render (front pose, variant hue) in a white card that fades into a **row of stat pills** overlapping its bottom edge: overall status pill (glyph + word), `Readiness 85`, `Day 12`, language.
3. **Highlight vital card** (the reference's "Heart Rate" card): black icon chip + title of the most notable indicator today (from summary findings; fallback heart rate); two columns `AVG` (personal 14-day mean) and `RANGE` (14-day min–max) with big numbers + unit; a **bar chart** of the last 7–14 days (rounded light-blue bars `#D6E4FF`, today's bar accent blue with a diagonal hatch pattern, a small black tooltip pill above it with today's value), x labels as short dates.

**Centre (~40%) — the hero:**
- The **body figure** `public/body/body-figure.png` (transparent, 1020×1536, porcelain figure with a glowing blue circulatory system, generated with the team's Higgsfield account) large and centred, with a soft radial light-blue glow behind it and a thin elliptical "floor" ring under the feet (1 px `rgba(79,134,247,0.35)`).
- **Hotspots** on the body (grey-white 18–22 px dots with a white ring like the reference, but coloured/shaped by status: ●▲◆○): one per radar axis — head = **Neuro-ocular**, temple/forehead = **Sleep**, chest/heart = **Cardiovascular**, abdomen = **Metabolic**, thigh/knee = **Musculoskeletal**, upper chest/shoulder = **Behavioral**. Approximate normalised positions on the image (x, y): head (0.50, 0.07), forehead side (0.56, 0.05), heart (0.52, 0.25), shoulder (0.36, 0.20), abdomen (0.50, 0.38), knee (0.43, 0.66) — verify against the image. A worse status pulses gently. Hover/click → a floating glass tooltip card: axis name, score 0–100 vs usual, status pill, the 1–3 indicator values behind it, link to the hazard (NASA HRP name).
- Left-bottom: round **+ / −** zoom buttons (zoom into the upper/lower body); bottom centre: small **‹ ›** arrows to cycle the highlighted axis.

**Right column (~27%):**
1. Two-tone title with black icon chip: "Health **Radar**", then a rounded card holding the 6-axis radar (today solid accent blue vs own 14-day dashed grey) — this takes the place of the reference's MRI image card.
2. Title "Today's **plan**" then **2×1 pastel task cards** (yellow, blue; a third/fourth task as mint/lilac on hover or scroll): white circle icon at top-left, bold short title, one-line "because…" in small text, hazard tag.
3. Two small square cards side by side (the reference's "Heart" and "Oxygen"): **Heart rate** — black icon chip, big number + "bpm", an area sparkline (gradient blue fill) with the personal baseline drawn as a green line; **Hydration / activity** — big number (water ml) + three mini donuts (water, exercise, sleep vs target) in pastel blue / coral / lilac.

**Bottom strip (full width, inside the frame):** a horizontal **timeline** of the last 14–21 days: month labels above, day numbers below, one 40 px circular badge per check-in with an icon for the day's worst axis (heart, moon, eye, droplet, dumbbell, smile) — grey for normal past days, coloured soft-filled for watch/alert days; the most recent 4 days sit on a raised white pill segment (like the reference). Click a day → that day's dashboard (crew view only).

**Cosmo** on the dashboard: a floating glass card bottom-right (collapsible) with the small mascot, today's 1-line status, ≤ 2 findings, ≤ 2 recommendations, "Decision support, not a diagnosis.", and a replay button. Prototype ribbon stays at the very bottom of the page, small.

**Earth console (`/earth`, `/earth/[crewId]`):** same background and glass frame; a crew grid of glass cards (mascot avatar, name, role, overall pill, readiness, last check-in, alert badge), alerts list, simulated link-delay pill selector; the per-crew page reuses the dashboard layout read-only (no Cosmo card, no notes).

**Crew select (`/`):** same background; one glass frame; four large glass cards with the mascot render (variant hue), name, role, language; hover lifts the card.

Mobile (< 768 px): single column in this order — top bar (logo + language), name, body figure with hotspots, highlight vital, radar, plan, small cards, timeline (horizontal scroll), Cosmo card.

## 3. Check-in experience (team direction)

- **Only the big mascot is visible.** Full-screen `.cosmo-bg` gradient; the mascot (ImageCosmo, front pose) centred at ~70% of the viewport height, breathing, with a soft glow ellipse under it. No header, no transcript panel, no cards grid, no visible buttons.
- **Voice only for the astronaut.** Listening/thinking/speaking is shown on the mascot itself and by a ring of light on the floor ellipse (listening: soft cyan pulse; thinking: slow rotating lilac arc; speaking: ring brightness follows amplitude).
- **Cosmo writes the answers.** Every captured value appears as an animated **glass bubble** that flies out from the mascot (spring from the mascot's chest) and settles in a slot around it (alternating left and right columns, top to bottom, up to 7 per side). While it travels, a short glowing "pen" trail connects Cosmo to the bubble and the text appears with a quick typewriter effect, as if Cosmo is writing it down. Bubble = icon chip + label + value + unit + status glyph (e.g. "Sleep · 5.5 h ▲"). A correction makes the bubble shake gently and retype the new value. A clarification shows as a soft question bubble next to Cosmo's head that disappears when answered.
- **Unobtrusive fallbacks (required for reliability and accessibility):** small ghost icons in the corners at ~35% opacity that brighten on hover/focus: language EN/МН (top-right), captions toggle "CC" (shows Cosmo's sentence and the live transcript as one subtle caption line under the mascot), keyboard (opens a minimal text field for typed answers), and "Run demo" (bottom-left; scripted demo). Keyboard shortcuts: Space = push-to-talk.
- **Loading → dashboard.** After "yes" at the confirmation: all bubbles drift into the mascot (converge), the mascot shows "thinking", a calm line "Preparing your dashboard…" / "Хяналтын самбарыг бэлдэж байна…" with a slim progress arc; when the dashboard payload has loaded (minimum ~1.2 s so it doesn't flash), the glass frame scales/fades in and the mascot shrinks into the Cosmo card bottom-right (shared layout id `COSMO_LAYOUT_ID`), then speaks the summary.

## 4. Honesty and guardrails (unchanged)

Thresholds are demo parameters; history is simulated; the Earth link is simulated; no diagnosis/drug/treatment wording; status never by colour alone; crew data isolation; ground never sees notes or transcripts.
