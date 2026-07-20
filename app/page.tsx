"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { saveToken, postAction } from "@/lib/client";
import { normalizeCode } from "@/lib/codes";
import { minPlayersToStart } from "@/lib/types";
import type { GameSettings } from "@/lib/types";

export default function Home() {
  return (
    <Suspense fallback={null}>
      <HomeInner />
    </Suspense>
  );
}

function HomeInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  // Arriving at /?join=CODE (e.g. redirected from /play/CODE without a token)
  // drops the player straight into the join form with the code prefilled.
  const prefillCode = normalizeCode(searchParams.get("join") ?? "");
  const [mode, setMode] = useState<"menu" | "create" | "join" | "observe">(
    prefillCode ? "join" : "menu"
  );
  const [name, setName] = useState("");
  const [code, setCode] = useState(prefillCode);
  const [killers, setKillers] = useState(1);
  const [healer, setHealer] = useState(true);
  const [ghostVotes, setGhostVotes] = useState(false);
  const [maxPlayers, setMaxPlayers] = useState(10);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function createGame() {
    if (!name.trim()) return setError("Enter your name.");
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/room/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          settings: { killers, healer, ghostVotes, maxPlayers, actionTimerSec: 60 },
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Failed.");
      saveToken(data.code, data.token);
      router.push(`/play/${data.code}`);
    } catch (e: any) {
      setError(e.message);
      setBusy(false);
    }
  }

  async function joinGame() {
    const c = normalizeCode(code);
    if (!name.trim()) return setError("Enter your name.");
    if (!c) return setError("Enter a game code.");
    setBusy(true);
    setError("");
    const res = await postAction(c, "join", { name });
    if (!res.ok) {
      setError(res.error ?? "Failed.");
      setBusy(false);
      return;
    }
    saveToken(c, res.data.token);
    router.push(`/play/${c}`);
  }

  function observeGame() {
    const c = normalizeCode(code);
    if (!c) return setError("Enter a game code.");
    router.push(`/observe/${c}`);
  }

  return (
    <div className="flex flex-1 flex-col justify-center gap-6">
      <header className="text-center">
        <h1 className="font-display text-5xl font-bold tracking-wide text-gold">
          Villagers
        </h1>
        <p className="mt-2 text-parchment/70">Trust no one after dark.</p>
      </header>

      {mode === "menu" && (
        <div className="flex flex-col gap-3">
          <button className="btn btn-primary" onClick={() => setMode("create")}>
            Create
          </button>
          <button className="btn btn-ghost" onClick={() => setMode("join")}>
            Join
          </button>
          <button className="btn btn-ghost" onClick={() => setMode("observe")}>
            Spectate
          </button>
          <p className="text-center text-sm text-parchment/50">
            Spectating shows the game on a shared screen — great for projecting.
          </p>
        </div>
      )}

      {mode !== "menu" && (
        <div className="card flex flex-col gap-4 p-5">
          {mode === "observe" && (
            <p className="text-center text-ink/70">
              Watch the game unfold without joining — no name needed. Ideal for a
              big screen everyone can see.
            </p>
          )}

          {mode !== "observe" && (
            <label className="flex flex-col gap-1">
              <span className="font-display text-sm uppercase tracking-wide">Your name</span>
              <input
                className="rounded-lg border-2 border-wood-light bg-parchment px-3 py-2 text-lg text-ink outline-none"
                value={name}
                maxLength={20}
                placeholder="Sir Reginald"
                onChange={(e) => setName(e.target.value)}
              />
            </label>
          )}

          {(mode === "join" || mode === "observe") && (
            <label className="flex flex-col gap-1">
              <span className="font-display text-sm uppercase tracking-wide">Game code</span>
              <input
                className="rounded-lg border-2 border-wood-light bg-parchment px-3 py-2 text-2xl uppercase tracking-[0.3em] text-ink outline-none"
                value={code}
                maxLength={6}
                placeholder="ABCD"
                onChange={(e) => setCode(e.target.value.toUpperCase())}
              />
            </label>
          )}

          {mode === "create" && (
            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <span className="font-display text-sm uppercase tracking-wide">Killers</span>
                <div className="flex gap-2">
                  {[1, 2].map((k) => (
                    <button
                      key={k}
                      className={`h-10 w-10 rounded-lg border-2 font-display ${
                        killers === k
                          ? "border-blood bg-blood text-parchment"
                          : "border-wood-light bg-parchment/40 text-ink"
                      }`}
                      onClick={() => {
                        setKillers(k);
                        // Keep the cap at or above the killer-scaled minimum so
                        // the room can always reach a startable size.
                        const min = minPlayersToStart({ killers: k } as GameSettings);
                        setMaxPlayers((m) => Math.max(m, min));
                      }}
                    >
                      {k}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex items-center justify-between">
                <span className="font-display text-sm uppercase tracking-wide">Healer</span>
                <button
                  className={`h-10 w-20 rounded-lg border-2 font-display ${
                    healer
                      ? "border-forest bg-forest text-parchment"
                      : "border-wood-light bg-parchment/40 text-ink"
                  }`}
                  onClick={() => setHealer((h) => !h)}
                >
                  {healer ? "Yes" : "No"}
                </button>
              </div>
              <div className="flex items-center justify-between">
                <span className="font-display text-sm uppercase tracking-wide">Ghost votes</span>
                <button
                  className={`h-10 w-20 rounded-lg border-2 font-display ${
                    ghostVotes
                      ? "border-gold bg-gold text-ink"
                      : "border-wood-light bg-parchment/40 text-ink"
                  }`}
                  onClick={() => setGhostVotes((g) => !g)}
                >
                  {ghostVotes ? "Yes" : "No"}
                </button>
              </div>
              <div className="flex items-center justify-between">
                <span className="font-display text-sm uppercase tracking-wide">Max players</span>
                <input
                  type="range"
                  min={minPlayersToStart({ killers } as GameSettings)}
                  max={10}
                  value={maxPlayers}
                  onChange={(e) => setMaxPlayers(Number(e.target.value))}
                  className="w-32"
                />
                <span className="w-6 text-center font-display text-lg">{maxPlayers}</span>
              </div>
            </div>
          )}

          {error && <p className="text-center font-semibold text-blood">{error}</p>}

          <button
            className="btn btn-primary"
            disabled={busy}
            onClick={
              mode === "create"
                ? createGame
                : mode === "observe"
                  ? observeGame
                  : joinGame
            }
          >
            {busy
              ? "…"
              : mode === "create"
                ? "Create"
                : mode === "observe"
                  ? "Spectate"
                  : "Join"}
          </button>
          <button className="btn btn-ghost" onClick={() => setMode("menu")} disabled={busy}>
            Back
          </button>
        </div>
      )}
    </div>
  );
}
