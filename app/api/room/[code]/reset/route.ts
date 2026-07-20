import { NextRequest, NextResponse } from "next/server";
import { publish } from "@/lib/redis";
import { normalizeCode } from "@/lib/codes";
import { getRoom, resetRoom } from "@/lib/game";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Host starts a new game from a finished one. Keeps the same code, players,
// host, and settings; resets round, roles, outcomes, and scratch back to the
// lobby. Everyone's stream re-reads and lands back in the lobby.
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
    return NextResponse.json(
      { error: "Only the Village Elder can start a new game." },
      { status: 403 }
    );
  }
  if (room.phase !== "game_over") {
    return NextResponse.json(
      { error: "The game isn't over yet." },
      { status: 409 }
    );
  }

  await resetRoom(code, room);
  await publish(code);
  return NextResponse.json({ ok: true });
}
