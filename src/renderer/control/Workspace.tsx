import { useEffect, useRef, useState } from 'react';
import type { Question, QuestionStatus } from '@shared/assistant';
import { formatSessionTime } from '@shared/clock';
import type { AppState } from '@shared/ipc';
import { OWNER, speakerLabel } from '@shared/transcript';
import { useQuestions, useTurns } from '../common/useAssistant';
import { useTranscript } from '../common/useTranscript';
import styles from './ControlApp.module.css';

type Tab = 'transcript' | 'turns' | 'questions';

const TABS: { id: Tab; label: string }[] = [
  { id: 'transcript', label: 'Транскрипт' },
  { id: 'turns', label: 'Реплики' },
  { id: 'questions', label: 'Вопросы' },
];

const STATUS_LABELS: Record<QuestionStatus, string> = {
  open: 'открыт',
  answering: 'отвечаю…',
  answered: 'отвечен',
  dismissed: 'отклонён',
};

const TAB_KEY = 'workspace.tab';

/** Transcript, turns and questions of the current session as tabs. */
export function Workspace({ state }: { state: AppState }): React.JSX.Element {
  const [tab, setTab] = useState<Tab>(() => {
    try {
      const saved = localStorage.getItem(TAB_KEY);
      return TABS.some((t) => t.id === saved) ? (saved as Tab) : 'transcript';
    } catch {
      return 'transcript';
    }
  });
  const select = (next: Tab): void => {
    setTab(next);
    try {
      localStorage.setItem(TAB_KEY, next);
    } catch {
      // Storage unavailable: the tab just is not remembered.
    }
  };

  return (
    <section className={styles.card}>
      <div className={styles.tabs} role="tablist">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            className={tab === t.id ? styles.tabActive : styles.tab}
            onClick={() => select(t.id)}
          >
            {t.label}
            {t.id === 'questions' && state.questions.total > 0 && (
              <span className={styles.badge}>{state.questions.total}</span>
            )}
          </button>
        ))}
      </div>
      {tab === 'transcript' && <TranscriptTab />}
      {tab === 'turns' && <TurnsTab />}
      {tab === 'questions' && <QuestionsTab state={state} />}
    </section>
  );
}

/** Keeps a scrollable list pinned to the bottom while new items arrive, unless the user scrolled up. */
function useStickToBottom(deps: unknown[]): React.RefObject<HTMLDivElement | null> {
  const ref = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onScroll = (): void => {
      stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    };
    el.addEventListener('scroll', onScroll);
    return () => el.removeEventListener('scroll', onScroll);
  }, []);
  useEffect(() => {
    const el = ref.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return ref;
}

function TranscriptTab(): React.JSX.Element {
  const { segments, partials } = useTranscript();
  const live = [partials.system, partials.mic].filter((p) => p !== null);
  const listRef = useStickToBottom([segments, partials]);
  return (
    <div ref={listRef} className={styles.transcript}>
      {segments.length === 0 && live.length === 0 && <p className={styles.muted}>Пока пусто.</p>}
      {segments.map((s) => (
        <p key={s.id} className={styles.segment}>
          <span className={styles.time}>{formatSessionTime(s.tStart)}</span>
          <Speaker speaker={s.speaker} />
          {s.text}
        </p>
      ))}
      {live.map((p) => (
        <p key={`partial-${p.channel}`} className={`${styles.segment} ${styles.partial}`}>
          <span className={styles.time}>{formatSessionTime(p.tStart)}</span>
          <Speaker speaker={p.speaker} />
          {p.text}
        </p>
      ))}
    </div>
  );
}

function TurnsTab(): React.JSX.Element {
  const turns = useTurns();
  const listRef = useStickToBottom([turns]);
  return (
    <div ref={listRef} className={styles.transcript}>
      {turns.length === 0 && <p className={styles.muted}>Пока пусто.</p>}
      {turns.map((t) => (
        <div key={t.id} className={styles.turn}>
          <div className={styles.turnHead}>
            <span className={styles.time}>
              {formatSessionTime(t.tStart)}–{formatSessionTime(t.tEnd)}
            </span>
            <Speaker speaker={t.speaker} />
            {t.summary ? (
              <strong>{t.summary}</strong>
            ) : (
              !t.closed && <span className={styles.muted}>говорит…</span>
            )}
          </div>
          <p className={t.summary ? styles.turnText : styles.segment}>{t.text}</p>
        </div>
      ))}
    </div>
  );
}

function QuestionsTab({ state }: { state: AppState }): React.JSX.Element {
  const questions = useQuestions();
  const running = state.session.status === 'running';
  const visible = questions.filter((q) => q.status !== 'dismissed');
  const dismissed = questions.length - visible.length;
  return (
    <div className={styles.transcript}>
      {(!state.assistant.keys[state.assistant.analyze.provider] ||
        !state.assistant.keys[state.assistant.answer.provider]) && (
        <p className={styles.bad}>
          Не хватает API-ключа для выбранного провайдера — вопросы и ответы выключены (см. «Ассистент»).
        </p>
      )}
      {visible.length === 0 && (
        <p className={styles.muted}>
          Вопросов пока нет. Скажите ключевую фразу (например, «хороший вопрос») или нажмите Ctrl+Alt+Q —
          последние фразы собеседника станут вопросом, и ответ на него сгенерируется сразу.
        </p>
      )}
      {visible.map((q, i) => (
        <QuestionCard
          key={q.id}
          question={q}
          number={i + 1}
          current={q.id === state.questions.currentId}
          running={running}
        />
      ))}
      {dismissed > 0 && <p className={styles.muted}>Отклонено: {dismissed}</p>}
    </div>
  );
}

function QuestionCard({
  question: q,
  number,
  current,
  running,
}: {
  question: Question;
  number: number;
  current: boolean;
  running: boolean;
}): React.JSX.Element {
  return (
    <article className={current ? styles.questionCurrent : styles.question}>
      <div className={styles.turnHead}>
        <span className={styles.time}>
          #{number} · {formatSessionTime(q.tStart)}
        </span>
        <Speaker speaker={q.askedBy} />
        <span className={styles.muted}>{STATUS_LABELS[q.status]}</span>
        <span className={styles.spacer} />
        {!current && (
          <button
            className={styles.secondary}
            onClick={() => void window.api.invoke('questions:select', q.id)}
          >
            В оверлей
          </button>
        )}
        <button
          className={styles.secondary}
          disabled={!running || q.status === 'answering'}
          onClick={() => void window.api.invoke('questions:answer', q.id)}
        >
          {q.answer ? 'Ответить заново' : 'Ответить'}
        </button>
        <button
          className={styles.secondary}
          disabled={!running}
          onClick={() => void window.api.invoke('questions:dismiss', q.id)}
        >
          Отклонить
        </button>
      </div>
      <p className={styles.questionText}>{q.text}</p>
      {q.answer && (
        <div className={styles.answerText}>
          {q.answer.text || <span className={styles.muted}>Готовлю ответ…</span>}
          {q.answer.error && <p className={styles.bad}>{q.answer.error}</p>}
        </div>
      )}
    </article>
  );
}

function Speaker({ speaker }: { speaker: string | null }): React.JSX.Element {
  return (
    <span className={speaker === OWNER ? styles.owner : styles.speaker}>
      {speaker ? speakerLabel(speaker) : '…'}
    </span>
  );
}
