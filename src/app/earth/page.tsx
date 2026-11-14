import { EarthConsole } from "@/components/earth/EarthConsole";

/** /earth : read-only Earth console (ground role) with a simulated link delay. */
export default async function EarthPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { delay } = await searchParams;
  return <EarthConsole initialDelay={Array.isArray(delay) ? delay[0] : delay} />;
}
