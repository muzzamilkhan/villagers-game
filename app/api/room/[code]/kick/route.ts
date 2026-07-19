import { NextRequest, NextResponse } from "next/server";
import { redis, keys, publish } from "@/lib/redis";
import { normalizeCode } from "@/lib/codes";
import {
  getRoom,
  getPlayers,
  removePlayer,
  checkWin,
  resolveNight,
} from "@/lib/game";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ code: string }> }
) {
  const code = normalizeCode((await params).code);
  const body = await req.json().catch(() => ({}));
  const token = String(body?.token ?? "");
  const target = String(body?.target ?? "");

  const room = await getRoom(code);
  if (!room) {
    return NextResponse.json({ error: "Game not found." }, { status: 404 });
  }
  if (room.hostToken !== token) {
    return NextResponse.json({ error: "Only the Village Elder can kick." }, { status: 403 });
  }
  if (room.phase === "game_over") {
    return NextResponse.json(
      { error: "The game is already over." },
      { status: 409 }
    );
  }
  if (target === room.hostToken) {
    return NextResponse.json({ error: "The Village Elder can't be kicked." }, { status: 400 });
  }

  await removePlayer(code, target);

  // Removing a player mid-game can change the outcome or unblock a phase, so
  // reconcile the game state before broadcasting.
  if (room.phase !== "lobby") {
    // A kick may tip the balance — the last killer leaving hands the village
    // the win; a kick that thins the villagers can hand it to the killers.
    const updated = await checkWin(code, room);

    // If the game is still going and it's night, the kicked player may have
    // been the only one everyone was waiting on — auto-resolve if so.
    if (updated.phase === "night_action") {
      const [players, actions] = await Promise.all([
        getPlayers(code),
        redis().hgetall(keys.actions(code)),
      ]);
      const living = players.filter((p) => p.alive);
      const submitted = living.filter((p) => actions[p.token] != null).length;
      if (living.length > 0 && submitted >= living.length) {
        await resolveNight(code, updated);
      }
    }
  }

  await publish(code);
  return NextResponse.json({ ok: true });
}
