import type { AnalysisResult } from '../llm/provider';

export interface AnalyzerDeps {
  /** Builds the request for these turns; null skips the call (e.g. the turns disappeared). */
  buildMessage: (turnIds: string[], forceQuestionFrom: string[] | null) => string | null;
  analyze: (message: string) => Promise<AnalysisResult>;
  onResult: (result: AnalysisResult, forceQuestionFrom: string[] | null) => void;
  onError: (error: unknown) => void;
}

interface Waiter {
  turnIds: string[];
  resolve: () => void;
}

/**
 * Serialises analysis calls: one request in flight; turns queued meanwhile go out together in the
 * next request, so a burst of phrases costs one call, not one per phrase.
 */
export class TurnAnalyzer {
  private pending = new Set<string>();
  private forced: Waiter | null = null;
  private running = false;
  private stopped = false;

  constructor(private readonly deps: AnalyzerDeps) {}

  enqueue(turnIds: string[]): void {
    for (const id of turnIds) this.pending.add(id);
    void this.pump();
  }

  /** The owner marked these turns as a question; resolves once that request has been applied. */
  force(turnIds: string[]): Promise<void> {
    return new Promise((resolve) => {
      this.forced?.resolve();
      this.forced = { turnIds, resolve };
      void this.pump();
    });
  }

  get idle(): boolean {
    return !this.running && this.pending.size === 0 && !this.forced;
  }

  stop(): void {
    this.stopped = true;
    this.forced?.resolve();
    this.forced = null;
    this.pending.clear();
  }

  private async pump(): Promise<void> {
    if (this.running || this.stopped) return;
    this.running = true;
    try {
      while (!this.stopped && (this.pending.size > 0 || this.forced)) {
        const forced = this.forced;
        this.forced = null;
        const turnIds = [...new Set([...this.pending, ...(forced?.turnIds ?? [])])];
        this.pending.clear();
        try {
          const message = this.deps.buildMessage(turnIds, forced?.turnIds ?? null);
          if (message) {
            const result = await this.deps.analyze(message);
            if (!this.stopped) this.deps.onResult(result, forced?.turnIds ?? null);
          }
        } catch (e) {
          this.deps.onError(e);
        } finally {
          forced?.resolve();
        }
      }
    } finally {
      this.running = false;
    }
  }
}
