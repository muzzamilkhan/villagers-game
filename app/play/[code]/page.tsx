"use client";

import { use, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  loadToken,
  clearToken,
  useGameStream,
  postAction,
} from "@/lib/client";
import { useSound } from "@/lib/sound";
import { minPlayersToStart } from "@/lib/types";
import type { ClientState, Phase, Role } from "@/lib/types";
import { Outcome, DAWN_FLAVOR, pickNarration } from "@/lib/narration";

const ROLE_INFO: Record<Role, { title: string; blurb: string; color: string }> = {
  villager: {
    title: "Villager",
    blurb: "Find the killers before they take the village. Your night choice does nothing — but choose anyway.",
    color: "text-ink",
  },
  killer: {
    title: "Killer",
    blurb: "Each night, choose your victim. Blend in by day. Fellow killers are marked below.",
    color: "text-blood",
  },
  healer: {
    title: "Healer",
    blurb: "Each night, choose someone to protect. You may not shield the same soul twice in a row.",
    color: "text-forest",
  },
};

export default function GamePage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const code = use(params).code.toUpperCase();
  const router = useRouter();
  const [token, setToken] = useState<string | null>(null);
  const [roleRevealed, setRoleRevealed] = useState(false);
  const [err, setErr] = useState("");
  const [showPlayers, setShowPlayers] = useState(false);

  useEffect(() => {
    const t = loadToken(code);
    if (!t) {
      router.replace(`/?join=${code}`);
      return;
    }
    setToken(t);
  }, [code, router]);

  const { state, gone, connected } = useGameStream(code, token);
  const sound = useSound();

  // reset the role reveal each new round
  useEffect(() => {
    if (state?.phase === "night_action") setRoleRevealed(false);
  }, [state?.round, state?.phase]);

  // Play a phase cue on every phase change (and once the winner lands on
  // game_over). No-op while sound is off. `playForPhase` is stable per
  // enabled-state, so this fires on genuine transitions, not on every publish.
  useEffect(() => {
    if (!state) return;
    sound.playForPhase(state.phase, state.winner);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state?.phase, state?.winner]);

  if (gone) {
    return (
      <Centered>
        <p className="text-center text-xl">This game has ended.</p>
        <button
          className="btn btn-primary mt-4"
          onClick={() => {
            clearToken(code);
            router.push("/");
          }}
        >
          Home
        </button>
      </Centered>
    );
  }

  if (!token || !state) {
    return (
      <Centered>
        <p className="animate-pulse text-parchment/60">Entering the village…</p>
      </Centered>
    );
  }

  const isHost = state.you.isHost;
  const alive = state.you.alive;

  async function act(path: string, body: Record<string, unknown>) {
    setErr("");
    const res = await postAction(code, path, { token, ...body });
    if (!res.ok) setErr(res.error ?? "Error");
  }

  return (
    <div className="flex flex-1 flex-col gap-4">
      <PhaseBackground state={state} />
      <TopBar
        code={code}
        state={state}
        connected={connected}
        isHost={isHost}
        act={act}
        soundEnabled={sound.enabled}
        onToggleSound={sound.toggle}
        showPlayers={showPlayers}
        onTogglePlayers={
          isHost && state.phase !== "lobby"
            ? () => setShowPlayers((v) => !v)
            : undefined
        }
      />

      {isHost && state.phase !== "lobby" && showPlayers && (
        <PlayersPanel
          state={state}
          act={act}
          onClose={() => setShowPlayers(false)}
        />
      )}

      {err && <p className="text-center font-semibold text-blood">{err}</p>}

      {state.phase === "lobby" && (
        <Lobby state={state} isHost={isHost} act={act} />
      )}

      {(state.phase === "night_action" ||
        state.phase === "day_vote") && (
        <RoundView
          state={state}
          alive={alive}
          isHost={isHost}
          roleRevealed={roleRevealed}
          onToggle={() => setRoleRevealed((v) => !v)}
          act={act}
        />
      )}

      {(state.phase === "resolve" || state.phase === "day_result") && (
        <ResultView state={state} isHost={isHost} act={act} />
      )}

      {state.phase === "game_over" && (
        <GameOver state={state} code={code} router={router} />
      )}
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center">{children}</div>
  );
}

// Fixed backdrop that tells you the phase at a glance: two stable states
// (night = dark, day = light) with the transitions between them — dawn, the
// verdict, and a win-tinted ending — plus the neutral lobby. Every theme is
// always rendered; only the active one is opaque, so the shift crossfades
// smoothly (the dark→dawn→light sweep reads like time passing).
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

