"use client";

/**
 * /dev/dashboard: renders the hand-written fixtures from src/lib/fixtures/dashboard.ts so the dashboard UI can
 * be developed and checked without the data routes. Not linked from the product UI. The viewer toggle shows the
 * crew view (Cosmo dock, notes, acknowledge) or the read-only Earth view.
 *
 * The controls float in a small collapsible panel bottom-left so the dashboard keeps its single-screen layout.
 * URL parameters preselect them (handy for screenshots): ?fixture=mira-red&viewer=ground&talk=bar
 * (`talk=bar` overlays the check-in lane's conversation bar as it sits idle, `talk=qa` with a sample question and
 * answer, to check what it covers).
 */
import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { FlaskConical } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DashboardTalk } from "@/components/checkin/DashboardTalk";
import { DashboardView } from "@/components/dashboard/DashboardView";
import { DASHBOARD_FIXTURES, getDashboardFixture, type FixtureId } from "@/lib/fixtures/dashboard";

type Viewer = "crew" | "ground";
type Talk = "off" | "bar" | "qa";

function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: ReadonlyArray<{ id: T; label: string }>;
  value: T;
  onChange: (next: T) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label={label}>
      <span className="w-full text-xs font-medium text-muted-foreground">{label}</span>
      {options.map((o) => (
        <Button
          key={o.id}
          type="button"
          size="sm"
          className="rounded-full"
          variant={o.id === value ? "default" : "outline"}
          aria-pressed={o.id === value}
          onClick={() => onChange(o.id)}
        >
          {o.label}
        </Button>
      ))}
    </div>
  );
}

const FIXTURE_IDS = DASHBOARD_FIXTURES.map((f) => f.id);

function Playground() {
  const params = useSearchParams();
  const [fixtureId, setFixtureId] = useState<FixtureId>(() => {
    const p = params.get("fixture");
    return FIXTURE_IDS.includes(p as FixtureId) ? (p as FixtureId) : "bat-yellow";
  });
  const [viewer, setViewer] = useState<Viewer>(() => (params.get("viewer") === "ground" ? "ground" : "crew"));
  const [talk, setTalk] = useState<Talk>(() => {
    const p = params.get("talk");
    return p === "bar" || p === "qa" ? p : "off";
  });
  const fixture = getDashboardFixture(fixtureId);

  return (
    <>
      {/* re-keyed so the entrance animation replays on every switch */}
      <DashboardView key={`${fixtureId}:${viewer}`} payload={fixture.payload} viewer={viewer} />

      {talk !== "off" && viewer === "crew" ? (
        <DashboardTalk
          status="idle"
          question={talk === "qa" ? "How did I sleep compared with my usual?" : null}
          answer={
            talk === "qa" ? "You slept 5.5 hours, below your usual of about 7. A wind-down routine tonight may help." : null
          }
          micUsable
          onMic={() => undefined}
          onSkipTour={() => undefined}
          onSendText={() => undefined}
        />
      ) : null}

      <details
        data-slot="dev-fixture-controls"
        className="group fixed bottom-3 left-3 z-50 max-w-[min(22rem,calc(100vw-1.5rem))] rounded-[20px] border border-white/80 bg-white/85 text-[var(--aegis-ink)] shadow-[0_20px_50px_-24px_rgba(40,80,160,0.5)] backdrop-blur-xl"
      >
        <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-[13px] font-medium outline-none focus-visible:ring-3 focus-visible:ring-ring/50 [&::-webkit-details-marker]:hidden">
          <FlaskConical aria-hidden="true" className="size-4 text-[var(--aegis-label)]" />
          Dashboard playground
          <span className="text-[var(--aegis-label)]">· {fixture.label.en}</span>
        </summary>
        <section aria-label="Fixture controls" className="flex flex-col gap-3 px-3 pt-1 pb-3">
          <p className="text-xs text-muted-foreground">
            Fixtures from <code>src/lib/fixtures/dashboard.ts</code>. No API calls are made; the replay button falls
            back to the browser voice because the audio route is not served here.
          </p>
          <Segmented
            label="Scenario"
            options={DASHBOARD_FIXTURES.map((f) => ({ id: f.id, label: f.label.en }))}
            value={fixtureId}
            onChange={setFixtureId}
          />
          <Segmented
            label="Viewer"
            options={[
              { id: "crew" as const, label: "Crew" },
              { id: "ground" as const, label: "Earth (read-only)" },
            ]}
            value={viewer}
            onChange={setViewer}
          />
          <Segmented
            label="Conversation bar overlay (crew)"
            options={[
              { id: "off" as const, label: "Off" },
              { id: "bar" as const, label: "Idle bar" },
              { id: "qa" as const, label: "With Q&A" },
            ]}
            value={talk}
            onChange={setTalk}
          />
        </section>
      </details>
    </>
  );
}

export default function DashboardPlaygroundPage() {
  // useSearchParams needs a Suspense boundary
  return (
    <Suspense fallback={null}>
      <Playground />
    </Suspense>
  );
}
