import { NextRequest, NextResponse } from "next/server";
import { redis, keys, publish } from "@/lib/redis";
import { normalizeCode } from "@/lib/codes";
import { getRoom, getPlayer, getPlayers, resolveNight } from "@/lib/game";

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
  if (room.phase !== "night_action") {
    return NextResponse.json({ error: "Not the action phase." }, { status: 409 });
  }

  const me = await getPlayer(code, token);
  if (!me || !me.alive) {
    return NextResponse.json({ error: "You can't act." }, { status: 403 });
  }
  const targetPlayer = await getPlayer(code, target);
  if (!targetPlayer || !targetPlayer.alive) {
    return NextResponse.json({ error: "Invalid target." }, { status: 400 });
  }

  await redis().hset(keys.actions(code), token, target);

  // Auto-resolve once every living player has picked.
  const [players, actions] = await Promise.all([
    getPlayers(code),
    redis().hgetall(keys.actions(code)),
  ]);
  const living = players.filter((p) => p.alive);
  const submitted = living.filter((p) => actions[p.token] != null).length;

  if (submitted >= living.length) {
    await resolveNight(code, room);
  }
  await publish(code);

  return NextResponse.json({ ok: true });
}
