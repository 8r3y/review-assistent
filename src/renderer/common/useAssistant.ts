import { useEffect, useState } from 'react';
import type { Question, Turn } from '@shared/assistant';

/** Turns of the current session, ordered by start time. */
export function useTurns(): Turn[] {
  const [turns, setTurns] = useState<Map<string, Turn>>(new Map());
  useEffect(() => {
    const offs = [
      window.api.on('transcript:reset', () => setTurns(new Map())),
      window.api.on('turns:changed', (upserts, removed) =>
        setTurns((prev) => {
          const next = new Map(prev);
          for (const id of removed) next.delete(id);
          for (const t of upserts) next.set(t.id, t);
          return next;
        }),
      ),
    ];
    void window.api
      .invoke('turns:get')
      .then((list) => setTurns((live) => new Map([...list.map((t) => [t.id, t] as const), ...live])));
    return () => offs.forEach((off) => off());
  }, []);
  return [...turns.values()].sort((a, b) => a.tStart - b.tStart);
}

/** Questions of the current session in order of appearance. */
export function useQuestions(): Question[] {
  const [questions, setQuestions] = useState<Question[]>([]);
  useEffect(() => {
    const upsert = (list: Question[], q: Question): Question[] => {
      const i = list.findIndex((x) => x.id === q.id);
      return i < 0 ? [...list, q] : list.map((x, k) => (k === i ? q : x));
    };
    const offs = [
      window.api.on('transcript:reset', () => setQuestions([])),
      window.api.on('questions:changed', (q) => setQuestions((list) => upsert(list, q))),
    ];
    void window.api
      .invoke('questions:get')
      .then((history) => setQuestions((live) => live.reduce(upsert, history)));
    return () => offs.forEach((off) => off());
  }, []);
  return questions;
}
