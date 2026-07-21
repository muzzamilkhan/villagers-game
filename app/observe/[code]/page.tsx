"use client";

import { use, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useGameStream } from "@/lib/client";
import { useSound } from "@/lib/sound";
import type { ClientState, Phase, Role } from "@/lib/types";
import { Outcome, NIGHT_FLAVOR, pickNarration } from "@/lib/narration";

// A passive, read-only view of a game meant to be projected on a shared screen.
// It streams the same per-viewer filtered state as a player would — but as an
// observer, so hidden roles are never sent here. Nothing on this page can act.
export default function ObservePage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const code = use(params).code.toUpperCase();
  const router = useRouter();
  const { state, gone, connected } = useGameStream(code, null, true);
  const sound = useSound();

  // Play a phase cue on every phase change (and once the winner lands on
  // game_over). The observer screen is the one most likely projected for the
  // whole room, so it carries the same audio the player screen does — no-op
  // while sound is off. See the player page for the matching effect.
  useEffect(() => {
    if (!state) return;
    sound.playForPhase(state.phase, state.winner);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state?.phase, state?.winner]);

  if (gone) {
    return (
      <Screen phase="game_over">
        <div className="flex flex-1 flex-col items-center justify-center gap-6 text-center">
          <p className="font-display text-4xl text-parchment/90 md:text-6xl">
            This game has ended.
          </p>
          <button className="btn btn-ghost max-w-xs" onClick={() => router.push("/")}>
            Home
          </button>
        </div>
      </Screen>
    );
  }

  if (!state) {
    return (
      <Screen phase="lobby">
        <div className="flex flex-1 items-center justify-center">
          <p className="animate-pulse font-display text-3xl text-parchment/60 md:text-5xl">
            Finding the village…
          </p>
        </div>
      </Screen>
    );
  }

  return (
    <Screen phase={state.phase} winner={state.winner}>
      <Header
        code={code}
        state={state}
        connected={connected}
        soundEnabled={sound.enabled}
        onToggleSound={sound.toggle}
      />
      <div className="flex flex-1 flex-col gap-6 lg:flex-row">
        <Stage state={state} />
        <Roster state={state} />
      </div>
    </Screen>
  );
}

// Full-viewport shell — breaks out of the mobile `max-w-md` layout so the view
// fills a projector or TV. Reuses the same crossfading phase backdrops as the
// player screen so the day/night shift reads at a glance.
function Screen({
  phase,
  winner,
  children,
}: {
  phase: Phase;
  winner?: ClientState["winner"];
  children: React.ReactNode;
}) {
  const active = themeForPhase(phase, winner);
  return (
    <div className="fixed inset-0 flex flex-col overflow-hidden p-6 md:p-10">
      <div className="pointer-events-none fixed inset-0 -z-10" aria-hidden>
        {PHASE_THEMES.map((t) => (
          <div
            key={t}
            className={`phase-layer phase-${t} ${
              t === active ? "opacity-100" : "opacity-0"
            }`}
          />
        ))}
      </div>
      <AutoZoom>{children}</AutoZoom>
    </div>
  );
}

// Zooms the whole observer view up as one unit — everything bigger, in place,
// aspect ratio locked, centered — until it touches the nearest viewport edges.
// The phase background (outside this wrapper) fills any remaining space. Renders
// children at natural size and applies a uniform CSS scale; no reflow, so text
// never re-wraps and nothing moves relative to anything else.
// Fixed design width the content is laid out at before scaling. Pinning it makes
// wide text (outcome lines) wrap the same way every phase, so all phases share a
// stable aspect and zoom by a consistent-feeling amount — instead of wide-short
// phases blowing out their natural width and refusing to zoom.
const DESIGN_WIDTH = 1100;

function AutoZoom({ children }: { children: React.ReactNode }) {
  const outerRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  useLayoutEffect(() => {
    const outer = outerRef.current;
    const inner = innerRef.current;
    if (!outer || !inner) return;
    // offsetWidth/Height report the layout (pre-transform) size, so measuring is
    // independent of the scale we apply — no feedback loop.
    const measure = () => {
      const cw = inner.offsetWidth;
      const ch = inner.offsetHeight;
      if (cw === 0 || ch === 0) return;
      const next = Math.min(outer.clientWidth / cw, outer.clientHeight / ch);
      setScale(next > 0 ? next : 1);
    };
    const ro = new ResizeObserver(measure);
    ro.observe(outer);
    ro.observe(inner);
    measure();
    return () => ro.disconnect();
  }, []);

  return (
    <div
      ref={outerRef}
      className="flex flex-1 items-center justify-center overflow-hidden"
    >
      <div
        ref={innerRef}
        style={{
          width: DESIGN_WIDTH,
          transform: `scale(${scale})`,
          transformOrigin: "center",
        }}
      >
        {children}
      </div>
    </div>
  );
}

