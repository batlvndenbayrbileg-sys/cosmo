import { EarthCrewView } from "@/components/earth/EarthCrewView";

/** /earth/[crewId] : one crew member's dashboard as the ground role sees it (read-only). */
export default async function EarthCrewPage({
  params,
  searchParams,
}: {
  params: Promise<{ crewId: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { crewId } = await params;
  const { delay } = await searchParams;
  return <EarthCrewView crewId={crewId} initialDelay={Array.isArray(delay) ? delay[0] : delay} />;
}
