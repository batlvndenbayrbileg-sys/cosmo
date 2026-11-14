/**
 * Web Audio graph cache for useAudioAmplitude.
 *
 * createMediaElementSource may be called only once per element, and a page may only hold a handful of
 * live AudioContexts, so the outcome for an element (graph OR failure) is cached for the element's
 * lifetime and a context that could not be wired is closed immediately.
 */
export interface AudioGraph {
  context: AudioContext;
  source: MediaElementAudioSourceNode;
  analyser: AnalyserNode;
  buffer: Uint8Array<ArrayBuffer>;
}

export type AudioContextCtor = typeof AudioContext;

/** graph on success, null once building failed for that element (never retried) */
const outcomes = new WeakMap<object, AudioGraph | null>();

export function defaultAudioContextCtor(): AudioContextCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { AudioContext?: AudioContextCtor; webkitAudioContext?: AudioContextCtor };
  return w.AudioContext ?? w.webkitAudioContext ?? null;
}

function closeQuietly(context: AudioContext | null) {
  if (!context) return;
  try {
    const closed = context.close();
    if (closed && typeof closed.catch === "function") closed.catch(() => {});
  } catch {
    // already closed or not closable: nothing more to release
  }
}

export function ensureAudioGraph(
  audio: HTMLMediaElement,
  Ctor: AudioContextCtor | null = defaultAudioContextCtor(),
): AudioGraph | null {
  if (outcomes.has(audio)) return outcomes.get(audio) ?? null;
  if (!Ctor) return null; // no Web Audio here (SSR or old browser): nothing to cache

  let context: AudioContext | null = null;
  try {
    context = new Ctor();
    const source = context.createMediaElementSource(audio);
    const analyser = context.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.6;
    source.connect(analyser);
    analyser.connect(context.destination);
    const graph: AudioGraph = { context, source, analyser, buffer: new Uint8Array(analyser.fftSize) };
    outcomes.set(audio, graph);
    return graph;
  } catch {
    // the element was already wired by someone else (e.g. a speech player), or the context cannot be
    // built: audio keeps playing, the mouth stays closed. Free the context and remember the failure so
    // later 'play' events do not create another one.
    closeQuietly(context);
    outcomes.set(audio, null);
    return null;
  }
}

/** the graph if one was built successfully, without building anything */
export function getAudioGraph(audio: HTMLMediaElement): AudioGraph | null {
  return outcomes.get(audio) ?? null;
}
