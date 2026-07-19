import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

// A tiny latency collector. Every propagation measurement — "actor did X, how
// long until watcher W saw it" — is pushed here under an event label, and at the
// end we roll each label up into min / max / avg (plus p50/p95 and count).

export interface Sample {
  ms: number;
  watcher: string; // which participant observed it
  detail?: string; // free-form note (round, target, …)
}

export interface EventStats {
  event: string;
  count: number;
  min: number;
  max: number;
  avg: number;
  p50: number;
  p95: number;
}

export class LatencyRecorder {
  private samples = new Map<string, Sample[]>();

  record(event: string, sample: Sample): void {
    const list = this.samples.get(event) ?? [];
    list.push(sample);
    this.samples.set(event, list);
  }

  private static percentile(sorted: number[], p: number): number {
    if (sorted.length === 0) return 0;
    const idx = Math.min(
      sorted.length - 1,
      Math.max(0, Math.ceil((p / 100) * sorted.length) - 1)
    );
    return sorted[idx];
  }

  summarize(): EventStats[] {
    const out: EventStats[] = [];
    for (const [event, list] of this.samples) {
      const ms = list.map((s) => s.ms).sort((a, b) => a - b);
      const sum = ms.reduce((a, b) => a + b, 0);
      out.push({
        event,
        count: ms.length,
        min: ms[0],
        max: ms[ms.length - 1],
        avg: Math.round(sum / ms.length),
        p50: LatencyRecorder.percentile(ms, 50),
        p95: LatencyRecorder.percentile(ms, 95),
      });
    }
    // Preserve first-seen event order for a readable report.
    const order = [...this.samples.keys()];
    out.sort((a, b) => order.indexOf(a.event) - order.indexOf(b.event));
    return out;
  }

  rawSamples(): Record<string, Sample[]> {
    return Object.fromEntries(this.samples);
  }

  // Pretty ASCII table for the terminal — the "max/min/avg breakdown per event".
  renderTable(): string {
    const rows = this.summarize();
    const headers = ["Event", "N", "min", "avg", "p50", "p95", "max"];
    const data = rows.map((r) => [
      r.event,
      String(r.count),
      `${r.min}ms`,
      `${r.avg}ms`,
      `${r.p50}ms`,
      `${r.p95}ms`,
      `${r.max}ms`,
    ]);
    const widths = headers.map((h, i) =>
      Math.max(h.length, ...data.map((row) => row[i].length))
    );
    const line = (cells: string[]) =>
      "| " +
      cells.map((c, i) => c.padEnd(widths[i])).join(" | ") +
      " |";
    const sep =
      "|" + widths.map((w) => "-".repeat(w + 2)).join("|") + "|";
    return [line(headers), sep, ...data.map(line)].join("\n");
  }

  writeReport(jsonPath: string, mdPath: string): void {
    const rows = this.summarize();
    mkdirSync(dirname(jsonPath), { recursive: true });
    writeFileSync(
      jsonPath,
      JSON.stringify(
        { generatedAt: new Date().toISOString(), events: rows, raw: this.rawSamples() },
        null,
        2
      )
    );

    const md = [
      "# Villagers — concurrency & latency report",
      "",
      `Generated: ${new Date().toISOString()}`,
      "",
      "Each row is one real-time event type. Every sample is the time between an",
      "actor performing a move and one watcher's screen reflecting it (SSE",
      "round-trip), measured across 10 players + 1 observer.",
      "",
      "| Event | Samples | Min | Avg | p50 | p95 | Max |",
      "| --- | ---: | ---: | ---: | ---: | ---: | ---: |",
      ...rows.map(
        (r) =>
          `| ${r.event} | ${r.count} | ${r.min}ms | ${r.avg}ms | ${r.p50}ms | ${r.p95}ms | ${r.max}ms |`
      ),
      "",
    ].join("\n");
    mkdirSync(dirname(mdPath), { recursive: true });
    writeFileSync(mdPath, md);
  }
}
