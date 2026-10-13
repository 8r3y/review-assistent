import type { AnalysisResult } from '../llm/provider';

export interface AnalyzerDeps {
  /** Builds the request for these turns; null skips the call (e.g. the turns disappeared). */
  buildMessage: (turnIds: string[]) => string | null;
  analyze: (message: string) => Promise<AnalysisResult>;
  onResult: (result: AnalysisResult) => void;
  onError: (error: unknown) => void;
}

/**
 * Serialises summary calls: one request in flight; turns queued meanwhile go out together in the
 * next request, so a burst of turns costs one call, not one per turn.
 */
export class TurnAnalyzer {
  private pending = new Set<string>();
  private running = false;
  private stopped = false;

  constructor(private readonly deps: AnalyzerDeps) {}

  enqueue(turnIds: string[]): void {
    for (const id of turnIds) this.pending.add(id);
    void this.pump();
  }

  get idle(): boolean {
    return !this.running && this.pending.size === 0;
  }

  stop(): void {
    this.stopped = true;
    this.pending.clear();
  }

  private async pump(): Promise<void> {
    if (this.running || this.stopped) return;
    this.running = true;
    try {
      while (!this.stopped && this.pending.size > 0) {
        const turnIds = [...this.pending];
        this.pending.clear();
        try {
          const message = this.deps.buildMessage(turnIds);
          if (message) {
            const result = await this.deps.analyze(message);
            if (!this.stopped) this.deps.onResult(result);
          }
        } catch (e) {
          this.deps.onError(e);
        }
      }
    } finally {
      this.running = false;
    }
  }
}
