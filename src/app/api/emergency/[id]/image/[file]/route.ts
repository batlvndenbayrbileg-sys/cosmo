import fs from "node:fs/promises";
import path from "node:path";
import { handle, HttpError, NotFoundError } from "@/server/http";
import { getSession } from "@/server/session";
import { emergencyImagePath } from "@/server/emergency/load";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TYPES: Record<string, string> = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp" };

/** GET /api/emergency/:id/image/:file - one step image of the team's content (strict names, no path traversal). */
export function GET(_request: Request, context: { params: Promise<{ id: string; file: string }> }): Promise<Response> {
  return handle(async () => {
    if (!(await getSession())) throw new HttpError(401, "NO_SESSION", "Sign in first");
    const { id, file } = await context.params;
    const full = emergencyImagePath(id, file);
    if (!full) throw new NotFoundError("Image not found");
    const bytes = await fs.readFile(full);
    return new Response(new Uint8Array(bytes), {
      headers: {
        "content-type": TYPES[path.extname(full).toLowerCase()] ?? "application/octet-stream",
        "cache-control": "private, max-age=300",
      },
    });
  });
}