const PHASE_THEMES = [
  "lobby",
  "night",
  "dawn",
  "day",
  "verdict",
  "win-villagers",
  "win-killers",
] as const;
type PhaseTheme = (typeof PHASE_THEMES)[number];

function themeForPhase(phase: Phase, winner?: ClientState["winner"]): PhaseTheme {
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
      return winner === "killers" ? "win-killers" : "win-villagers";
    case "lobby":
    default:
      return "lobby";
  }
}

const PHASE_LABEL: Record<Phase, string> = {
  lobby: "The Gathering",
  night_action: "Night falls",
  resolve: "Dawn",
  day_vote: "The Trial",
  day_result: "The Verdict",
  game_over: "The End",
};

function Header({
  code,
  state,
  connected,
  soundEnabled,
  onToggleSound,
}: {
  code: string;
  state: ClientState;
  connected: boolean;
  soundEnabled: boolean;
  onToggleSound: () => void;
}) {
  const round = state.round > 0 ? ` · Round ${state.round}` : "";
  return (
    <div className="flex items-center justify-between text-parchment/85">
      <span className="font-display text-2xl md:text-4xl">
        {PHASE_LABEL[state.phase]}
        <span className="text-parchment/50">{round}</span>
      </span>
      <span className="flex items-center gap-4 font-display">
        <SoundToggle enabled={soundEnabled} onToggle={onToggleSound} />
        <span
          className={`h-3 w-3 rounded-full ${connected ? "bg-forest" : "bg-blood"}`}
        />
        <span className="tracking-[0.3em] text-3xl md:text-5xl text-gold">{code}</span>
      </span>
    </div>
  );
}

// Speaker toggle for the per-phase sound cues. Off by default (see useSound);
// enabling it is the user gesture that unlocks audio in the browser. Sized up
// for the projected observer view. Mirrors the player-page toggle.
function SoundToggle({
  enabled,
  onToggle,
}: {
  enabled: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      onClick={onToggle}
      aria-pressed={enabled}
      aria-label={enabled ? "Mute sound effects" : "Enable sound effects"}
      title={enabled ? "Sound on" : "Sound off"}
      className={`text-3xl leading-none md:text-4xl ${
        enabled ? "text-gold" : "text-parchment/40"
      }`}
    >
      {enabled ? "🔊" : "🔇"}
    </button>
  );
}

// The center of the screen — the current beat of the game, phase by phase.
function Stage({ state }: { state: ClientState }) {
  return (
    <div className="card flex flex-[2] flex-col items-center justify-center gap-4 p-8 text-center">
      {state.phase === "lobby" && (
        <>
          <p className="font-display text-2xl uppercase tracking-wide text-wood">
            Join at this table
          </p>
          <p className="font-display text-7xl font-bold tracking-[0.3em] text-ink md:text-9xl">
            {state.code}
          </p>
          <p className="text-xl text-wood md:text-2xl">
            {state.settings.killers} killer{state.settings.killers > 1 ? "s" : ""}
            {state.settings.healer ? " · 1 healer" : ""} · up to{" "}
            {state.settings.maxPlayers} players
          </p>
          <p className="mt-2 text-lg text-wood/80">
            {state.players.length} gathered so far…
          </p>
        </>
      )}

      {state.phase === "night_action" && (
        <>
          <p className="font-display text-5xl text-ink md:text-7xl">
            The village sleeps
          </p>
          <p className="text-xl text-wood md:text-2xl">
            {pickNarration(NIGHT_FLAVOR, state.narrationSeq, state.round)}
          </p>
          <Progress state={state} label="acted" />
        </>
      )}

      {state.phase === "resolve" && (
        <p className="font-display text-4xl leading-relaxed text-ink md:text-6xl">
          {state.nightOutcome ? (
            <Outcome events={state.nightOutcome} />
          ) : (
            "Dawn breaks over the village…"
          )}
        </p>
      )}

      {state.phase === "day_vote" && <VoteTally state={state} />}

      {state.phase === "day_result" && (
        <p className="font-display text-4xl leading-relaxed text-ink md:text-6xl">
          {state.dayOutcome ? (
            <Outcome events={state.dayOutcome} />
          ) : (
            "The village deliberates…"
          )}
        </p>
      )}

      {state.phase === "game_over" && (
        <>
          <p
            className={`font-display text-5xl font-bold md:text-8xl ${
              state.winner === "villagers" ? "text-forest" : "text-blood"
            }`}
          >
            {state.winner === "villagers"
              ? "The Village Prevails"
              : "The Killers Win"}
          </p>
          <p className="text-xl text-wood md:text-2xl">Every role now stands revealed.</p>
        </>
      )}
    </div>
  );
}

