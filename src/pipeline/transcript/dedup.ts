import type { Segment } from '@shared/transcript';

export interface LeakParams {
  /** Max distance between segment time ranges to consider them simultaneous, ms. */
  overlapToleranceMs: number;
  /** Share of mic words also present in the system segment to call it a leak. */
  minContainment: number;
  /** How long segments are kept for comparison, ms. */
  historyMs: number;
}

export const DEFAULT_LEAK_PARAMS: LeakParams = {
  overlapToleranceMs: 1500,
  minContainment: 0.6,
  historyMs: 30_000,
};

export interface LeakDecision {
  /** Whether the incoming segment should be published. */
  accept: boolean;
  /** Previously published mic segments that turned out to be leaks. */
  retract: string[];
}

/**
 * Without headphones the microphone picks up remote speakers from the speakers. Such mic segments
 * repeat what the system channel heard at the same time; they are dropped, or retracted if the
 * system segment arrives later.
 */
export class LeakFilter {
  private system: Segment[] = [];
  private mic: Segment[] = [];

  constructor(private readonly params: LeakParams = DEFAULT_LEAK_PARAMS) {}

  push(segment: Segment): LeakDecision {
    this.prune(segment.tEnd);
    if (segment.channel === 'mic') {
      if (this.system.some((s) => this.isLeak(segment, s))) return { accept: false, retract: [] };
      this.mic.push(segment);
      return { accept: true, retract: [] };
    }
    const leaked = this.mic.filter((m) => this.isLeak(m, segment));
    this.mic = this.mic.filter((m) => !leaked.includes(m));
    this.system.push(segment);
    return { accept: true, retract: leaked.map((m) => m.id) };
  }

  private isLeak(mic: Segment, system: Segment): boolean {
    const tol = this.params.overlapToleranceMs;
    if (mic.tStart > system.tEnd + tol || mic.tEnd < system.tStart - tol) return false;
    const micTokens = tokens(mic.text);
    if (micTokens.length === 0) return false;
    const systemTokens = new Set(tokens(system.text));
    // One- or two-word mic segments ("да", "угу") are too ambiguous: require an exact match.
    if (micTokens.length < 3) return micTokens.join(' ') === tokens(system.text).join(' ');
    const contained = micTokens.filter((t) => systemTokens.has(t)).length;
    return contained / micTokens.length >= this.params.minContainment;
  }

  private prune(now: number): void {
    const cutoff = now - this.params.historyMs;
    this.system = this.system.filter((s) => s.tEnd >= cutoff);
    this.mic = this.mic.filter((s) => s.tEnd >= cutoff);
  }
}

function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/ё/g, 'е')
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}
