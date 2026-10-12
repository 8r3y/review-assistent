import type { SpeakerId } from '@shared/transcript';
import { averageLinkage, dot } from './clustering';

export interface DiarizerParams {
  /** Average-linkage cosine threshold; lower merges more. */
  threshold: number;
  /** Segments shorter than this never create a speaker; they join the nearest one. */
  minSegmentMs: number;
  /** Long segments kept for re-clustering; older ones keep their final labels. */
  maxHistory: number;
}

export const DEFAULT_DIARIZER_PARAMS: DiarizerParams = {
  threshold: 0.3,
  minSegmentMs: 1500,
  maxHistory: 300,
};

export interface Relabel {
  segmentId: string;
  speaker: SpeakerId;
}

export interface DiarizerResult {
  speaker: SpeakerId;
  /** Earlier segments whose speaker changed after re-clustering. */
  relabels: Relabel[];
}

interface Item {
  id: string;
  embedding: Float32Array | null;
  long: boolean;
  label: SpeakerId;
}

/**
 * Online speaker diarization over per-segment speaker embeddings (L2-normalised).
 * Every long segment triggers re-clustering of the history, so early mistakes are corrected;
 * labels stay stable by mapping new clusters onto the labels their members already had.
 */
export class OnlineDiarizer {
  private items: Item[] = [];
  /** Labels of segments dropped from the history: never reused for a different voice. */
  private retired = new Set<SpeakerId>();
  private lastLabel: SpeakerId | null = null;

  private params: DiarizerParams;

  constructor(params: DiarizerParams = DEFAULT_DIARIZER_PARAMS) {
    this.params = { ...params };
  }

  /** Takes effect at the next long segment, whose re-clustering also relabels the history. */
  setThreshold(threshold: number): void {
    this.params.threshold = threshold;
  }

  add(id: string, embedding: Float32Array | null, durationMs: number): DiarizerResult {
    const long = embedding !== null && durationMs >= this.params.minSegmentMs;
    const item: Item = { id, embedding, long, label: '' };
    this.items.push(item);
    this.trimHistory();

    const relabels = long ? this.recluster(item) : [];
    if (!long) {
      item.label =
        this.nearestLabel(embedding) ??
        this.lastLabel ??
        this.newLabel(new Set(this.items.map((i) => i.label)));
    }
    this.lastLabel = item.label;
    return { speaker: item.label, relabels: relabels.filter((r) => r.segmentId !== id) };
  }

  private recluster(added: Item): Relabel[] {
    const longItems = this.items.filter((i) => i.long);
    const n = longItems.length;
    const sim = new Float64Array(n * n);
    for (let i = 0; i < n; i++) {
      for (let j = i; j < n; j++) {
        const s = dot(longItems[i]!.embedding!, longItems[j]!.embedding!);
        sim[i * n + j] = s;
        sim[j * n + i] = s;
      }
    }
    const clusters = averageLinkage(sim, n, this.params.threshold).map((c) => c.map((k) => longItems[k]!));

    // Map clusters onto existing labels by member votes, biggest agreement first.
    const votes: { cluster: number; label: SpeakerId; count: number }[] = [];
    clusters.forEach((members, cluster) => {
      const counts = new Map<SpeakerId, number>();
      for (const m of members)
        if (m !== added && m.label) counts.set(m.label, (counts.get(m.label) ?? 0) + 1);
      for (const [label, count] of counts) votes.push({ cluster, label, count });
    });
    votes.sort((a, b) => b.count - a.count);
    const clusterLabel = new Map<number, SpeakerId>();
    const usedLabels = new Set<SpeakerId>();
    for (const v of votes) {
      if (clusterLabel.has(v.cluster) || usedLabels.has(v.label)) continue;
      clusterLabel.set(v.cluster, v.label);
      usedLabels.add(v.label);
    }

    const relabels: Relabel[] = [];
    const setLabel = (item: Item, label: SpeakerId): void => {
      if (item.label && item.label !== label) relabels.push({ segmentId: item.id, speaker: label });
      item.label = label;
    };
    const reserved = new Set(clusterLabel.values());
    clusters.forEach((members, cluster) => {
      let label = clusterLabel.get(cluster);
      if (!label) {
        label = this.newLabel(reserved);
        reserved.add(label);
      }
      for (const m of members) setLabel(m, label);
    });
    // Short segments follow the clusters they are closest to.
    for (const item of this.items) {
      if (item.long || !item.embedding) continue;
      const label = this.nearestLabel(item.embedding);
      if (label) setLabel(item, label);
    }
    return relabels;
  }

  /** Label of the cluster with the highest average similarity to `embedding`. */
  private nearestLabel(embedding: Float32Array | null): SpeakerId | null {
    if (!embedding) return null;
    const sums = new Map<SpeakerId, { total: number; count: number }>();
    for (const item of this.items) {
      if (!item.long || !item.label) continue;
      const entry = sums.get(item.label) ?? { total: 0, count: 0 };
      entry.total += dot(item.embedding!, embedding);
      entry.count++;
      sums.set(item.label, entry);
    }
    let best: SpeakerId | null = null;
    let bestSim = -Infinity;
    for (const [label, { total, count }] of sums) {
      if (total / count > bestSim) {
        bestSim = total / count;
        best = label;
      }
    }
    return best;
  }

  /** Smallest free S<n>: a label freed by re-clustering is reused, a retired one is not. */
  private newLabel(reserved: Set<SpeakerId>): SpeakerId {
    for (let n = 1; ; n++) {
      const label = `S${n}`;
      if (!reserved.has(label) && !this.retired.has(label)) return label;
    }
  }

  private trimHistory(): void {
    let longCount = this.items.filter((i) => i.long).length;
    while (longCount > this.params.maxHistory) {
      const first = this.items.shift()!;
      if (first.long) longCount--;
      if (!this.items.some((i) => i.label === first.label)) this.retired.add(first.label);
    }
  }
}
