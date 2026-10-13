import { describe, expect, it } from 'vitest';
import { parseCommaList } from '@shared/text';
import { TriggerMatcher } from './triggers';

describe('parseCommaList', () => {
  it('splits by comma, trims and drops empty and duplicate phrases', () => {
    expect(parseCommaList(' Хороший вопрос ,, понял  ваш вопрос, хороший вопрос, ! ')).toEqual([
      'Хороший вопрос',
      'понял ваш вопрос',
    ]);
  });
});

describe('TriggerMatcher', () => {
  const matcher = new TriggerMatcher(['хороший вопрос', 'понял ваш вопрос', 'good question']);

  it('matches a phrase at the start of speech regardless of case and punctuation', () => {
    expect(matcher.matches('Хороший вопрос! Давайте разберём')).toBe(true);
    expect(matcher.matches('Да, понял ваш вопрос.')).toBe(true);
    expect(matcher.matches('Ok, good question')).toBe(true);
  });

  it('treats ё as е', () => {
    expect(new TriggerMatcher(['ещё вопрос']).matches('Еще вопрос')).toBe(true);
  });

  it('ignores a phrase deep inside the speech', () => {
    expect(matcher.matches('на прошлой встрече мне задали очень хороший вопрос')).toBe(false);
  });

  it('needs the whole phrase, not a part of it', () => {
    expect(matcher.matches('Хороший')).toBe(false);
    expect(matcher.matches('хороший ответ')).toBe(false);
  });

  it('matches nothing without phrases', () => {
    expect(new TriggerMatcher([]).matches('хороший вопрос')).toBe(false);
  });
});
