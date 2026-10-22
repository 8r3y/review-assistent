import { useEffect, useRef } from 'react';
import { formatSessionTime } from '@shared/clock';
import { OVERLAY_HANDLE_HEIGHT, OVERLAY_SCROLLBAR_WIDTH, type HotkeyAction } from '@shared/ipc';
import { hotkeyLabel } from '@shared/platform';
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
  const bodyRef = useRef<HTMLDivElement>(null);
  /** The reader is at the bottom: keep following the streaming answer. */
  const stickRef = useRef(false);

  const session = state?.session;
  const running = session?.status === 'running' || session?.status === 'starting';
  const nav = state?.questions ?? { currentId: null, index: 0, total: 0 };
  const current = questions.find((q) => q.id === nav.currentId) ?? null;
  const error = state?.capture.error ?? state?.assistant.error ?? (running ? state?.stt.error : null);
  const answerText = current?.answer?.text;
  /** `Ctrl+Alt+Q` / `⌃⌥Q` followed by `suffix`, or an empty string when the shortcut is not registered. */
  const key = (action: HotkeyAction, suffix = ''): string => {
    const label = state ? hotkeyLabel(state.hotkeys, action, state.platform.os) : null;
    return label ? `${label}${suffix}` : '';
  };

  // Hotkeys scroll by most of a page, keeping a line of context.
  useEffect(
    () =>
      window.api.on('overlay:scroll', (direction) => {
        const el = bodyRef.current;
        if (el) el.scrollBy({ top: direction * el.clientHeight * 0.8, behavior: 'smooth' });
      }),
    [],
  );

  // A new question is read from the top.
  useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = 0;
    stickRef.current = false;
  }, [current?.id]);

  // Follow the streaming answer only while the reader stays at the bottom.
  useEffect(() => {
    const el = bodyRef.current;
    if (el && stickRef.current) el.scrollTop = el.scrollHeight;
  }, [answerText]);

  return (
    <div
      className={styles.root}
      style={{ '--scrollbar-width': `${OVERLAY_SCROLLBAR_WIDTH}px` } as React.CSSProperties}
    >
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
            title={`Предыдущий вопрос ${key('question.prev')}`.trim()}
            onClick={() => void window.api.invoke('questions:step', -1)}
          >
            ◀
          </button>
          <span className={styles.counter}>{nav.total > 0 ? `${nav.index} / ${nav.total}` : '0 / 0'}</span>
          <button
            className={styles.navButton}
            disabled={nav.index >= nav.total}
            title={`Следующий вопрос ${key('question.next')}`.trim()}
            onClick={() => void window.api.invoke('questions:step', 1)}
          >
            ▶
          </button>
        </span>
      </div>

      <div
        ref={bodyRef}
        className={styles.body}
        onScroll={(e) => {
          const el = e.currentTarget;
          stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
        }}
      >
        {error && <p className={styles.error}>{error}</p>}
        {!current && !error && (
          <p className={styles.hint}>
            {running
              ? `Вопросов пока нет · ключевая фраза${key('question.mark') ? ` или ${key('question.mark')}` : ''}`
              : `${key('session.toggle', ' — ')}начать сессию`}
          </p>
        )}
        {current && (
          <>
            <p className={current.worded ? styles.question : styles.questionRaw}>
              <span className={styles.asker}>{speakerLabel(current.askedBy)}</span>
              {current.text}
              {current.screenshots.length > 0 && (
                <span className={styles.muted}> · 📷 {current.screenshots.length}</span>
              )}
            </p>
            {current.answer ? (
              <div className={styles.answer}>
                {current.answer.text || <span className={styles.muted}>Готовлю ответ…</span>}
                {current.answer.error && <p className={styles.error}>{current.answer.error}</p>}
              </div>
            ) : (
              <p className={styles.hint}>
                {current.worded
                  ? `${key('question.answer', ' — ')}ответить`
                  : `Вопрос не определён: ${key('screenshot', ' — ')}скриншот, или уточните и ${key('question.answer') || 'ответьте'}`}
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
