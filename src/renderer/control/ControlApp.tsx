import { useEffect, useRef, useState } from 'react';
import { formatSessionTime } from '@shared/clock';
import type { AppState, HotkeyAction, OverlayMode } from '@shared/ipc';
import { OWNER, speakerLabel, type ChannelActivity, type SttStatus } from '@shared/transcript';
import { levelFraction } from '../common/activity';
import { useAppState, useNow } from '../common/useAppState';
import { useAudioActivity, useTranscript } from '../common/useTranscript';
import styles from './ControlApp.module.css';

const HOTKEY_LABELS: Record<HotkeyAction, string> = {
  'session.toggle': 'Старт/стоп сессии',
  'overlay.toggleVisible': 'Показать/скрыть оверлей',
  'overlay.toggleMode': 'Сквозной режим вкл/выкл',
  'overlay.opacityDown': 'Прозрачность −',
  'overlay.opacityUp': 'Прозрачность +',
  'video.toggle': 'Видеозапись старт/стоп',
  screenshot: 'Скриншот',
  marker: 'Маркер',
  'summarize.now': 'Суммаризировать реплику',
};

const STT_STATUS_LABELS: Record<SttStatus, string> = {
  off: 'выключено',
  connecting: 'подключение…',
  open: 'работает',
  reconnecting: 'переподключение…',
  error: 'ошибка',
};

export function ControlApp(): React.JSX.Element {
  const state = useAppState();
  if (!state) return <main className={styles.root} />;
  return (
    <main className={styles.root}>
      <SessionCard state={state} />
      <TranscriptCard />
      <AudioCard state={state} />
      <SttCard state={state} />
      <DiarizationCard state={state} />
      <OverlayCard state={state} />
      <HotkeysCard state={state} />
    </main>
  );
}

function SessionCard({ state }: { state: AppState }): React.JSX.Element {
  const now = useNow(1000);
  const { status, startedAt, dir } = state.session;
  const busy = status === 'starting' || status === 'stopping';
  const running = status === 'running';
  return (
    <section className={styles.card}>
      <h2>Сессия</h2>
      <div className={styles.row}>
        <button
          className={running ? styles.danger : styles.primary}
          disabled={busy}
          onClick={() => void window.api.invoke(running ? 'session:stop' : 'session:start')}
        >
          {status === 'starting'
            ? 'Запуск…'
            : status === 'stopping'
              ? 'Остановка…'
              : running
                ? 'Остановить'
                : 'Начать'}
        </button>
        <span className={styles.timer}>{startedAt !== null ? formatSessionTime(now - startedAt) : '—'}</span>
        <span className={styles.spacer} />
        <span className={state.pipeline.alive ? styles.ok : styles.bad}>
          pipeline: {state.pipeline.alive ? 'работает' : 'не отвечает'}
        </span>
      </div>
      {state.capture.error && <p className={styles.bad}>Захват звука: {state.capture.error}</p>}
      {dir && <p className={styles.muted}>Папка сессии: {dir}</p>}
    </section>
  );
}

function TranscriptCard(): React.JSX.Element {
  const { segments, partials } = useTranscript();
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [segments, partials]);
  const live = [partials.system, partials.mic].filter((p) => p !== null);
  return (
    <section className={styles.card}>
      <h2>Транскрипт</h2>
      <div ref={listRef} className={styles.transcript}>
        {segments.length === 0 && live.length === 0 && <p className={styles.muted}>Пока пусто.</p>}
        {segments.map((s) => (
          <p key={s.id} className={styles.segment}>
            <span className={styles.time}>{formatSessionTime(s.tStart)}</span>
            <span className={s.speaker === OWNER ? styles.owner : styles.speaker}>
              {speakerLabel(s.speaker)}
            </span>
            {s.text}
          </p>
        ))}
        {live.map((p) => (
          <p key={`partial-${p.channel}`} className={`${styles.segment} ${styles.partial}`}>
            <span className={styles.time}>{formatSessionTime(p.tStart)}</span>
            <span className={p.speaker === OWNER ? styles.owner : styles.speaker}>
              {p.speaker ? speakerLabel(p.speaker) : '…'}
            </span>
            {p.text}
          </p>
        ))}
      </div>
    </section>
  );
}

function AudioCard({ state }: { state: AppState }): React.JSX.Element {
  const activity = useAudioActivity();
  const devices = useMicrophones();
  const locked = state.session.status !== 'idle';
  return (
    <section className={styles.card}>
      <h2>Звук</h2>
      <label className={styles.row}>
        <span className={styles.label}>Микрофон</span>
        <select
          disabled={locked}
          value={state.audio.micDeviceId ?? ''}
          onChange={(e) =>
            void window.api.invoke('audio:set-settings', { micDeviceId: e.target.value || null })
          }
        >
          <option value="">По умолчанию</option>
          {devices.map((d, i) => (
            <option key={d.deviceId} value={d.deviceId}>
              {d.label || `Микрофон ${i + 1}`}
            </option>
          ))}
        </select>
      </label>
      <label className={styles.row}>
        <input
          type="checkbox"
          disabled={locked}
          checked={state.audio.recordAudio}
          onChange={(e) => void window.api.invoke('audio:set-settings', { recordAudio: e.target.checked })}
        />
        Записывать аудио (audio.webm: левый канал — микрофон, правый — системный звук)
      </label>
      <Meter label="Я (микрофон)" activity={activity.mic} />
      <Meter label="Собеседники (системный звук)" activity={activity.system} />
      {locked && <p className={styles.muted}>Настройки звука применяются к следующей сессии.</p>}
    </section>
  );
}

