import { SignatureView } from "@/components/signature/SignatureView";
import { POST_TIMEPOINTS, REFERENCE_CREW } from "@/lib/signature/config";
import type { Timepoint } from "@/lib/signature/types";
import { buildSignatureView } from "@/lib/signature/view";
import { getLabData } from "@/server/signature/files";

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/**
 * /signature?crew=C003&tp=R+1 : Signature Triage on the Inspiration4 reference panels (C001..C004, NASA OSDR data, shown
 * for demonstration). The NASA CSVs are read and scored here on the server (next.config.ts traces data/nasa for this
 * route); the client view only receives the computed results. `checkInId` adds a link back to that dashboard.
 */
export default async function SignaturePage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const params = await searchParams;
  const crewParam = first(params.crew);
  // a literal "+" in a query string decodes to a space ("?tp=R+1"); read it back as "+"
  const tpParam = first(params.tp)?.replace(/ /g, "+");
  const checkInId = first(params.checkInId);
  const crew = crewParam && (REFERENCE_CREW as readonly string[]).includes(crewParam) ? crewParam : "C003";
  const tp = (tpParam && (POST_TIMEPOINTS as readonly string[]).includes(tpParam) ? tpParam : "R+1") as Timepoint;
  const data = buildSignatureView(getLabData());
  return (
    <SignatureView
      data={data}
      initialCrew={crew}
      initialTimepoint={tp}
      backHref={checkInId ? `/dashboard?checkInId=${encodeURIComponent(checkInId)}` : null}
    />
  );
}
