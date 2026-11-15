import { z } from "zod";
import type { CrewPublic, Lang } from "@/lib/types";
import { detectIdentityClaim, identifyCrew, isVoiceClass, languageOfText, type IdentityReason } from "@/lib/identity";
import { normalizeLanguageCode } from "@/lib/language";
import type { VoiceClass } from "@/lib/voice/pitch";
import { listCrewPublic } from "@/server/db/repos/crew";
import { handle, HttpError, ok } from "@/server/http";
import { setSessionCookie } from "@/server/session";
import { transcribeAudio } from "@/server/speech/stt";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** an audio upload larger than this is refused (as on the turn route) */
const MAX_AUDIO_BYTES = 10 * 1024 * 1024;

const jsonSchema = z
  .object({
    text: z.string().trim().min(1).max(2000),
    voice: z.enum(["female", "male", "unknown"]).optional(),
    previous: z.string().min(1).max(100).optional(),
    /** Cosmo has just asked who is speaking: a bare name ("Сараа") counts */
    asked: z.boolean().optional(),
  })
  .strict();

export interface IdentifyResponse {
  /** what was heard (speech-to-text) or typed */
  transcript: string;
  language: Lang;
  /** the person recognised, now signed in (the session cookie is set); null = Cosmo asks */
  crew: CrewPublic | null;
  reason: IdentityReason;
  /** when Cosmo asks: the people who speak that language */
  candidates: CrewPublic[];
}

interface Heard {
  text: string;
  language: Lang;
  voice: VoiceClass;
  previous: string | null;
  asked: boolean;
}

async function readInput(request: Request): Promise<Heard> {
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("multipart/form-data")) {
    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      throw new HttpError(400, "BAD_INPUT", "Invalid multipart body");
    }
    const audio = form.get("audio");
    if (!(audio instanceof Blob) || audio.size === 0) throw new HttpError(400, "BAD_INPUT", 'Expected a non-empty "audio" file');
    if (audio.size > MAX_AUDIO_BYTES) throw new HttpError(400, "BAD_INPUT", "Audio is too long");
    const voice = form.get("voice");
    const previous = form.get("previous");
    // no language hint: the recogniser tells which language was spoken (a Cyrillic transcript is Mongolian either way)
    const heard = await transcribeAudio(audio, { languageHint: null });
    return {
      text: heard.text,
      language: heard.language ?? languageOfText(heard.text),
      voice: isVoiceClass(voice) ? voice : "unknown",
      previous: typeof previous === "string" && previous.length > 0 && previous.length <= 100 ? previous : null,
      asked: form.get("asked") === "true",
    };
  }
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    throw new HttpError(400, "BAD_INPUT", "Body must be JSON or multipart with an audio file");
  }
  const parsed = jsonSchema.safeParse(json);
  if (!parsed.success) throw new HttpError(400, "BAD_INPUT", 'Expected { "text": string, "voice"?: "female" | "male" | "unknown" }');
  return {
    text: parsed.data.text,
    // typed text: the script decides (Cyrillic = Mongolian)
    language: languageOfText(parsed.data.text),
    voice: parsed.data.voice ?? "unknown",
    previous: parsed.data.previous ?? null,
    asked: parsed.data.asked === true,
  };
}

/**
 * POST /api/identify - who is speaking to the assistant screen, from the first utterance (src/lib/identity.ts).
 * Request: multipart { audio, voice?, previous?, asked? } (speech-to-text reports the language) or JSON
 * { text, voice?, previous?, asked? } (the script decides the language). `voice` is the guess measured on the device;
 * the recording's pitch itself never leaves the browser. When a person is recognised the crew session cookie is set
 * exactly as POST /api/session does, and the client continues as that person; otherwise Cosmo asks (`candidates`).
 * No session is needed: this is the sign-in, and it only ever picks one of the roster's crew members.
 */
export function POST(request: Request): Promise<Response> {
  return handle(async () => {
    const heard = await readInput(request);
    if (normalizeLanguageCode(heard.language) === null) throw new HttpError(400, "BAD_INPUT", "Unsupported language");
    const claim = detectIdentityClaim(heard.text, { strict: !heard.asked });
    const result = identifyCrew({ lang: heard.language, voice: heard.voice, claim, previous: heard.previous });
    const roster = await listCrewPublic();
    const byId = new Map(roster.map((c) => [c.id, c]));
    const crew = result.crewId ? (byId.get(result.crewId) ?? null) : null;
    if (crew) await setSessionCookie({ role: "crew", crewId: crew.id });
    const body: IdentifyResponse = {
      transcript: heard.text,
      language: heard.language,
      crew,
      reason: crew ? result.reason : "ask",
      candidates: result.candidates.map((id) => byId.get(id)).filter((c): c is CrewPublic => c !== undefined),
    };
    return ok(body);
  });
}
