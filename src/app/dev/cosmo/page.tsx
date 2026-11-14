"use client";

/**
 * /dev/cosmo: playground for the Cosmo mascot. Not linked from the product UI.
 * Controls: state, emotion, variant, amplitude, auto talk (simulated speech envelope), size, Rive on/off.
 */
import { useState } from "react";
import { CosmoAvatar } from "@/components/cosmo/CosmoAvatar";
import { CosmoConfigProvider } from "@/components/cosmo/CosmoConfig";
import {
  COSMO_EMOTIONS,
  COSMO_STATES,
  type CosmoEmotion,
  type CosmoState,
} from "@/components/cosmo/types";
import { VARIANTS } from "@/components/cosmo/variants";
import { Button } from "@/components/ui/button";
import { useSimulatedAmplitude } from "@/hooks/useSimulatedAmplitude";

function Segmented<T extends string | number>({
  label,
  options,
  value,
  onChange,
  render,
}: {
  label: string;
  options: readonly T[];
  value: T;
  onChange: (next: T) => void;
  render?: (option: T) => string;
}) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm font-medium text-muted-foreground">{label}</span>
      <div className="flex flex-wrap gap-2" role="group" aria-label={label}>
        {options.map((option) => (
          <Button
            key={String(option)}
            type="button"
            size="sm"
            variant={option === value ? "default" : "outline"}
            aria-pressed={option === value}
            onClick={() => onChange(option)}
          >
            {render ? render(option) : String(option)}
          </Button>
        ))}
      </div>
    </div>
  );
}

function Range({
  label,
  value,
  min,
  max,
  step,
  disabled,
  onChange,
  format,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  disabled?: boolean;
  onChange: (next: number) => void;
  format: (value: number) => string;
}) {
  return (
    <label className="flex flex-col gap-2">
      <span className="flex justify-between text-sm font-medium text-muted-foreground">
        {label}
        <span className="tabular-nums text-foreground">{format(value)}</span>
      </span>
      <input
        type="range"
        className="w-full accent-primary disabled:opacity-50"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  );
}

export default function CosmoPlaygroundPage() {
  const [state, setState] = useState<CosmoState>("idle");
  const [emotion, setEmotion] = useState<CosmoEmotion>("neutral");
  const [variant, setVariant] = useState(0);
  const [manualAmplitude, setManualAmplitude] = useState(0);
  const [autoTalk, setAutoTalk] = useState(false);
  const [size, setSize] = useState(260);
  const [useRive, setUseRive] = useState(false);

  const simulated = useSimulatedAmplitude(autoTalk);
  const amplitude = autoTalk ? simulated : manualAmplitude;

  return (
    <CosmoConfigProvider rive={useRive}>
      <main className="min-h-screen bg-background text-foreground">
        <div className="mx-auto flex max-w-6xl flex-col gap-8 px-6 py-8">
          <header className="flex flex-col gap-1">
            <h1 className="text-2xl font-semibold">Cosmo playground</h1>
            <p className="text-muted-foreground">
              Placeholder character. Drop <code>public/cosmo.riv</code> and switch Rive on to test the
              designer file; if it fails to load the placeholder is used.
            </p>
          </header>

          <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_22rem]">
            <section
              aria-label="Preview"
              className="flex min-h-[24rem] items-center justify-center rounded-xl border border-border bg-card p-6"
            >
              <CosmoAvatar
                variant={variant}
                state={state}
                emotion={emotion}
                amplitude={amplitude}
                size={size}
              />
            </section>

            <section aria-label="Controls" className="flex flex-col gap-5 rounded-xl border border-border bg-card p-6">
              <Segmented label="State" options={COSMO_STATES} value={state} onChange={setState} />
              <Segmented label="Emotion" options={COSMO_EMOTIONS} value={emotion} onChange={setEmotion} />
              <Segmented
                label="Variant"
                options={[0, 1, 2, 3] as const}
                value={variant}
                onChange={setVariant}
                render={(i) => `${i} ${VARIANTS[i].name}`}
              />
              <Range
                label="Amplitude"
                value={autoTalk ? amplitude : manualAmplitude}
                min={0}
                max={1}
                step={0.01}
                disabled={autoTalk}
                onChange={setManualAmplitude}
                format={(v) => v.toFixed(2)}
              />
              <div className="flex flex-col gap-2">
                <span className="text-sm font-medium text-muted-foreground">Auto talk</span>
                <Button
                  type="button"
                  size="sm"
                  variant={autoTalk ? "default" : "outline"}
                  aria-pressed={autoTalk}
                  onClick={() => {
                    const next = !autoTalk;
                    setAutoTalk(next);
                    if (next) setState("talking");
                  }}
                >
                  {autoTalk ? "Talking (simulated)" : "Start simulated speech"}
                </Button>
              </div>
              <Range
                label="Size"
                value={size}
                min={80}
                max={420}
                step={10}
                onChange={setSize}
                format={(v) => `${v} px`}
              />
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="size-4 accent-primary"
                  checked={useRive}
                  onChange={(event) => setUseRive(event.target.checked)}
                />
                Use Rive (<code>/cosmo.riv</code>)
              </label>
            </section>
          </div>

          <section aria-label="All variants" className="flex flex-col gap-3">
            <h2 className="text-lg font-semibold">Variants</h2>
            <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
              {VARIANTS.map((v) => (
                <figure
                  key={v.index}
                  className="flex flex-col items-center gap-2 rounded-xl border border-border bg-card p-4"
                >
                  <CosmoAvatar
                    variant={v.index}
                    state={state}
                    emotion={emotion}
                    amplitude={amplitude}
                    size={150}
                  />
                  <figcaption className="text-sm text-muted-foreground">
                    {v.index} {v.name}, {v.detail}
                  </figcaption>
                </figure>
              ))}
            </div>
          </section>
        </div>
      </main>
    </CosmoConfigProvider>
  );
}
