import { useEffect, useRef } from 'react';
import { formatSessionTime } from '@shared/clock';
import { OVERLAY_HANDLE_HEIGHT } from '@shared/ipc';
import { speakerLabel } from '@shared/transcript';
import { useQuestions } from '../common/useAssistant';
import { useAppState, useNow } from '../common/useAppState';
import { useAudioActivity } from '../common/useTranscript';
import styles from './OverlayApp.module.css';

/** The overlay shows only questions: the current one, its answer once requested, and N / M. */
export function OverlayApp(): React.JSX.Element {
  const state = useAppState();
  const now = useNow(1000);
  const activity = useAudioActivity();
  const questions = useQuestions();
  const answerRef = useRef<HTMLDivElement>(null);

  const session = state?.session;
  const running = session?.status === 'running' || session?.status === 'starting';
  const nav = state?.questions ?? { currentId: null, index: 0, total: 0 };
  const current = questions.find((q) => q.id === nav.currentId) ?? null;
  const error = state?.capture.error ?? state?.assistant.error ?? (running ? state?.stt.error : null);
  const answerText = current?.answer?.text;

  // Follow the streaming answer.
  useEffect(() => {
    const el = answerRef.current;
    if (el && current?.status === 'answering') el.scrollTop = el.scrollHeight;
  }, [answerText, current?.status]);

  return (
    <div className={styles.root}>
      <div className={styles.handle} style={{ height: OVERLAY_HANDLE_HEIGHT }}>
        <span className={styles.grip} aria-hidden>
          ⠿
        </span>
        {running && session?.startedAt ? (
          <span className={styles.rec}>● {formatSessionTime(now - session.startedAt)}</span>
        ) : (
          <span className={styles.muted}>сессия не запущена</span>
        )}
        {running && (
          <>
            <span className={activity.mic.speech ? styles.talkOwner : styles.talkIdle}>Я</span>
            <span className={activity.system.speech ? styles.talkOther : styles.talkIdle}>Собеседники</span>
          </>
        )}
        <span className={styles.spacer} />
        <span className={styles.nav}>
          <button
            className={styles.navButton}
            disabled={nav.index <= 1}
            title="Предыдущий вопрос (Ctrl+Alt+↑)"
            onClick={() => void window.api.invoke('questions:step', -1)}
          >
            ◀
          </button>
          <span className={styles.counter}>{nav.total > 0 ? `${nav.index} / ${nav.total}` : '0 / 0'}</span>
          <button
            className={styles.navButton}
            disabled={nav.index >= nav.total}
            title="Следующий вопрос (Ctrl+Alt+↓)"
            onClick={() => void window.api.invoke('questions:step', 1)}
          >
            ▶
          </button>
        </span>
      </div>

      <div className={styles.body}>
        {error && <p className={styles.error}>{error}</p>}
        {!current && !error && (
          <p className={styles.hint}>
            {running ? 'Вопросов пока нет · Ctrl+Alt+Q — это вопрос' : 'Ctrl+Alt+S — начать сессию'}
          </p>
        )}
        {current && (
          <>
            <p className={styles.question}>
              <span className={styles.asker}>{speakerLabel(current.askedBy)}</span>
              {current.text}
            </p>
            {current.status === 'closed' && <p className={styles.muted}>вопрос снят</p>}
            {current.answer ? (
              <div ref={answerRef} className={styles.answer}>
                {current.answer.text || <span className={styles.muted}>Готовлю ответ…</span>}
                {current.answer.error && <p className={styles.error}>{current.answer.error}</p>}
              </div>
            ) : (
              <p className={styles.hint}>Ctrl+Alt+A — ответить</p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
