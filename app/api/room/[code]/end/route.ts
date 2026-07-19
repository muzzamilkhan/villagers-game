import { NextRequest, NextResponse } from "next/server";
import { publish } from "@/lib/redis";
import { normalizeCode } from "@/lib/codes";
import { getRoom, deleteRoom } from "@/lib/game";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Host ends the game at any time. Wipes all Redis state for the room, then
// nudges every connected player's stream — they'll see the room is gone.
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
      { error: "Only the Village Elder can end the game." },
      { status: 403 }
    );
  }

  await deleteRoom(code);
  // Publish after deletion so each stream re-reads, finds nothing, and closes.
  await publish(code);
  return NextResponse.json({ ok: true });
}
