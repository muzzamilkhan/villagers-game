import { NextRequest, NextResponse } from "next/server";
import { publish } from "@/lib/redis";
import { normalizeCode } from "@/lib/codes";
import { getRoom, resolveNight, resolveVote, advancePhase } from "@/lib/game";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Single host-driven "next" button. Behaviour depends on the current phase:
//  night_action -> force-resolve the night (timer ran out / host skips waiting)
//  resolve      -> open the day vote
//  day_vote     -> lock votes and resolve them
//  day_result   -> begin the next round
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
    return NextResponse.json({ error: "Only the host controls the game." }, { status: 403 });
  }

  switch (room.phase) {
    case "night_action":
      await resolveNight(code, room);
      break;
    case "resolve":
      await advancePhase(code, room);
      break;
    case "day_vote":
      await resolveVote(code, room);
      break;
    case "day_result":
      await advancePhase(code, room);
      break;
    default:
      return NextResponse.json({ error: "Nothing to advance." }, { status: 409 });
  }

  await publish(code);
  return NextResponse.json({ ok: true });
}
