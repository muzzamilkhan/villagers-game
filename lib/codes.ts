import { customAlphabet } from "nanoid";

// No ambiguous characters (0/O, 1/I/L).
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const gen = customAlphabet(ALPHABET, 4);

export function newRoomCode(): string {
  return gen();
}

export function normalizeCode(input: string): string {
  return input.trim().toUpperCase();
}
