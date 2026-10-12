/** Cosine similarity of two L2-normalised vectors. */
export function dot(a: Float32Array, b: Float32Array): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i]! * b[i]!;
  return s;
}

export function normalize(v: Float32Array): Float32Array {
  let n = 0;
  for (const x of v) n += x * x;
  n = Math.sqrt(n) || 1;
  return v.map((x) => x / n);
}

/**
 * Agglomerative clustering with average linkage on a symmetric similarity matrix (row-major, n×n).
 * Merges the most similar pair until no pair reaches `threshold`.
 * @returns clusters as lists of item indices, ordered by their first member.
 */
export function averageLinkage(similarity: Float64Array, n: number, threshold: number): number[][] {
  const sim = Float64Array.from(similarity);
  const members: (number[] | null)[] = Array.from({ length: n }, (_, i) => [i]);
  for (;;) {
    let best = -Infinity;
    let bi = -1;
    let bj = -1;
    for (let i = 0; i < n; i++) {
      if (!members[i]) continue;
      for (let j = i + 1; j < n; j++) {
        if (!members[j]) continue;
        const s = sim[i * n + j]!;
        if (s > best) {
          best = s;
          bi = i;
          bj = j;
        }
      }
    }
    if (bi < 0 || best < threshold) break;
    const a = members[bi]!;
    const b = members[bj]!;
    // Lance–Williams update for average linkage.
    for (let k = 0; k < n; k++) {
      if (!members[k] || k === bi || k === bj) continue;
      const s = (a.length * sim[bi * n + k]! + b.length * sim[bj * n + k]!) / (a.length + b.length);
      sim[bi * n + k] = s;
      sim[k * n + bi] = s;
    }
    a.push(...b);
    members[bj] = null;
  }
  return members
    .filter((m): m is number[] => m !== null)
    .map((m) => m.sort((x, y) => x - y))
    .sort((x, y) => x[0]! - y[0]!);
}
