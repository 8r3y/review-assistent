import { describe, expect, it } from 'vitest';
import { buildDeepgramUrl, parseDeepgramResults, type DeepgramResults } from './deepgram';

describe('buildDeepgramUrl', () => {
  it('requests raw 16 kHz PCM with interim results and optional diarization', () => {
    const url = new URL(
      buildDeepgramUrl({ sampleRate: 16000, language: 'ru', model: 'nova-3', diarize: true }),
    );
    expect(url.searchParams.get('encoding')).toBe('linear16');
    expect(url.searchParams.get('sample_rate')).toBe('16000');
    expect(url.searchParams.get('interim_results')).toBe('true');
    expect(url.searchParams.get('diarize')).toBe('true');
    expect(url.searchParams.get('language')).toBe('ru');
  });
});

describe('parseDeepgramResults', () => {
  it('maps word times through the offset function and prefers punctuated words', () => {
    const msg: DeepgramResults = {
      type: 'Results',
      start: 1.5,
      duration: 1,
      is_final: true,
      channel: {
        alternatives: [
          {
            transcript: 'привет мир',
            words: [
              {
                word: 'привет',
                punctuated_word: 'Привет',
                start: 1.5,
                end: 1.9,
                confidence: 0.9,
                speaker: 1,
              },
              { word: 'мир', punctuated_word: 'мир.', start: 2.0, end: 2.4, confidence: 0.8, speaker: 1 },
            ],
          },
        ],
      },
    };
    const result = parseDeepgramResults(msg, (ms) => ms + 10_000);
    expect(result.isFinal).toBe(true);
    expect(result.tStart).toBe(11_500);
    expect(result.words.map((w) => [w.text, w.tStart, w.tEnd, w.speaker])).toEqual([
      ['Привет', 11_500, 11_900, 1],
      ['мир.', 12_000, 12_400, 1],
    ]);
  });

  it('handles empty alternatives', () => {
    const msg: DeepgramResults = {
      type: 'Results',
      start: 3,
      duration: 0.5,
      is_final: false,
      channel: { alternatives: [] },
    };
    expect(parseDeepgramResults(msg, (ms) => ms)).toEqual({
      isFinal: false,
      text: '',
      tStart: 3000,
      words: [],
    });
  });
});