function PhaseBackground({ state }: { state: ClientState }) {
  const active = themeForPhase(state.phase, state.winner);
  return (
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
  );
}

function TopBar({
  code,
  state,
  connected,
  isHost,
  act,
  soundEnabled,
  onToggleSound,
  showPlayers,
  onTogglePlayers,
}: {
  code: string;
  state: ClientState;
  connected: boolean;
  isHost: boolean;
  act: (p: string, b: Record<string, unknown>) => void;
  soundEnabled: boolean;
  onToggleSound: () => void;
  showPlayers: boolean;
  onTogglePlayers?: () => void;
}) {
  const phaseLabel: Record<string, string> = {
    lobby: "The Gathering",
    night_action: `Night ${state.round}`,
    resolve: "Dawn",
    day_vote: `Day ${state.round} — The Trial`,
    day_result: "The Verdict",
    game_over: "The End",
  };
  return (
    <div className="flex items-center justify-between text-parchment/80">
      <span className="flex items-center gap-3">
        <span className="font-display text-lg">{phaseLabel[state.phase]}</span>
        {isHost && <EndGameButton act={act} />}
        {onTogglePlayers && (
          <button
            className={`rounded-md border px-2 py-1 text-xs ${
              showPlayers
                ? "border-gold bg-gold/20 text-gold"
                : "border-wood-light text-parchment/70"
            }`}
            onClick={onTogglePlayers}
          >
            Players
          </button>
        )}
      </span>
      <span className="flex items-center gap-2 text-sm">
        <SoundToggle enabled={soundEnabled} onToggle={onToggleSound} />
        <span
          className={`h-2 w-2 rounded-full ${
            connected ? "bg-forest" : "bg-blood"
          }`}
        />
        {code}
      </span>
    </div>
  );
}

// Speaker toggle for the per-phase sound cues. Off by default (see useSound);
// enabling it is the user gesture that unlocks audio in the browser.
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
      className={`text-base leading-none ${
        enabled ? "text-gold" : "text-parchment/40"
      }`}
    >
      {enabled ? "🔊" : "🔇"}
    </button>
  );
}

// Host-only. Two-tap confirm so the game isn't ended by accident. Ending wipes
// the room from Redis; every player then sees "This game has ended."
function EndGameButton({
  act,
}: {
  act: (p: string, b: Record<string, unknown>) => void;
}) {
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    if (!confirming) return;
    const t = setTimeout(() => setConfirming(false), 4000);
    return () => clearTimeout(t);
  }, [confirming]);

  if (confirming) {
    return (
      <button
        className="rounded-md border border-blood bg-blood/20 px-2 py-1 text-xs font-semibold text-blood"
        onClick={() => act("end", {})}
      >
        End for everyone?
      </button>
    );
  }
  return (
    <button
      className="rounded-md border border-blood px-2 py-1 text-xs text-blood"
      onClick={() => setConfirming(true)}
    >
      End game
    </button>
  );
}

// Host-only roster shown during the game. Surfaces who's offline (left or
// inactive) or already a ghost, and lets the host remove anyone but themselves.
// Kicking mid-game re-checks the win condition on the server.
function PlayersPanel({
  state,
  act,
  onClose,
}: {
  state: ClientState;
  act: (p: string, b: Record<string, unknown>) => void;
  onClose: () => void;
}) {
  return (
    <div className="card flex flex-col gap-2 p-4">
      <div className="flex items-center justify-between">
        <p className="font-display text-ink">Manage players</p>
        <button
          className="text-sm text-wood underline"
          onClick={onClose}
        >
          close
        </button>
      </div>
      {state.players.map((p) => (
        <div
          key={p.token}
          className="flex items-center justify-between rounded-lg border-2 border-wood-light bg-wood/40 px-3 py-2"
        >
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-display text-lg text-parchment">{p.name}</span>
            {p.isHost && <span className="text-xs text-gold">Village Elder</span>}
            {p.token === state.you.token && (
              <span className="text-xs text-parchment/50">you</span>
            )}
            {!p.alive && <span className="text-xs text-blood">ghost</span>}
            {!p.connected && (
              <span className="rounded-full bg-blood/20 px-2 text-xs text-blood">
                offline
              </span>
            )}
          </span>
          {!p.isHost && <KickButton token={p.token} act={act} />}
        </div>
      ))}
      <p className="text-xs text-wood">
        Removing a player can end the game if it changes who&apos;s left standing.
      </p>
    </div>
  );
}