function Meter({ label, activity }: { label: string; activity: ChannelActivity }): React.JSX.Element {
  return (
    <div className={styles.row}>
      <span className={styles.label}>{label}</span>
      <div className={styles.meter}>
        <div
          className={activity.speech ? styles.meterSpeech : styles.meterFill}
          style={{ width: `${levelFraction(activity.levelDb) * 100}%` }}
        />
      </div>
      <span className={activity.speech ? styles.ok : styles.muted}>
        {activity.speech ? 'речь' : 'тишина'}
      </span>
    </div>
  );
}

function SttCard({ state }: { state: AppState }): React.JSX.Element {
  const [key, setKey] = useState('');
  const { stt } = state;
  const locked = state.session.status !== 'idle';
  return (
    <section className={styles.card}>
      <h2>Транскрибация (Deepgram)</h2>
      <div className={styles.row}>
        <span className={styles.label}>API-ключ</span>
        {stt.hasKey ? (
          <>
            <span className={styles.ok}>сохранён (зашифрован)</span>
            <button className={styles.secondary} onClick={() => void window.api.invoke('stt:set-key', null)}>
              Удалить
            </button>
          </>
        ) : (
          <>
            <input
              type="password"
              placeholder="ключ Deepgram"
              value={key}
              onChange={(e) => setKey(e.target.value)}
            />
            <button
              className={styles.secondary}
              disabled={!key.trim()}
              onClick={() => void window.api.invoke('stt:set-key', key).then(() => setKey(''))}
            >
              Сохранить
            </button>
          </>
        )}
      </div>
      <label className={styles.row}>
        <span className={styles.label}>Модель</span>
        <input
          disabled={locked}
          defaultValue={stt.model}
          onBlur={(e) => void window.api.invoke('stt:set-settings', { model: e.target.value })}
        />
        <span className={styles.label}>Язык</span>
        <input
          disabled={locked}
          className={styles.short}
          defaultValue={stt.language}
          onBlur={(e) => void window.api.invoke('stt:set-settings', { language: e.target.value })}
        />
      </label>
      <div className={styles.row}>
        <span className={styles.label}>Статус</span>
        <span>Я: {STT_STATUS_LABELS[stt.status.mic]}</span>
        <span>Собеседники: {STT_STATUS_LABELS[stt.status.system]}</span>
      </div>
      {stt.error && <p className={styles.bad}>{stt.error}</p>}
    </section>
  );
}

function DiarizationCard({ state }: { state: AppState }): React.JSX.Element {
  const { threshold } = state.diarization;
  return (
    <section className={styles.card}>
      <h2>Разделение говорящих</h2>
      <label className={styles.row}>
        <span className={styles.label}>Порог сходства</span>
        <span className={styles.muted}>объединять</span>
        <input
          type="range"
          min={0.1}
          max={0.7}
          step={0.01}
          value={threshold}
          onChange={(e) =>
            void window.api.invoke('diarization:set-settings', { threshold: Number(e.target.value) })
          }
        />
        <span className={styles.muted}>разделять</span>
        <span className={styles.timer}>{threshold.toFixed(2)}</span>
      </label>
      <p className={styles.muted}>
        Если разные собеседники попадают под одну метку — сдвиньте вправо; если один человек дробится на
        несколько — влево. В идущей сессии применяется со следующей фразы и переразмечает уже распознанные.
      </p>
    </section>
  );
}

function OverlayCard({ state }: { state: AppState }): React.JSX.Element {
  const { visible, mode, opacity } = state.overlay;
  const setMode = (m: OverlayMode): void => void window.api.invoke('overlay:set-mode', m);
  return (
    <section className={styles.card}>
      <h2>Оверлей</h2>
      <label className={styles.row}>
        <input
          type="checkbox"
          checked={visible}
          onChange={(e) => void window.api.invoke('overlay:set-visible', e.target.checked)}
        />
        Показывать
      </label>
      <div className={styles.row}>
        <span className={styles.label}>Мышь</span>
        <label>
          <input type="radio" checked={mode === 'interactive'} onChange={() => setMode('interactive')} />
          Интерактивный
        </label>
        <label>
          <input type="radio" checked={mode === 'passthrough'} onChange={() => setMode('passthrough')} />
          Сквозной (клики проходят насквозь, кроме верхней полосы)
        </label>
      </div>
      <label className={styles.row}>
        <span className={styles.label}>Непрозрачность</span>
        <input
          type="range"
          min={0.2}
          max={1}
          step={0.05}
          value={opacity}
          onChange={(e) => void window.api.invoke('overlay:set-opacity', Number(e.target.value))}
        />
        <span className={styles.timer}>{Math.round(opacity * 100)}%</span>
      </label>
    </section>
  );
}

function HotkeysCard({ state }: { state: AppState }): React.JSX.Element {
  return (
    <section className={styles.card}>
      <h2>Горячие клавиши</h2>
      <table className={styles.table}>
        <tbody>
          {state.hotkeys.map((h) => (
            <tr key={h.action}>
              <td>{HOTKEY_LABELS[h.action]}</td>
              <td>
                <kbd>{h.accelerator.replace('CommandOrControl', 'Ctrl')}</kbd>
              </td>
              <td className={!h.available ? styles.muted : h.registered ? styles.ok : styles.bad}>
                {!h.available ? 'в разработке' : h.registered ? 'активна' : 'занята другим приложением'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function useMicrophones(): MediaDeviceInfo[] {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  useEffect(() => {
    const load = (): void =>
      void navigator.mediaDevices
        .enumerateDevices()
        .then((all) => setDevices(all.filter((d) => d.kind === 'audioinput' && d.deviceId !== 'default')));
    load();
    navigator.mediaDevices.addEventListener('devicechange', load);
    return () => navigator.mediaDevices.removeEventListener('devicechange', load);
  }, []);
  return devices;
}
