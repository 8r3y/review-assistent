import { describe, expect, it } from 'vitest';
import { TranscriptAssembler } from './assembler';
import type { SttWord } from '../stt/provider';

const iso = (ms: number): string => `T+${ms}`;
const word = (text: string, tStart: number, speaker: number | null): SttWord => ({
  text,
  tStart,
  tEnd: tStart + 300,
  confidence: 0.9,
  speaker,
});

describe('TranscriptAssembler', () => {
  it('labels the mic channel as the owner', () => {
    const asm = new TranscriptAssembler('mic', iso);
    const out = asm.push({ isFinal: true, text: 'да', tStart: 100, words: [word('да', 100, null)] });
    expect(out.finals).toHaveLength(1);
    expect(out.finals[0]).toMatchObject({ speaker: 'owner', text: 'да', wall: 'T+100', channel: 'mic' });
  });

  it('splits a final result into segments per diarized speaker run', () => {
    const asm = new TranscriptAssembler('system', iso);
    const out = asm.push({
      isFinal: true,
      text: '',
      tStart: 0,
      words: [word('Привет,', 0, 0), word('коллеги.', 400, 0), word('Здравствуйте.', 900, 1)],
    });
    expect(out.finals.map((s) => [s.speaker, s.text, s.tStart, s.tEnd])).toEqual([
      ['S1', 'Привет, коллеги.', 0, 700],
      ['S2', 'Здравствуйте.', 900, 1200],
    ]);
    expect(new Set(out.finals.map((s) => s.id)).size).toBe(2);
    expect(out.partial?.text).toBe('');
  });

  it('emits partial text with the speaker of the last word', () => {
    const asm = new TranscriptAssembler('system', iso);
    const out = asm.push({ isFinal: false, text: 'идёт речь', tStart: 50, words: [word('идёт', 50, 2)] });
    expect(out.finals).toEqual([]);
    expect(out.partial).toEqual({ channel: 'system', speaker: 'S3', text: 'идёт речь', tStart: 50 });
  });
});
