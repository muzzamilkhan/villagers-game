import { NextRequest, NextResponse } from "next/server";
import { redis, keys, publish } from "@/lib/redis";
import { normalizeCode } from "@/lib/codes";
import { getRoom, getPlayers, saveRoom, savePlayer, assignRoles } from "@/lib/game";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ code: string }> }
) {
  const code = normalizeCode((await params).code);
  const body = await req.json().catch(() => ({}));
  const token = String(body?.token ?? "");

  const room = await getRoom(code);
  if (!room) {
    return NextResponse.json({ error: "Game not found." }, { status: 404 });
  }
  if (room.hostToken !== token) {
    return NextResponse.json({ error: "Only the Village Elder can start." }, { status: 403 });
  }
  if (room.phase !== "lobby") {
    return NextResponse.json({ error: "Already started." }, { status: 409 });
  }

  const players = await getPlayers(code);
  const minPlayers = room.settings.killers + (room.settings.healer ? 1 : 0) + 2;
  if (players.length < Math.max(4, minPlayers)) {
    return NextResponse.json(
      { error: `Need at least ${Math.max(4, minPlayers)} players to start.` },
      { status: 409 }
    );
  }

  const assigned = assignRoles(players, room.settings);
  for (const p of assigned) {
    await savePlayer(code, p);
  }

  room.phase = "night_action";
  room.round = 1;
  room.announcement = undefined;
  room.voteResult = undefined;
  room.lastHealTarget = undefined;
  await redis().del(keys.actions(code));
  await redis().del(keys.votes(code));
  await saveRoom(room);
  await publish(code);

  return NextResponse.json({ ok: true });
}
