export const SILENCE_DB = -100;

/** Int16 PCM → Float32 in [-1, 1). */
export function int16ToFloat32(pcm: Int16Array): Float32Array {
  const out = new Float32Array(pcm.length);
  for (let i = 0; i < pcm.length; i++) out[i] = pcm[i]! / 32768;
  return out;
}

/** RMS level in dBFS, floored at SILENCE_DB. */
export function rmsDb(samples: Float32Array): number {
  if (samples.length === 0) return SILENCE_DB;
  let sum = 0;
  for (const s of samples) sum += s * s;
  const rms = Math.sqrt(sum / samples.length);
  return rms > 0 ? Math.max(SILENCE_DB, 20 * Math.log10(rms)) : SILENCE_DB;
}
