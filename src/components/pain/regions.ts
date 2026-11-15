import type { PainLocation } from "@/lib/pain";

/**
 * The tappable places on public/visuals/body-front.png (688 x 1024, front view, arms slightly out), in the image's own
 * pixel space (the SVG overlay uses the same viewBox, so the shapes stay on the figure at any size). "back" and "whole
 * body" cannot be pointed at on a front view: they are buttons beside the figure (OFF_FIGURE).
 */

export const BODY_IMAGE = { src: "/visuals/body-front.png", width: 688, height: 1024 } as const;

export type RegionShape =
  | { kind: "ellipse"; cx: number; cy: number; rx: number; ry: number }
  | { kind: "path"; d: string };

export interface BodyRegion {
  location: PainLocation;
  shapes: RegionShape[];
  /** where the callout line starts (on the figure) */
  anchor: { x: number; y: number };
}

const mirror = (points: ReadonlyArray<[number, number]>): Array<[number, number]> => points.map(([x, y]) => [688 - x, y]);
const poly = (points: ReadonlyArray<[number, number]>): string => `M${points.map(([x, y]) => `${x} ${y}`).join(" L")} Z`;

const LEFT_ARM: ReadonlyArray<[number, number]> = [
  [232, 196],
  [266, 214],
  [246, 332],
  [204, 468],
  [178, 556],
  [104, 536],
  [150, 458],
  [192, 326],
];

const LEFT_LEG: ReadonlyArray<[number, number]> = [
  [256, 470],
  [338, 504],
  [332, 640],
  [310, 900],
  [304, 1004],
  [238, 1004],
  [252, 900],
  [246, 640],
];

/** drawn in this order: the large places first, the small ones last (on top, so they take the tap) */
export const BODY_REGIONS: readonly BodyRegion[] = [
  { location: "arm", shapes: [{ kind: "path", d: poly(LEFT_ARM) }, { kind: "path", d: poly(mirror(LEFT_ARM)) }], anchor: { x: 470, y: 380 } },
  { location: "leg", shapes: [{ kind: "path", d: poly(LEFT_LEG) }, { kind: "path", d: poly(mirror(LEFT_LEG)) }], anchor: { x: 404, y: 780 } },
  { location: "head", shapes: [{ kind: "ellipse", cx: 344, cy: 66, rx: 48, ry: 60 }], anchor: { x: 384, y: 40 } },
  { location: "throat", shapes: [{ kind: "ellipse", cx: 344, cy: 160, rx: 28, ry: 22 }], anchor: { x: 368, y: 160 } },
  { location: "chest", shapes: [{ kind: "ellipse", cx: 344, cy: 246, rx: 82, ry: 60 }], anchor: { x: 410, y: 236 } },
  { location: "abdomen", shapes: [{ kind: "ellipse", cx: 344, cy: 392, rx: 56, ry: 72 }], anchor: { x: 392, y: 380 } },
  {
    location: "side",
    shapes: [
      { kind: "ellipse", cx: 272, cy: 378, rx: 18, ry: 50 },
      { kind: "ellipse", cx: 416, cy: 378, rx: 18, ry: 50 },
    ],
    anchor: { x: 428, y: 360 },
  },
  {
    location: "joint",
    shapes: [
      { kind: "ellipse", cx: 289, cy: 664, rx: 20, ry: 22 },
      { kind: "ellipse", cx: 399, cy: 664, rx: 20, ry: 22 },
      { kind: "ellipse", cx: 210, cy: 346, rx: 16, ry: 16 },
      { kind: "ellipse", cx: 478, cy: 346, rx: 16, ry: 16 },
    ],
    anchor: { x: 416, y: 664 },
  },
  { location: "tooth", shapes: [{ kind: "ellipse", cx: 344, cy: 118, rx: 20, ry: 10 }], anchor: { x: 362, y: 118 } },
  {
    location: "ear",
    shapes: [
      { kind: "ellipse", cx: 297, cy: 84, rx: 11, ry: 15 },
      { kind: "ellipse", cx: 391, cy: 84, rx: 11, ry: 15 },
    ],
    anchor: { x: 400, y: 84 },
  },
  {
    location: "eye",
    shapes: [
      { kind: "ellipse", cx: 323, cy: 78, rx: 14, ry: 8 },
      { kind: "ellipse", cx: 365, cy: 78, rx: 14, ry: 8 },
    ],
    anchor: { x: 378, y: 76 },
  },
];

/** places without a spot on the front view */
export const OFF_FIGURE: readonly PainLocation[] = ["back", "whole_body"];

export function regionOf(location: PainLocation | null): BodyRegion | null {
  return location ? (BODY_REGIONS.find((r) => r.location === location) ?? null) : null;
}
