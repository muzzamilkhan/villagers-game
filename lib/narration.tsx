import type { OutcomeEvent } from "./types";

// Ambient, atmospheric flavor shown during the night and dawn beats. These are
// NOT outcomes — they never say who died. One line is chosen per round via the
// game's shuffled narrationSeq so every viewer sees the same line.
export const NIGHT_FLAVOR: string[] = [
  "Under cover of dark, choices are made in silence.",
  "The village bolts its doors and waits for morning.",
  "Candles gutter out, one by one, across the sleeping village.",
  "Somewhere in the dark, a decision takes shape.",
  "The night is long, and not everyone means to see the dawn.",
  "Shutters close. Breath held. The village sleeps uneasy.",
  "Only the moon watches what moves between the houses.",
  "A cold wind walks the empty lanes while the village dreams.",
  "In the hush, unseen hands are at work.",
  "The fire burns low; shadows lengthen and conspire.",
  "No lantern dares to burn tonight.",
  "Owls call across the rooftops, and no one answers.",
  "The well stands black and still under a starless sky.",
  "Every window is dark, but not every soul is sleeping.",
  "Frost creeps along the sills as the village dreams on.",
  "A single set of footsteps fades into the alleys.",
  "The church bell hangs silent, its rope swaying alone.",
  "Somewhere a dog growls low, then thinks better of it.",
  "The dark keeps its counsel, and its counsel is cruel.",
  "Beneath quiet eaves, a plan is quietly made.",
  "The night holds its breath, and so must the village.",
];

// Shown while the dawn resolution is held back for suspense.
export const DAWN_FLAVOR: string[] = [
  "Dawn breaks over the village…",
  "First light creeps across the rooftops…",
  "The village stirs, bracing for the news…",
  "Morning comes, whether it is welcome or not…",
  "A pale sun rises on whatever the night has left…",
  "The cockerel crows into an uncertain morning…",
  "Doors creak open onto the cold light of day…",
  "The village counts itself awake, and holds its breath…",
  "Grey light spills over the square…",
  "The night releases its grip; the truth waits in the light…",
  "Dew and dread settle together on the morning…",
  "Smoke rises from the first hearths, thin and grey…",
  "The square fills slowly, eyes searching for the missing…",
  "Sunlight finds the cobbles, but warms no one yet…",
  "The village blinks awake and starts to count its own…",
  "Mist lifts from the fields to reveal what remains…",
  "A hush falls as neighbours meet neighbours' eyes…",
  "The last stars fade, and with them the night's secrets…",
  "Bells begin to ring, calling the village to gather…",
  "Shutters open one by one onto the waiting day…",
  "The morning air is sharp with cold and questions…",
];

// Deterministically pick a line: index the pool through the per-game shuffled
// sequence, keyed by round, so it is stable across re-renders and identical for
// every viewer. Falls back to a plain round index when no seed exists.
export function pickNarration(
  pool: string[],
  seq: number[] | undefined,
  round: number,
): string {
  const i = seq && seq.length ? seq[round % seq.length] : round;
  return pool[i % pool.length];
}

// One span of composed outcome text: `emphasis` words stand out (bold, at the
// inherited font size); the rest are smaller and un-bold, so the important
// words (name, "Slain", "cast out"…) carry the moment.
interface Span {
  text: string;
  emphasis?: boolean;
}

function spansFor(e: OutcomeEvent): Span[] {
  switch (e.type) {
    case "kill":
      return [
        { text: e.player, emphasis: true },
        { text: " was " },
        { text: "Slain", emphasis: true },
        { text: " in the night." },
      ];
    case "save":
      return [
        { text: e.player, emphasis: true },
        { text: " was attacked — but the healer's hand kept them " },
        { text: "alive", emphasis: true },
        { text: "." },
      ];
    case "quiet":
      return [
        { text: "A " },
        { text: "quiet", emphasis: true },
        { text: " dawn. No one was harmed." },
      ];
    case "castout_killer":
      return [
        { text: e.player, emphasis: true },
        { text: " was " },
        { text: "cast out", emphasis: true },
        { text: " — and was a " },
        { text: "killer", emphasis: true },
        { text: "!" },
      ];
    case "castout_innocent":
      return [
        { text: e.player, emphasis: true },
        { text: " was " },
        { text: "cast out", emphasis: true },
        { text: " — but was " },
        { text: "innocent", emphasis: true },
        { text: "." },
      ];
    case "no_agreement":
      return [
        { text: "The village could " },
        { text: "not agree", emphasis: true },
        { text: ". No one was cast out." },
      ];
  }
}

// Renders composed outcome text. Emphasis spans inherit the parent font size and
// are bold; discreet spans are smaller (0.8em) and normal weight. Carries no
// absolute size of its own, so it scales with the parent on both the player card
// (text-xl) and the observer stage (text-4xl md:text-6xl).
export function Outcome({ events }: { events?: OutcomeEvent[] }) {
  if (!events || events.length === 0) return null;
  return (
    <>
      {events.map((e, i) => (
        <span key={i} className="block">
          {spansFor(e).map((s, j) =>
            s.emphasis ? (
              <span key={j} className="font-bold">
                {s.text}
              </span>
            ) : (
              <span key={j} className="text-[0.8em] font-normal opacity-90">
                {s.text}
              </span>
            ),
          )}
        </span>
      ))}
    </>
  );
}
