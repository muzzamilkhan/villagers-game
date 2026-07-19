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
export function subscriber(): Redis {
  return makeClient();
}

export const ROOM_TTL_SEC = 60 * 60 * 4; // rooms self-clean after 4h

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
