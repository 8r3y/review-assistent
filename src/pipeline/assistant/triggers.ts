import { wordsOf } from '../transcript/turns';

/** A phrase counts only near the start of what the owner says: «хороший вопрос, …», not «…был хороший вопрос». */
const MAX_LEAD_WORDS = 6;

/** Matches the owner's speech against trigger phrases, ignoring case, «ё» and punctuation. */
export class TriggerMatcher {
  private phrases: string[][] = [];

  constructor(phrases: string[]) {
    this.setPhrases(phrases);
  }

  setPhrases(phrases: string[]): void {
    this.phrases = phrases.map(normalize).filter((words) => words.length > 0);
  }

  /** @returns whether a phrase starts within the first words of `text`. */
  matches(text: string): boolean {
    if (this.phrases.length === 0) return false;
    const words = normalize(text);
    const last = Math.min(MAX_LEAD_WORDS, words.length) - 1;
    return this.phrases.some((phrase) => {
      for (let start = 0; start <= last; start++) {
        if (phrase.every((w, i) => words[start + i] === w)) return true;
      }
      return false;
    });
  }
}

function normalize(text: string): string[] {
  return wordsOf(text.replace(/ё/gi, 'е'));
}
