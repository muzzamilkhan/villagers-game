import Redis from "ioredis";

// Single shared connection for regular commands, reused across invocations.
// SSE subscribers create their own dedicated connection (see stream route).
declare global {
  // eslint-disable-next-line no-var
  var __redis: Redis | undefined;
}

function makeClient(): Redis {
  const url = process.env.REDIS_URL;
  if (!url) {
    throw new Error("REDIS_URL is not set. Copy .env.example to .env.local.");
  }
  return new Redis(url, {
    maxRetriesPerRequest: 3,
    lazyConnect: false,
  });
}

export function redis(): Redis {
  if (!global.__redis) {
    global.__redis = makeClient();
  }
  return global.__redis;
}

// A fresh connection dedicated to pub/sub (subscribe blocks the connection).
//
// Subscriber connections must NOT run ioredis's ready-check: that check issues
// an `INFO` command, which Redis rejects on a connection already in subscribe
// mode ("only (P|S)SUBSCRIBE / … allowed in this context"). When many streams
// connect at once (every player + observer opens one), that race makes some
// subscriptions silently fail — the client gets its initial state but no
// live updates. Disabling the ready check (and the per-request retry cap, which
// isn't meaningful for a blocking subscriber) keeps every stream reliable under
// concurrency.
export function subscriber(): Redis {
  const url = process.env.REDIS_URL;
  if (!url) {
    throw new Error("REDIS_URL is not set. Copy .env.example to .env.local.");
  }
  return new Redis(url, {
    enableReadyCheck: false,
    maxRetriesPerRequest: null,
    lazyConnect: false,
  });
}

// Rooms self-clean after REDIS_TTL_HOURS (default 2h). The TTL is refreshed on
// every write (see saveRoom), so it counts from the last activity, not creation.
const ttlHours = Number(process.env.REDIS_TTL_HOURS);
export const ROOM_TTL_SEC =
  60 * 60 * (Number.isFinite(ttlHours) && ttlHours > 0 ? ttlHours : 2);

export const keys = {
  room: (code: string) => `room:${code}`,
  players: (code: string) => `room:${code}:players`,
  order: (code: string) => `room:${code}:order`,
  actions: (code: string) => `room:${code}:actions`,
  votes: (code: string) => `room:${code}:votes`,
  channel: (code: string) => `room:${code}:channel`,
};

export async function publish(code: string): Promise<void> {
  // Payload is just a nudge; each SSE stream re-reads and filters state per player.
  await redis().publish(keys.channel(code), "update");
}
