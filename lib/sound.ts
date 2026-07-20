"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ClientState, Phase } from "./types";

// Sound is opt-in: off by default, remembered per browser once toggled on.
const STORAGE_KEY = "villagers:sound";

// A short synthesized cue per phase. We generate tones with the Web Audio API
// instead of shipping audio files — it keeps the app asset-free and lets each
// phase have a distinct, on-theme sting (dark at night, a rising chime at dawn,
// a gavel thud on the verdict, a chord to close the game).
type Cue = "night" | "dawn" | "day" | "verdict" | "win" | "loss";

function cueForPhase(phase: Phase, winner?: ClientState["winner"]): Cue | null {
  switch (phase) {
    case "night_action":
      return "night";
    case "resolve":
      return "dawn";
    case "day_vote":
      return "day";
    case "day_result":
      return "verdict";
    case "game_over":
      return winner === "killers" ? "loss" : "win";
    // lobby (and any future phases) stay silent.
    default:
      return null;
  }
}

// One tone in a cue: frequency, timing, waveform and peak gain (kept low so the
// cues stay soft). Times are seconds relative to the start of the cue.
interface Tone {
  freq: number;
  start: number;
  duration: number;
  type?: OscillatorType;
  gain?: number;
}

const CUES: Record<Cue, Tone[]> = {
  // Low, slow, ominous — a pair of detuned drones sliding in.
  night: [
    { freq: 110, start: 0, duration: 1.1, type: "sine", gain: 0.18 },
    { freq: 146.8, start: 0.15, duration: 0.95, type: "sine", gain: 0.12 },
  ],
  // A gentle rising three-note chime — the sun coming up.
  dawn: [
    { freq: 523.25, start: 0, duration: 0.35, type: "triangle" },
    { freq: 659.25, start: 0.18, duration: 0.35, type: "triangle" },
    { freq: 783.99, start: 0.36, duration: 0.5, type: "triangle" },
  ],
  // Bright, brief — bells calling the village to the trial.
  day: [
    { freq: 587.33, start: 0, duration: 0.3, type: "triangle" },
    { freq: 880, start: 0.12, duration: 0.4, type: "triangle" },
  ],
  // Two low thuds — the gavel falls on the verdict.
  verdict: [
    { freq: 196, start: 0, duration: 0.2, type: "square", gain: 0.16 },
    { freq: 174.61, start: 0.22, duration: 0.3, type: "square", gain: 0.16 },
  ],
  // A bright major triad — the village prevails.
  win: [
    { freq: 523.25, start: 0, duration: 0.6, type: "triangle" },
    { freq: 659.25, start: 0.08, duration: 0.6, type: "triangle" },
    { freq: 783.99, start: 0.16, duration: 0.7, type: "triangle" },
  ],
  // A low minor triad — the killers win.
  loss: [
    { freq: 130.81, start: 0, duration: 0.9, type: "sawtooth", gain: 0.12 },
    { freq: 155.56, start: 0.05, duration: 0.9, type: "sawtooth", gain: 0.12 },
    { freq: 196, start: 0.1, duration: 0.9, type: "sawtooth", gain: 0.12 },
  ],
};

// A tiny synth over one shared AudioContext. Each tone gets an oscillator and a
// gain envelope (quick attack, smooth decay) so the cues never click or clip.
function playCue(ctx: AudioContext, cue: Cue) {
  const now = ctx.currentTime;
  for (const tone of CUES[cue]) {
    const osc = ctx.createOscillator();
    const env = ctx.createGain();
    const peak = tone.gain ?? 0.2;
    const t0 = now + tone.start;
    const t1 = t0 + tone.duration;

    osc.type = tone.type ?? "sine";
    osc.frequency.setValueAtTime(tone.freq, t0);

    env.gain.setValueAtTime(0.0001, t0);
    env.gain.exponentialRampToValueAtTime(peak, t0 + 0.02);
    env.gain.exponentialRampToValueAtTime(0.0001, t1);

    osc.connect(env).connect(ctx.destination);
    osc.start(t0);
    osc.stop(t1 + 0.02);
  }
}

// Manages the on/off preference plus the AudioContext, and plays the cue for a
// phase. Enabling is a user gesture, so that's when we create/resume the
// context (browsers block audio until a gesture) — sound never starts on its own.
export function useSound() {
  const [enabled, setEnabled] = useState(false);
  const ctxRef = useRef<AudioContext | null>(null);

  useEffect(() => {
    setEnabled(window.localStorage.getItem(STORAGE_KEY) === "on");
  }, []);

  const ensureContext = useCallback(() => {
    if (!ctxRef.current) {
      const Ctor =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext;
      if (Ctor) ctxRef.current = new Ctor();
    }
    if (ctxRef.current?.state === "suspended") ctxRef.current.resume();
    return ctxRef.current;
  }, []);

  const toggle = useCallback(() => {
    setEnabled((on) => {
      const next = !on;
      window.localStorage.setItem(STORAGE_KEY, next ? "on" : "off");
      if (next) ensureContext();
      return next;
    });
  }, [ensureContext]);

  const playForPhase = useCallback(
    (phase: Phase, winner?: ClientState["winner"]) => {
      if (!enabled) return;
      const cue = cueForPhase(phase, winner);
      if (!cue) return;
      const ctx = ensureContext();
      if (ctx) playCue(ctx, cue);
    },
    [enabled, ensureContext]
  );

  return { enabled, toggle, playForPhase };
}
