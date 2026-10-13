import type { SttSettings } from '@shared/ipc';

const LISTEN_URL = 'https://api.deepgram.com/v1/listen';
const SAMPLE_RATE = 16_000;
const SILENCE_MS = 100;
const TIMEOUT_MS = 10_000;

/**
 * Asks Deepgram whether it accepts these settings, keyterms above all: a stream with too many keyterm
 * tokens is rejected at the handshake without a reason. Sends 0.1 s of silence.
 * @returns a user-facing error, or null when accepted or when the check could not reach Deepgram.
 */
export async function checkDeepgramSettings(apiKey: string, stt: SttSettings): Promise<string | null> {
  const params = new URLSearchParams({ model: stt.model, language: stt.language });
  for (const term of stt.keyterms) params.append('keyterm', term);
  let response: Response;
  try {
    response = await fetch(`${LISTEN_URL}?${params}`, {
      method: 'POST',
      headers: { Authorization: `Token ${apiKey}`, 'Content-Type': 'audio/wav' },
      body: silentWav(),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    return null;
  }
  if (response.ok) return null;
  if (response.status === 401 || response.status === 403)
    return 'Неверный ключ Deepgram — термины не проверены';
  const body = (await response.json().catch(() => ({}))) as { err_msg?: string };
  const message = body.err_msg ?? `HTTP ${response.status}`;
  if (/keyterm limit/i.test(message)) {
    return 'Термины превышают лимит Deepgram: 500 токенов на все вместе — сократите список или длинные термины';
  }
  return `Deepgram отклонил настройки: ${message}`;
}

/** 16-bit mono PCM WAV of silence. */
function silentWav(): Uint8Array<ArrayBuffer> {
  const dataSize = (SAMPLE_RATE * SILENCE_MS * 2) / 1000;
  const view = new DataView(new ArrayBuffer(44 + dataSize));
  const text = (offset: number, s: string): void => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };
  text(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, SAMPLE_RATE, true);
  view.setUint32(28, SAMPLE_RATE * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, 'data');
  view.setUint32(40, dataSize, true);
  return new Uint8Array(view.buffer);
}
