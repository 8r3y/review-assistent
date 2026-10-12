import { useEffect, useState } from 'react';
import type { AudioActivity, ChannelId, PartialText, Segment } from '@shared/transcript';
import { SILENT_ACTIVITY } from './activity';

export interface TranscriptView {
  segments: Segment[];
  partials: Record<ChannelId, PartialText | null>;
}

const NO_PARTIALS: TranscriptView['partials'] = { mic: null, system: null };

/** Session transcript: history from main plus live final/partial/retract events. */
export function useTranscript(): TranscriptView {
  const [segments, setSegments] = useState<Segment[]>([]);
  const [partials, setPartials] = useState(NO_PARTIALS);

  useEffect(() => {
    const offs = [
      window.api.on('transcript:reset', () => {
        setSegments([]);
        setPartials(NO_PARTIALS);
      }),
      window.api.on('transcript:final', (segment) => setSegments((list) => insertByTime(list, segment))),
      window.api.on('transcript:retract', (id) => setSegments((list) => list.filter((s) => s.id !== id))),
      window.api.on('transcript:relabel', (id, speaker) =>
        setSegments((list) => list.map((s) => (s.id === id ? { ...s, speaker } : s))),
      ),
      window.api.on('transcript:partial', (partial) =>
        setPartials((p) => ({ ...p, [partial.channel]: partial.text ? partial : null })),
      ),
    ];
    void window.api
      .invoke('transcript:get')
      .then((history) => setSegments((live) => history.reduce(insertByTime, live)));
    return () => offs.forEach((off) => off());
  }, []);

  return { segments, partials };
}

export function useAudioActivity(): AudioActivity {
  const [activity, setActivity] = useState<AudioActivity>(SILENT_ACTIVITY);
  useEffect(() => window.api.on('audio:activity', setActivity), []);
  return activity;
}

/** Segments of two channels arrive out of order; keep the list sorted by start time, without duplicates. */
function insertByTime(list: Segment[], segment: Segment): Segment[] {
  if (list.some((s) => s.id === segment.id)) return list;
  const next = [...list, segment];
  for (let i = next.length - 1; i > 0 && next[i - 1]!.tStart > next[i]!.tStart; i--) {
    [next[i - 1], next[i]] = [next[i]!, next[i - 1]!];
  }
  return next;
}
