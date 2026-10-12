interface Chunk {
  /** Session ms of the first sample. */
  t: number;
  pcm: Int16Array;
}

/** Recent audio of one channel indexed by session time, to cut out segments for speaker embeddings. */
export class PcmHistory {
  private chunks: Chunk[] = [];

  constructor(
    private readonly sampleRate: number,
    private readonly maxMs: number,
  ) {}

  push(pcm: Int16Array, t: number): void {
    this.chunks.push({ t, pcm });
    const cutoff = t - this.maxMs;
    while (this.chunks.length > 0 && this.chunkEnd(this.chunks[0]!) < cutoff) this.chunks.shift();
  }

  /** Samples in [tStart, tEnd) as floats; gaps (audio never received) are skipped. */
  slice(tStart: number, tEnd: number): Float32Array {
    const msPerSample = 1000 / this.sampleRate;
    const parts: Float32Array[] = [];
    for (const chunk of this.chunks) {
      if (this.chunkEnd(chunk) <= tStart || chunk.t >= tEnd) continue;
      const from = Math.max(0, Math.floor((tStart - chunk.t) / msPerSample));
      const to = Math.min(chunk.pcm.length, Math.ceil((tEnd - chunk.t) / msPerSample));
      const part = new Float32Array(Math.max(0, to - from));
      for (let i = 0; i < part.length; i++) part[i] = chunk.pcm[from + i]! / 32768;
      parts.push(part);
    }
    const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
    let offset = 0;
    for (const p of parts) {
      out.set(p, offset);
      offset += p.length;
    }
    return out;
  }

  private chunkEnd(chunk: Chunk): number {
    return chunk.t + (chunk.pcm.length / this.sampleRate) * 1000;
  }
}