function Progress({ state, label }: { state: ClientState; label: string }) {
  const pct = state.voterCount
    ? Math.round((state.submittedCount / state.voterCount) * 100)
    : 0;
  return (
    <div className="mt-4 w-full max-w-md">
      <div className="h-4 w-full overflow-hidden rounded-full border-2 border-wood-light bg-wood/30">
        <div
          className="h-full bg-gold transition-all duration-500"
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="mt-2 font-display text-lg text-wood">
        {state.submittedCount} of {state.voterCount} {label}
      </p>
    </div>
  );
}

// Live, public running tally during the day vote — the same data players see,
// blown up for the room to watch the majority build.
function VoteTally({ state }: { state: ClientState }) {
  const nameByToken = new Map(state.players.map((p) => [p.token, p.name]));
  const counts = new Map<string, number>();
  for (const target of Object.values(state.liveVotes ?? {})) {
    counts.set(target, (counts.get(target) ?? 0) + 1);
  }
  const living = state.players.filter((p) => p.alive);
  const max = Math.max(1, ...counts.values());
  // Keep rows in stable roster (join) order — do NOT sort by vote count, so a
  // player's row stays put while its bar fills; only the counts/widths change.
  const rows = living.map((p) => ({ name: p.name, count: counts.get(p.token) ?? 0 }));

  return (
    <div className="flex w-full flex-col gap-3">
      <p className="font-display text-3xl text-ink md:text-5xl">Who shall be cast out?</p>
      <div className="mt-2 flex flex-col gap-2">
        {rows.map((r) => (
          <div key={r.name} className="flex items-center gap-3">
            <span className="w-40 shrink-0 text-right font-display text-xl text-ink md:text-2xl">
              {r.name}
            </span>
            <div className="h-8 flex-1 overflow-hidden rounded-lg bg-wood/20">
              <div
                className="flex h-full items-center justify-end rounded-lg bg-gold px-2 font-display text-ink transition-all duration-500"
                style={{ width: `${(r.count / max) * 100}%` }}
              >
                {r.count > 0 && r.count}
              </div>
            </div>
          </div>
        ))}
      </div>
      <p className="mt-2 font-display text-lg text-wood">
        {state.submittedCount} of {state.voterCount} have voted
      </p>
    </div>
  );
}

const ROLE_COLOR: Record<Role, string> = {
  killer: "text-blood",
  healer: "text-forest",
  villager: "text-parchment/70",
};

// The cast, always on screen: who's still standing, who's fallen, and — once
// the game is over — what everyone was.
function Roster({ state }: { state: ClientState }) {
  return (
    <div className="flex flex-1 flex-col gap-3 overflow-y-auto">
      <p className="font-display text-2xl text-parchment/80">
        The Village ({state.livingCount} living)
      </p>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {state.players.map((p) => (
          <div
            key={p.token}
            className={`flex flex-col rounded-lg border-2 px-4 py-3 ${
              p.alive
                ? "border-wood-light bg-wood/40"
                : "border-wood-light/40 bg-black/30 opacity-60"
            }`}
          >
            <span className="flex items-center gap-2 font-display text-xl md:text-2xl">
              {!p.alive && <span aria-hidden>💀</span>}
              <span
                className={
                  p.alive
                    ? "text-parchment"
                    : "text-parchment/50 line-through"
                }
              >
                {p.name}
              </span>
            </span>
            {/* Fixed-height label slot so every row is the same height whether
                or not it carries a role/host tag. */}
            <span className="mt-0.5 flex h-5 items-center gap-2 text-sm">
              {p.isHost && <span className="text-gold">(Elder)</span>}
              {p.role ? (
                <span className={`font-display ${ROLE_COLOR[p.role]}`}>
                  ({p.role})
                </span>
              ) : (
                !p.isHost && (
                  <span
                    className={`h-2.5 w-2.5 rounded-full ${
                      p.connected ? "bg-forest" : "bg-wood-light/50"
                    }`}
                    title={p.connected ? "connected" : "away"}
                  />
                )
              )}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
