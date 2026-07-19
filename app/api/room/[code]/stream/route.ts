import { NextRequest } from "next/server";
import { subscriber, keys, publish } from "@/lib/redis";
import { normalizeCode } from "@/lib/codes";
import { buildClientState, getPlayer, savePlayer } from "@/lib/game";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Server-Sent Events: one long-lived stream per player. A dedicated Redis
// connection subscribes to the room channel; every publish triggers a fresh,
// per-player filtered state push (roles are never leaked to the wrong viewer).
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ code: string }> }
) {
  const code = normalizeCode((await params).code);
  const token = req.nextUrl.searchParams.get("token") ?? "";

  const encoder = new TextEncoder();
  const sub = subscriber();

  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;
      const send = async () => {
        if (closed) return;
        const state = await buildClientState(code, token);
        const payload = state
          ? `event: state\ndata: ${JSON.stringify(state)}\n\n`
          : `event: gone\ndata: {}\n\n`;
        controller.enqueue(encoder.encode(payload));
      };

      // mark connected
      const me = await getPlayer(code, token);
      if (me && !me.connected) {
        me.connected = true;
        await savePlayer(code, me);
        await publish(code);
      }

      await send();

      await sub.subscribe(keys.channel(code));
      sub.on("message", () => {
        void send();
      });

      // heartbeat keeps proxies from closing the idle connection
      const heartbeat = setInterval(() => {
        if (closed) return;
        controller.enqueue(encoder.encode(`: ping\n\n`));
      }, 25000);

      const cleanup = async () => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        try {
          await sub.unsubscribe();
          sub.disconnect();
        } catch {}
        const p = await getPlayer(code, token);
        if (p && p.connected) {
          p.connected = false;
          await savePlayer(code, p);
          await publish(code);
        }
        try {
          controller.close();
        } catch {}
      };

      req.signal.addEventListener("abort", () => void cleanup());
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