// Two-tap confirm so a player isn't removed mid-game by accident.
function KickButton({
  token,
  act,
}: {
  token: string;
  act: (p: string, b: Record<string, unknown>) => void;
}) {
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    if (!confirming) return;
    const t = setTimeout(() => setConfirming(false), 4000);
    return () => clearTimeout(t);
  }, [confirming]);

  if (confirming) {
    return (
      <button
        className="rounded-md border border-blood bg-blood/20 px-2 py-1 text-sm font-semibold text-blood"
        onClick={() => act("kick", { target: token })}
      >
        Remove?
      </button>
    );
  }
  return (
    <button
      className="rounded-md border border-blood px-2 py-1 text-sm text-blood"
      onClick={() => setConfirming(true)}
    >
      kick
    </button>
  );
}

function Lobby({
  state,
  isHost,
  act,
}: {
  state: ClientState;
  isHost: boolean;
  act: (p: string, b: Record<string, unknown>) => void;
}) {
  const s = state.settings;
  const minToStart = minPlayersToStart(s);
  return (
    <div className="flex flex-1 flex-col gap-4">
      <div className="card p-5 text-center">
        <p className="font-display text-sm uppercase tracking-wide text-wood-light">
          Share this code
        </p>
        <p className="my-1 font-display text-5xl font-bold tracking-[0.3em] text-ink">
          {state.code}
        </p>
        <p className="text-sm text-wood">
          {s.killers} killer{s.killers > 1 ? "s" : ""}
          {s.healer ? " · 1 healer" : ""} · up to {s.maxPlayers} players
        </p>
      </div>

      <ShareLink code={state.code} />

      <div className="flex flex-col gap-2">
        <p className="font-display text-parchment/80">
          Players ({state.players.length})
        </p>
        {state.players.map((p) => (
          <div
            key={p.token}
            className="flex items-center justify-between rounded-lg border-2 border-wood-light bg-wood/40 px-3 py-2"
          >
            <span className="font-display text-lg">
              {p.name}
              {p.isHost && (
                <span className="ml-2 text-sm text-gold">Village Elder</span>
              )}
              {p.token === state.you.token && (
                <span className="ml-2 text-sm text-parchment/50">you</span>
              )}
            </span>
            {isHost && !p.isHost && (
              <button
                className="rounded-md border border-blood px-2 py-1 text-sm text-blood"
                onClick={() => act("kick", { target: p.token })}
              >
                kick
              </button>
            )}
          </div>
        ))}
      </div>

      <div className="mt-auto">
        {isHost ? (
          <button
            className="btn btn-primary"
            disabled={state.players.length < minToStart}
            onClick={() => act("start", {})}
          >
            {state.players.length < minToStart
              ? `Need ${minToStart}+ players`
              : "Begin the Game"}
          </button>
        ) : (
          <p className="text-center text-parchment/60">
            Waiting for the Village Elder to begin…
          </p>
        )}
      </div>
    </div>
  );
}

// Any player can copy a join link (/play/CODE) to the clipboard to spread it
// around a group chat. The link carries the code, so it isn't shown inline
// here — recipients open it and land on the join form, code prefilled.
function ShareLink({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    const url = `${window.location.origin}/play/${code}`;
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      // Clipboard API can be blocked (insecure context / permissions);
      // fall back to a legacy execCommand copy via a hidden textarea.
      const ta = document.createElement("textarea");
      ta.value = url;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand("copy");
      } finally {
        document.body.removeChild(ta);
      }
    }
    setCopied(true);
  }

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(t);
  }, [copied]);

  return (
    <button className="btn btn-ghost" onClick={copy}>
      {copied ? "Link copied!" : "Copy invite link"}
    </button>
  );
}

