import { NextRequest, NextResponse } from "next/server";
import { publish } from "@/lib/redis";
import { normalizeCode } from "@/lib/codes";
import { getRoom, removePlayer } from "@/lib/game";

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
    return NextResponse.json({ error: "Only the host can kick." }, { status: 403 });
  }
  if (room.phase !== "lobby") {
    return NextResponse.json(
      { error: "Can only kick before the game starts." },
      { status: 409 }
    );
  }
  if (target === room.hostToken) {
    return NextResponse.json({ error: "The host can't be kicked." }, { status: 400 });
  }

  await removePlayer(code, target);
  await publish(code);
  return NextResponse.json({ ok: true });
}
