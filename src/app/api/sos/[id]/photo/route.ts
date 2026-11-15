import { z } from "zod";
import { SOS_PHOTO_MAX_BYTES } from "@/lib/sos";
import { requireCrew } from "@/server/dashboard/roles";
import { attachSosPhoto, deleteSosPhoto, getSosAlert, markSosPhotoMissing } from "@/server/db/repos/sos";
import { handle, HttpError, ok } from "@/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const paramsSchema = z.object({ id: z.string().min(1).max(80) });
const missingSchema = z.object({ missing: z.enum(["denied", "unavailable"]) }).strict();

/** the body, refused (413) as soon as it grows past `max` bytes, whatever content-length claimed */
async function readCapped(request: Request, max: number): Promise<Uint8Array> {
  if (!request.body) return new Uint8Array(0);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel().catch(() => undefined);
      throw new HttpError(413, "BAD_INPUT", "Photo is too large");
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.byteLength;
  }
  return out;
}

/**
 * POST /api/sos/[id]/photo - the face still for the crew member's own SOS alert (another member's id is a 404).
 *  - `content-type: image/jpeg`, the JPEG bytes as the body, at most SOS_PHOTO_MAX_BYTES (413 above);
 *  - JSON `{ missing: "denied" | "unavailable" }` when the camera was refused or is missing: the alert says so.
 * The first photo is kept. Answers the alert (never the photo).
 */
export function POST(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const { crewId } = await requireCrew();
    const parsed = paramsSchema.safeParse(await ctx.params);
    if (!parsed.success) throw new HttpError(400, "BAD_INPUT", "Invalid SOS id");
    const { id } = parsed.data;
    // 404 for another member's alert before the body is read
    await getSosAlert(crewId, id);

    const type = (request.headers.get("content-type") ?? "").toLowerCase();
    if (type.startsWith("image/jpeg")) {
      const declared = Number(request.headers.get("content-length") ?? "0");
      if (declared > SOS_PHOTO_MAX_BYTES) throw new HttpError(413, "BAD_INPUT", "Photo is too large");
      return ok(await attachSosPhoto(crewId, id, await readCapped(request, SOS_PHOTO_MAX_BYTES)));
    }
    const missing = missingSchema.safeParse(await request.json().catch(() => null));
    if (!missing.success) throw new HttpError(400, "BAD_INPUT", 'Expected a JPEG body or { "missing": "denied" | "unavailable" }');
    return ok(await markSosPhotoMissing(crewId, id, missing.data.missing));
  });
}

/**
 * DELETE /api/sos/[id]/photo - the crew member removes the face still from their own SOS alert: the bytes are erased,
 * the Earth console shows "no photo" from its next poll, and the alert itself stays. Idempotent; another member's
 * alert is a 404, the ground role a 403. Answers the alert.
 */
export function DELETE(_request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const { crewId } = await requireCrew();
    const parsed = paramsSchema.safeParse(await ctx.params);
    if (!parsed.success) throw new HttpError(400, "BAD_INPUT", "Invalid SOS id");
    return ok(await deleteSosPhoto(crewId, parsed.data.id));
  });
}
