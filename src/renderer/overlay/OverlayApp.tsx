import { formatSessionTime } from '@shared/clock';
import { OVERLAY_HANDLE_HEIGHT } from '@shared/ipc';
import { OWNER, speakerLabel, type PartialText, type Segment } from '@shared/transcript';
import { useAppState, useNow } from '../common/useAppState';
import { useAudioActivity, useTranscript } from '../common/useTranscript';
import styles from './OverlayApp.module.css';

const VISIBLE_SEGMENTS = 4;

export function OverlayApp(): React.JSX.Element {
  const state = useAppState();
  const now = useNow(1000);
  const { segments, partials } = useTranscript();
  const activity = useAudioActivity();
  const session = state?.session;
  const running = session?.status === 'running' || session?.status === 'starting';
  const passthrough = state?.overlay.mode === 'passthrough';
  const live = [partials.system, partials.mic].filter((p): p is PartialText => p !== null);
  const error = state?.capture.error ?? (running ? state?.stt.error : null);

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
        <span className={styles.muted} title="Режим мыши">
          {passthrough ? 'сквозной' : 'интерактивный'}
        </span>
      </div>
      <div className={styles.captions}>
        {error && <p className={styles.error}>{error}</p>}
        {!running && segments.length === 0 && !error && (
          <p className={styles.hint}>Ctrl+Alt+S — начать сессию</p>
        )}
        {segments.slice(-VISIBLE_SEGMENTS).map((segment) => (
          <Line key={segment.id} segment={segment} />
        ))}
        {live.map((partial) => (
          <Line key={`partial-${partial.channel}`} segment={partial} partial />
        ))}
      </div>
    </div>
  );
}

function Line({
  segment,
  partial = false,
}: {
  segment: Pick<Segment, 'speaker' | 'text'> | PartialText;
  partial?: boolean;
}): React.JSX.Element {
  const speaker = segment.speaker ?? '…';
  return (
    <p className={partial ? styles.partial : styles.line}>
      <span className={speaker === OWNER ? styles.owner : styles.speaker}>{speakerLabel(speaker)}</span>
      {segment.text}
    </p>
  );
}