function RoleCard({
  state,
  revealed,
  onToggle,
}: {
  state: ClientState;
  revealed: boolean;
  onToggle: () => void;
}) {
  const info = ROLE_INFO[state.you.role];
  if (!revealed) {
    return (
      <button className="card p-6 text-center" onClick={onToggle}>
        <p className="font-display text-lg">Tap to reveal your role</p>
        <p className="mt-1 text-sm text-wood">(make sure no one is looking)</p>
      </button>
    );
  }
  const fellowKillers =
    state.you.role === "killer"
      ? state.players.filter(
          (p) => p.role === "killer" && p.token !== state.you.token
        )
      : [];
  return (
    <button className="card w-full p-5 text-center" onClick={onToggle}>
      <p className={`font-display text-3xl font-bold ${info.color}`}>
        {info.title}
      </p>
      <p className="mt-2 text-sm text-wood">{info.blurb}</p>
      {fellowKillers.length > 0 && (
        <p className="mt-2 font-display text-blood">
          With you: {fellowKillers.map((p) => p.name).join(", ")}
        </p>
      )}
      <p className="mt-3 text-xs text-wood/70">(tap to hide)</p>
    </button>
  );
}

function RoundView({
  state,
  alive,
  isHost,
  roleRevealed,
  onToggle,
  act,
}: {
  state: ClientState;
  alive: boolean;
  isHost: boolean;
  roleRevealed: boolean;
  onToggle: () => void;
  act: (p: string, b: Record<string, unknown>) => void;
}) {
  const isNight = state.phase === "night_action";
  const path = isNight ? "action" : "vote";
  const prompt = isNight
    ? "Choose a villager"
    : "Vote for who you suspect";

  // Dead players can cast a day vote when the host enabled ghost votes —
  // but never dead killers, who would only help their own side.
  const ghostCanVote =
    !isNight &&
    !alive &&
    state.settings.ghostVotes &&
    state.you.role !== "killer";
  const canVote = alive || ghostCanVote;

  const targets = state.players.filter(
    (p) => p.alive && p.token !== state.you.token
  );

  // Day vote is public: map each candidate to the names voting for them so
  // everyone can watch the tally build toward a majority in real time.
  const nameByToken = new Map(state.players.map((p) => [p.token, p.name]));
  const votersByTarget = new Map<string, string[]>();
  if (!isNight && state.liveVotes) {
    for (const [voter, target] of Object.entries(state.liveVotes)) {
      const list = votersByTarget.get(target) ?? [];
      list.push(nameByToken.get(voter) ?? "?");
      votersByTarget.set(target, list);
    }
  }

  return (
    <div className="flex flex-1 flex-col gap-4">
      {isNight && alive && (
        <RoleCard
          state={state}
          revealed={roleRevealed}
          onToggle={onToggle}
        />
      )}

      {canVote ? (
        <>
          {ghostCanVote && (
            <p className="text-center text-sm text-blood">
              You are a ghost — but your voice still counts.
            </p>
          )}
          <p className="text-center font-display text-lg text-parchment/90">
            {prompt}
          </p>
          <div className="grid grid-cols-2 gap-3">
            {targets.map((p) => {
              const picked = state.yourPick === p.token;
              const voters = votersByTarget.get(p.token) ?? [];
              return (
                <button
                  key={p.token}
                  className={`crest relative overflow-hidden ${
                    picked
                      ? "border-gold bg-gold/30"
                      : "border-wood-light bg-wood/40"
                  }`}
                  onClick={() => act(path, { target: p.token })}
                >
                  {!isNight && state.voterCount > 0 && (
                    <span
                      aria-hidden
                      className="pointer-events-none absolute inset-y-0 left-0 bg-black/20 transition-[width] duration-500"
                      style={{
                        width: `${Math.round(
                          (voters.length / state.voterCount) * 100
                        )}%`,
                      }}
                    />
                  )}
                  <span className="relative z-10 flex flex-col items-center">
                    <span className="font-display text-lg text-parchment">
                      {p.name}
                      {!isNight && voters.length > 0 && (
                        <span className="ml-2 rounded-full bg-gold/30 px-2 text-sm text-gold">
                          {voters.length}
                        </span>
                      )}
                    </span>
                    {picked && (
                      <span className="text-xs text-gold">
                        {isNight ? "chosen" : "your vote"}
                      </span>
                    )}
                    {!isNight && voters.length > 0 && (
                      <span className="mt-0.5 text-xs leading-tight text-parchment/60">
                        {voters.join(", ")}
                      </span>
                    )}
                  </span>
                </button>
              );
            })}
          </div>
          {state.yourPick && isNight && (
            <p className="text-center text-sm text-parchment/60">
              Locked in. Waiting for the others…
            </p>
          )}
        </>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="card p-6 text-center">
            <p className="font-display text-xl text-blood">You are a ghost</p>
            <p className="mt-1 text-sm text-wood">
              Watch in silence. You cannot act or vote.
            </p>
          </div>
          {!isNight && (
            <div className="flex flex-col gap-2">
              {targets.map((p) => {
                const voters = votersByTarget.get(p.token) ?? [];
                return (
                  <div
                    key={p.token}
                    className="flex items-center justify-between rounded-lg border-2 border-wood-light bg-wood/40 px-3 py-2"
                  >
                    <span className="font-display text-lg text-parchment">
                      {p.name}
                    </span>
                    <span className="text-sm text-parchment/60">
                      {voters.length > 0 ? voters.join(", ") : "—"}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      <div className="mt-auto flex flex-col gap-2">
        <p className="text-center text-sm text-parchment/60">
          {state.submittedCount} / {state.voterCount} chosen
        </p>
        {isHost && (
          <button
            className="btn btn-primary"
            onClick={() => act("advance", {})}
          >
            {isNight ? "Reveal the Dawn" : "Lock in the Votes"}
          </button>
        )}
      </div>
    </div>
  );
}

function ResultView({
  state,
  isHost,
  act,
}: {
  state: ClientState;
  isHost: boolean;
  act: (p: string, b: Record<string, unknown>) => void;
}) {
  const isNight = state.phase === "resolve";
  const events = isNight ? state.nightOutcome : state.dayOutcome;

  // Night holds a ~3.5s suspense before the reveal; day reveals immediately.
  const [revealed, setRevealed] = useState(!isNight);
  // A death/exile is a big deal: after the outcome is visible, wait 2s before
  // the host may advance, so everyone can soak it in. Nothing auto-advances.
  const [continueReady, setContinueReady] = useState(false);

  useEffect(() => {
    if (!isNight) {
      setRevealed(true);
      return;
    }
    setRevealed(false);
    const t = setTimeout(() => setRevealed(true), 3500);
    return () => clearTimeout(t);
  }, [isNight]);

  useEffect(() => {
    if (!revealed) return;
    setContinueReady(false);
    const t = setTimeout(() => setContinueReady(true), 2000);
    return () => clearTimeout(t);
  }, [revealed]);

  if (isNight && !revealed) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
        <p className="animate-pulse font-display text-2xl text-parchment/85">
          {pickNarration(DAWN_FLAVOR, state.narrationSeq, state.round)}
        </p>
        <p className="text-sm text-parchment/50">
          The deeds of the night come to light.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col gap-4">
      <div className="card flex flex-1 flex-col items-center justify-center p-6 text-center">
        <p className="font-display text-xl leading-relaxed text-ink">
          <Outcome events={events} />
        </p>
      </div>
      {isHost ? (
        continueReady ? (
          <button className="btn btn-primary" onClick={() => act("advance", {})}>
            Continue
          </button>
        ) : (
          <p className="text-center text-parchment/60">Let it settle…</p>
        )
      ) : (
        <p className="text-center text-parchment/60">
          Waiting for the Village Elder…
        </p>
      )}
    </div>
  );
}

function GameOver({
  state,
  code,
  router,
}: {
  state: ClientState;
  code: string;
  router: ReturnType<typeof useRouter>;
}) {
  const villagersWon = state.winner === "villagers";
  return (
    <div className="flex flex-1 flex-col gap-4">
      <div
        className={`card p-6 text-center ${
          villagersWon ? "" : "border-blood"
        }`}
      >
        <p
          className={`font-display text-3xl font-bold ${
            villagersWon ? "text-forest" : "text-blood"
          }`}
        >
          {villagersWon ? "The Village Prevails" : "The Killers Win"}
        </p>
      </div>
      <div className="flex flex-col gap-2">
        <p className="font-display text-parchment/80">Roles revealed</p>
        {state.players.map((p) => (
          <div
            key={p.token}
            className="flex items-center justify-between rounded-lg border-2 border-wood-light bg-wood/40 px-3 py-2"
          >
            <span className="font-display text-lg">{p.name}</span>
            <span
              className={`font-display ${
                p.role === "killer"
                  ? "text-blood"
                  : p.role === "healer"
                    ? "text-forest"
                    : "text-parchment/70"
              }`}
            >
              {p.role}
            </span>
          </div>
        ))}
      </div>
      <button
        className="btn btn-primary mt-auto"
        onClick={() => {
          clearToken(code);
          router.push("/");
        }}
      >
        Home
      </button>
    </div>
  );
}
