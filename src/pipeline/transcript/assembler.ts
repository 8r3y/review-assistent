import { OWNER, type ChannelId, type PartialText, type Segment, type SpeakerId } from '@shared/transcript';
import type { SttResult, SttWord } from '../stt/provider';

export interface AssemblerOutput {
  partial: PartialText | null;
  finals: Segment[];
}

/**
 * Turns STT results of one channel into partial text and final segments. A final result with
 * several diarized speakers is split into one segment per speaker run.
 */
export class TranscriptAssembler {
  private counter = 0;

  constructor(
    private readonly channel: ChannelId,
    private readonly toIso: (sessionMs: number) => string,
  ) {}

  push(result: SttResult): AssemblerOutput {
    if (!result.isFinal) {
      const speaker = result.words.length > 0 ? this.speakerOf(result.words.at(-1)!) : this.defaultSpeaker();
      return {
        partial: { channel: this.channel, speaker, text: result.text, tStart: result.tStart },
        finals: [],
      };
    }
    const cleared: PartialText = { channel: this.channel, speaker: null, text: '', tStart: result.tStart };
    return { partial: cleared, finals: this.split(result.words) };
  }

  private split(words: SttWord[]): Segment[] {
    const segments: Segment[] = [];
    let run: SttWord[] = [];
    const flush = (): void => {
      if (run.length === 0) return;
      const tStart = run[0]!.tStart;
      segments.push({
        id: `${this.channel}-${++this.counter}`,
        channel: this.channel,
        speaker: this.speakerOf(run[0]!),
        text: run.map((w) => w.text).join(' '),
        tStart,
        tEnd: run.at(-1)!.tEnd,
        wall: this.toIso(tStart),
        words: run.map(({ text, tStart: s, tEnd: e, confidence }) => ({
          text,
          tStart: s,
          tEnd: e,
          confidence,
        })),
      });
      run = [];
    };
    for (const word of words) {
      if (run.length > 0 && this.speakerOf(word) !== this.speakerOf(run[0]!)) flush();
      run.push(word);
    }
    flush();
    return segments;
  }

  private speakerOf(word: SttWord): SpeakerId {
    if (this.channel === 'mic') return OWNER;
    return word.speaker === null ? this.defaultSpeaker() : `S${word.speaker + 1}`;
  }

  private defaultSpeaker(): SpeakerId {
    return this.channel === 'mic' ? OWNER : 'S?';
  }
}
