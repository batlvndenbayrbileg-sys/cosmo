"use client";

/**
 * /dev/dashboard: renders the hand-written fixtures from src/lib/fixtures/dashboard.ts so the dashboard UI can
 * be developed and checked without the data routes. Not linked from the product UI. The viewer toggle shows the
 * crew view (Cosmo dock, notes, acknowledge) or the read-only Earth view.
 */
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { DashboardView } from "@/components/dashboard/DashboardView";
import { DASHBOARD_FIXTURES, getDashboardFixture, type FixtureId } from "@/lib/fixtures/dashboard";

type Viewer = "crew" | "ground";

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
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label={label}>
      <span className="text-sm font-medium text-muted-foreground">{label}</span>
      {options.map((o) => (
        <Button
          key={o.id}
          type="button"
          size="lg"
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

export default function DashboardPlaygroundPage() {
  const [fixtureId, setFixtureId] = useState<FixtureId>("bat-yellow");
  const [viewer, setViewer] = useState<Viewer>("crew");
  const fixture = getDashboardFixture(fixtureId);

  return (
    <div className="flex flex-col gap-6">
      <section
        aria-label="Fixture controls"
        className="glass-card mx-auto flex w-full max-w-[1360px] flex-col gap-3 p-4"
      >
        <h1 className="text-xl font-semibold">Dashboard playground</h1>
        <p className="text-sm text-muted-foreground">
          Fixtures from <code>src/lib/fixtures/dashboard.ts</code>. No API calls are made; the replay button
          falls back to the browser voice because the audio route is not served here.
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
      </section>

      {/* re-keyed so the entrance animation replays on every switch */}
      <DashboardView key={`${fixtureId}:${viewer}`} payload={fixture.payload} viewer={viewer} />
    </div>
  );
}
