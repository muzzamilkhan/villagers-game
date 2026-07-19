"use client";

import { useEffect, useRef, useState } from "react";
import type { ClientState } from "./types";

// Per-room player token, persisted so a refresh restores identity + role.
export function loadToken(code: string): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(`villagers:${code}`);
}

export function saveToken(code: string, token: string): void {
  window.localStorage.setItem(`villagers:${code}`, token);
}

export function clearToken(code: string): void {
  window.localStorage.removeItem(`villagers:${code}`);
}

// Subscribe to the room's SSE stream. Reconnects automatically on drop.
// Pass `observer` to watch passively (no token, public state only).
export function useGameStream(
  code: string,
  token: string | null,
  observer = false
) {
  const [state, setState] = useState<ClientState | null>(null);
  const [gone, setGone] = useState(false);
  const [connected, setConnected] = useState(false);
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    if (!token && !observer) return;
    let stopped = false;

    const connect = () => {
      if (stopped) return;
      const url = observer
        ? `/api/room/${code}/stream?observer=1`
        : `/api/room/${code}/stream?token=${encodeURIComponent(token!)}`;
      const es = new EventSource(url);
      esRef.current = es;

      es.addEventListener("state", (e) => {
        setConnected(true);
        setState(JSON.parse((e as MessageEvent).data));
      });
      es.addEventListener("gone", () => {
        setGone(true);
        es.close();
      });
      es.onerror = () => {
        setConnected(false);
        es.close();
        // EventSource would retry on its own, but we control backoff here.
        // Keep it short so reconnect gaps after a serverless timeout stay tiny.
        if (!stopped) setTimeout(connect, 250);
      };
    };

    connect();
    return () => {
      stopped = true;
      esRef.current?.close();
    };
  }, [code, token, observer]);

  return { state, gone, connected };
}

export async function postAction(
  code: string,
  path: string,
  body: Record<string, unknown>
): Promise<{ ok: boolean; error?: string; data?: any }> {
  try {
    const res = await fetch(`/api/room/${code}/${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: data?.error ?? "Something went wrong." };
    return { ok: true, data };
  } catch {
    return { ok: false, error: "Network error." };
  }
}
