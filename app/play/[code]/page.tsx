"use client";

import { use, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  loadToken,
  clearToken,
  useGameStream,
  postAction,
} from "@/lib/client";
import type { ClientState, Role } from "@/lib/types";

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

  useEffect(() => {
    const t = loadToken(code);
    if (!t) {
      router.replace(`/?join=${code}`);
      return;
    }
    setToken(t);
  }, [code, router]);

  const { state, gone, connected } = useGameStream(code, token);

  // reset the role reveal each new round
  useEffect(() => {
    if (state?.phase === "night_action") setRoleRevealed(false);
  }, [state?.round, state?.phase]);

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
      <TopBar code={code} state={state} connected={connected} />

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
          onReveal={() => setRoleRevealed(true)}
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

function TopBar({
  code,
  state,
  connected,
}: {
  code: string;
  state: ClientState;
  connected: boolean;
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
      <span className="font-display text-lg">{phaseLabel[state.phase]}</span>
      <span className="flex items-center gap-2 text-sm">
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
  const minToStart = Math.max(4, s.killers + (s.healer ? 1 : 0) + 2);
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
              {p.isHost && <span className="ml-2 text-sm text-gold">host</span>}
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
            Waiting for the host to begin…
          </p>
        )}
      </div>
    </div>
  );
}

function RoleCard({
  state,
  revealed,
  onReveal,
}: {
  state: ClientState;
  revealed: boolean;
  onReveal: () => void;
}) {
  const info = ROLE_INFO[state.you.role];
  if (!revealed) {
    return (
      <button className="card p-6 text-center" onClick={onReveal}>
        <p className="font-display text-lg">Tap to reveal your role</p>
        <p className="mt-1 text-sm text-wood">(keep it hidden from others)</p>
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
    <div className="card p-5 text-center">
      <p className={`font-display text-3xl font-bold ${info.color}`}>
        {info.title}
      </p>
      <p className="mt-2 text-sm text-wood">{info.blurb}</p>
      {fellowKillers.length > 0 && (
        <p className="mt-2 font-display text-blood">
          With you: {fellowKillers.map((p) => p.name).join(", ")}
        </p>
      )}
    </div>
  );
}

function RoundView({
  state,
  alive,
  isHost,
  roleRevealed,
  onReveal,
  act,
}: {
  state: ClientState;
  alive: boolean;
  isHost: boolean;
  roleRevealed: boolean;
  onReveal: () => void;
  act: (p: string, b: Record<string, unknown>) => void;
}) {
  const isNight = state.phase === "night_action";
  const path = isNight ? "action" : "vote";
  const prompt = isNight
    ? "Choose a villager"
    : "Vote for who you suspect";

  const targets = state.players.filter(
    (p) => p.alive && p.token !== state.you.token
  );

  return (
    <div className="flex flex-1 flex-col gap-4">
      {isNight && (
        <RoleCard state={state} revealed={roleRevealed} onReveal={onReveal} />
      )}

      {alive ? (
        <>
          <p className="text-center font-display text-lg text-parchment/90">
            {prompt}
          </p>
          <div className="grid grid-cols-2 gap-3">
            {targets.map((p) => {
              const picked = state.yourPick === p.token;
              return (
                <button
                  key={p.token}
                  className={`crest ${
                    picked
                      ? "border-gold bg-gold/30"
                      : "border-wood-light bg-wood/40"
                  }`}
                  onClick={() => act(path, { target: p.token })}
                >
                  <span className="font-display text-lg text-parchment">
                    {p.name}
                  </span>
                  {picked && (
                    <span className="text-xs text-gold">
                      {isNight ? "chosen" : "your vote"}
                    </span>
                  )}
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
        <div className="card p-6 text-center">
          <p className="font-display text-xl text-blood">You are a ghost</p>
          <p className="mt-1 text-sm text-wood">
            Watch in silence. You cannot act or vote.
          </p>
        </div>
      )}

      <div className="mt-auto flex flex-col gap-2">
        <p className="text-center text-sm text-parchment/60">
          {state.submittedCount} / {state.livingCount} chosen
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
  const text = isNight ? state.announcement : state.voteResult;
  return (
    <div className="flex flex-1 flex-col gap-4">
      <div className="card flex flex-1 flex-col items-center justify-center p-6 text-center">
        <p className="font-display text-xl leading-relaxed text-ink">{text}</p>
      </div>
      {isHost ? (
        <button className="btn btn-primary" onClick={() => act("advance", {})}>
          {isNight ? "Call the Trial" : "Onward to Night"}
        </button>
      ) : (
        <p className="text-center text-parchment/60">
          Waiting for the host…
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
