import { useEffect, useState } from 'react';
import {
  DEFAULT_ENDPOINTS,
  LLM_PROVIDERS,
  type Effort,
  type LlmProviderId,
  type LlmRoute,
  type LlmTask,
} from '@shared/assistant';
import { formatSessionTime } from '@shared/clock';
import { formatAccelerator } from '@shared/platform';
import { parseCommaList } from '@shared/text';
import {
  MAX_STT_KEYTERMS,
  type AppState,
  type HotkeyAction,
  type OverlayMode,
  type VideoSource,
} from '@shared/ipc';
import type { ChannelActivity, SttStatus } from '@shared/transcript';
import { levelFraction } from '../common/activity';
import { useAppState, useNow } from '../common/useAppState';
import { useAudioActivity } from '../common/useTranscript';
import styles from './ControlApp.module.css';
import { Workspace } from './Workspace';

const HOTKEY_LABELS: Record<HotkeyAction, string> = {
  'session.toggle': 'Старт/стоп сессии',
  'overlay.toggleVisible': 'Показать/скрыть оверлей',
  'overlay.toggleMode': 'Сквозной режим вкл/выкл',
  'overlay.opacityDown': 'Прозрачность −',
  'overlay.opacityUp': 'Прозрачность +',
  'overlay.scrollUp': 'Прокрутить оверлей вверх',
  'overlay.scrollDown': 'Прокрутить оверлей вниз',
  'video.toggle': 'Видеозапись старт/стоп',
  screenshot: 'Скриншот к последнему вопросу + ответ',
  'question.answer': 'Дополнить последний вопрос новыми фразами и ответить',
  'question.mark': 'Вопрос из фраз собеседника после прошлого вопроса + ответ',
  'question.prev': 'Предыдущий вопрос',
  'question.next': 'Следующий вопрос',
  'question.dismiss': 'Отклонить текущий вопрос',
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
      <PlatformNotes state={state} />
      <Workspace state={state} />
      <AudioCard state={state} />
      <VideoCard state={state} />
      <SttCard state={state} />
      <AssistantCard state={state} />
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

/** What this OS does differently from Windows, where everything works. */
function PlatformNotes({ state }: { state: AppState }): React.JSX.Element | null {
  const { os, captureProtection, portalCapture, weakSecrets } = state.platform;
  const notes: string[] = [];
  if (captureProtection === 'none') {
    notes.push(
      'Оверлей виден в демонстрации экрана и записи: в Linux нет защиты окна от захвата. Перед демонстрацией скройте его горячей клавишей.',
    );
  } else if (captureProtection === 'partial') {
    notes.push(
      'Оверлей скрыт только от старых способов захвата: программы на ScreenCaptureKit (macOS 15 и новее — почти все) его видят. Проверьте перед созвоном в вашей программе для звонков; если виден — скрывайте его горячей клавишей на время демонстрации.',
    );
  }
  if (portalCapture) {
    notes.push(
      'Wayland: экран или окно для скриншотов и видео выбирается в системном диалоге при первом скриншоте или записи в сессии и держится до её конца.',
    );
  }
  if (weakSecrets) {
    notes.push(
      'Не найдено системное хранилище паролей (KWallet / GNOME Keyring): API-ключи сохраняются почти в открытом виде.',
    );
  }
  if (os === 'darwin') {
    notes.push(
      'macOS спросит доступ к микрофону, записи экрана и системного аудио. Если звука собеседников нет — проверьте «Конфиденциальность и безопасность → Запись экрана и системного аудио».',
    );
  }
  if (notes.length === 0) return null;
  return (
    <section className={styles.card}>
      <h2>Особенности системы</h2>
      {notes.map((note) => (
        <p key={note} className={styles.muted}>
          {note}
        </p>
      ))}
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

function VideoCard({ state }: { state: AppState }): React.JSX.Element {
  const now = useNow(1000);
  const [sources, setSources] = useState<VideoSource[] | null>(null);
  const { video } = state;
  const { portalCapture, captureProtection } = state.platform;
  const refresh = (): void => void window.api.invoke('video:list-sources').then(setSources);
  useEffect(refresh, []);
  const sessionRunning = state.session.status === 'running';
  const recording = video.status === 'recording';
  const busy = video.status === 'starting' || video.status === 'stopping';
  // Saved source by id, or the primary screen when none is saved.
  const selected = (s: VideoSource): boolean =>
    video.sourceId ? s.id === video.sourceId : s === sources?.find((x) => x.kind === 'screen');
  const pick = (s: VideoSource): void =>
    void window.api.invoke('video:set-source', { id: s.id, name: s.name });
  return (
    <section className={styles.card}>
      <h2>Видео и скриншоты</h2>
      <div className={styles.row}>
        <button
          className={recording ? styles.danger : styles.primary}
          disabled={busy || (!recording && !sessionRunning)}
          onClick={() => void window.api.invoke(recording ? 'video:stop' : 'video:start')}
        >
          {video.status === 'starting'
            ? 'Запуск…'
            : video.status === 'stopping'
              ? 'Остановка…'
              : recording
                ? 'Остановить запись'
                : 'Записывать видео'}
        </button>
        <span className={styles.timer}>
          {video.startedAt !== null ? formatSessionTime(now - video.startedAt) : '—'}
        </span>
        <span className={styles.muted}>
          {video.sourceName ?? (portalCapture ? 'выбирается в системном диалоге' : 'Основной экран')}
        </span>
        <span className={styles.spacer} />
        <button
          className={styles.secondary}
          disabled={!sessionRunning}
          onClick={() => void window.api.invoke('screenshot:take')}
        >
          Скриншот к вопросу
        </button>
        {portalCapture ? (
          <button
            className={styles.secondary}
            disabled={!sessionRunning || recording || busy}
            onClick={() => void window.api.invoke('video:pick-source')}
          >
            Выбрать источник…
          </button>
        ) : (
          <button className={styles.secondary} disabled={recording || busy} onClick={refresh}>
            Обновить список
          </button>
        )}
      </div>
      {video.error && <p className={styles.bad}>{video.error}</p>}
      {portalCapture && (
        <p className={styles.muted}>
          Экран или окно выбирается в системном диалоге при первом скриншоте или записи в сессии и
          используется до её конца. «Выбрать источник…» — сменить его.
        </p>
      )}
      <div className={styles.sources}>
        {sources?.map((s) => (
          <button
            key={s.id}
            className={selected(s) ? styles.sourceSelected : styles.source}
            disabled={recording || busy}
            title={s.name}
            onClick={() => pick(s)}
          >
            {s.thumbnail ? <img src={s.thumbnail} alt="" /> : <div className={styles.noThumb} />}
            <span>
              {s.kind === 'screen' ? '🖥 ' : ''}
              {s.name}
            </span>
          </button>
        ))}
      </div>
      <p className={styles.muted}>
        Запись идёт во время сессии в её папку (до 1920×1080, 30 к/с). При остановке сессии в видео вшивается
        звук разговора.{captureProtection === 'none' ? '' : ' Оверлей в запись не попадает.'} Горячая клавиша
        — в таблице ниже.
      </p>
      <p className={styles.muted}>
        Скриншот снимает тот же источник и добавляется к последнему вопросу вместе с новыми фразами
        собеседника — ответ генерируется заново с учётом экрана (схема, код для лайвкодинга).
        {captureProtection === 'none' ? '' : ' Оверлей на скриншот не попадает.'}
      </p>
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
      {/* key: reset the field when the saved list changes */}
      <KeytermsRow key={stt.keyterms.join(', ')} keyterms={stt.keyterms} locked={locked} />
      <div className={styles.row}>
        <span className={styles.label}>Статус</span>
        <span>Я: {STT_STATUS_LABELS[stt.status.mic]}</span>
        <span>Собеседники: {STT_STATUS_LABELS[stt.status.system]}</span>
      </div>
      {stt.error && <p className={styles.bad}>{stt.error}</p>}
    </section>
  );
}

function AssistantCard({ state }: { state: AppState }): React.JSX.Element {
  const { assistant } = state;
  const [context, setContext] = useState<string | null>(null);
  const [savedContext, setSavedContext] = useState('');
  useEffect(() => {
    void window.api.invoke('assistant:get-context').then((text) => {
      setContext(text);
      setSavedContext(text);
    });
  }, []);
  return (
    <section className={styles.card}>
      <h2>Ассистент (LLM)</h2>
      <ProviderTabs assistant={assistant} />
      <div className={styles.divider} />
      <RouteRow task="analyze" label="Вопрос, саммари" route={assistant.analyze} keys={assistant.keys} />
      <RouteRow task="answer" label="Ответы" route={assistant.answer} keys={assistant.keys} />
      <p className={styles.muted}>
        Провайдер и модель выбираются для каждой задачи отдельно, например быстрая модель для формулировки
        вопроса и саммари реплик и сильная для ответов. Изменения применяются со следующей сессии.
      </p>
      <div className={styles.divider} />
      {/* key: reset the field when the saved list changes */}
      <TriggerPhrasesRow key={assistant.triggerPhrases.join(', ')} phrases={assistant.triggerPhrases} />
      <label className={styles.column}>
        <span className={styles.label}>Мой контекст — о себе, проекте, опыте; используется в ответах</span>
        <textarea
          className={styles.textarea}
          rows={6}
          value={context ?? ''}
          disabled={context === null}
          placeholder="Например: я backend-разработчик, 6 лет Go и Kafka; сейчас делаю платёжный сервис…"
          onChange={(e) => setContext(e.target.value)}
        />
      </label>
      <div className={styles.row}>
        <button
          className={styles.secondary}
          disabled={context === null || context === savedContext}
          onClick={() =>
            void window.api
              .invoke('assistant:set-context', context ?? '')
              .then(() => setSavedContext(context ?? ''))
          }
        >
          Сохранить контекст
        </button>
        {context !== null && context !== savedContext && <span className={styles.muted}>не сохранено</span>}
      </div>
      {assistant.error && <p className={styles.bad}>{assistant.error}</p>}
    </section>
  );
}

function KeytermsRow({ keyterms, locked }: { keyterms: string[]; locked: boolean }): React.JSX.Element {
  const saved = keyterms.join(', ');
  const [value, setValue] = useState(saved);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const count = parseCommaList(value).length;
  const tooMany = count > MAX_STT_KEYTERMS;
  const dirty = value.trim() !== saved;
  const canSave = !locked && dirty && !tooMany && !checking;
  const save = (): void => {
    setChecking(true);
    void window.api
      .invoke('stt:set-keyterms', value)
      .then(setError)
      .finally(() => setChecking(false));
  };
  return (
    <label className={styles.column}>
      <span className={styles.label}>
        Термины через запятую — слова, которые распознавание должно слышать (англицизмы: Kafka, RabbitMQ…).
        Русская модель без подсказки пропускает английские слова. Лучше 20–50 самых нужных: длинный список
        размывает подсказку. Применяется со следующей сессии.
      </span>
      <div className={styles.row}>
        <input
          className={styles.wide}
          disabled={locked}
          value={value}
          placeholder="Kafka, RabbitMQ, Kubernetes"
          onChange={(e) => {
            setValue(e.target.value);
            setError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && canSave) save();
          }}
        />
        <button className={styles.secondary} disabled={!canSave} onClick={save}>
          {checking ? 'Проверяю…' : 'Сохранить'}
        </button>
        <span className={tooMany ? styles.bad : styles.muted}>
          {count} / {MAX_STT_KEYTERMS}
        </span>
      </div>
      {error && <span className={styles.bad}>{error}</span>}
    </label>
  );
}

function TriggerPhrasesRow({ phrases }: { phrases: string[] }): React.JSX.Element {
  const saved = phrases.join(', ');
  const [value, setValue] = useState(saved);
  const dirty = value.trim() !== saved;
  const save = (): void => void window.api.invoke('assistant:set-triggers', value);
  return (
    <label className={styles.column}>
      <span className={styles.label}>
        Ключевые фразы через запятую — сказанные в начале вашей реплики, делают вопрос из последних фраз
        собеседника и сразу генерируют ответ. Пусто — выключено. Применяется сразу.
      </span>
      <div className={styles.row}>
        <input
          className={styles.wide}
          value={value}
          placeholder="хороший вопрос, понял ваш вопрос"
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && dirty) save();
          }}
        />
        <button className={styles.secondary} disabled={!dirty} onClick={save}>
          Сохранить
        </button>
      </div>
    </label>
  );
}

/** Per-API-family settings in tabs: where requests go and with which key. */
function ProviderTabs({ assistant }: { assistant: AppState['assistant'] }): React.JSX.Element {
  const [tab, setTab] = useState<LlmProviderId>(assistant.answer.provider);
  return (
    <>
      <div className={styles.tabs} role="tablist">
        {LLM_PROVIDERS.map((p) => (
          <button
            key={p.id}
            role="tab"
            aria-selected={tab === p.id}
            className={tab === p.id ? styles.tabActive : styles.tab}
            onClick={() => setTab(p.id)}
          >
            {p.label}-совместимые
            {assistant.keys[p.id] && (
              <span className={styles.ok} title="ключ сохранён">
                ●
              </span>
            )}
          </button>
        ))}
      </div>
      {/* key: reset the fields when switching tabs or when the saved endpoint changes */}
      <EndpointChoice
        key={`${tab}:${assistant.endpoints[tab] ?? ''}`}
        provider={tab}
        endpoint={assistant.endpoints[tab]}
      />
      <ApiKeyRow key={tab} provider={tab} saved={assistant.keys[tab]} />
      <p className={styles.muted}>{PROVIDER_NOTES[tab]}</p>
    </>
  );
}

const PROVIDER_NOTES: Record<LlmProviderId, string> = {
  anthropic:
    'Messages API: Claude или совместимый шлюз (например, https://api.fastypass.com:8444). Адрес — без /v1.',
  google: 'Gemini API или совместимый шлюз. Адрес — без версии в пути.',
  openai:
    'Chat Completions: OpenAI, OpenRouter, vLLM, Ollama, LiteLLM… Адрес — с версией (…/v1), к нему добавляется /chat/completions.',
};

function EndpointChoice({
  provider,
  endpoint,
}: {
  provider: LlmProviderId;
  endpoint: string | null;
}): React.JSX.Element {
  const [custom, setCustom] = useState(endpoint !== null);
  const [value, setValue] = useState(endpoint ?? '');
  const [error, setError] = useState<string | null>(null);
  const dirty = value.trim() !== (endpoint ?? '');
  const save = (url: string | null): void =>
    void window.api.invoke('assistant:set-endpoint', provider, url).then(setError);
  return (
    <>
      <div className={styles.row}>
        <span className={styles.label}>Эндпоинт</span>
        <label>
          <input
            type="radio"
            checked={!custom}
            onChange={() => {
              setCustom(false);
              setError(null);
              if (endpoint) save(null);
            }}
          />
          Официальный <span className={styles.muted}>{DEFAULT_ENDPOINTS[provider]}</span>
        </label>
      </div>
      <div className={styles.row}>
        <span className={styles.label} />
        <label>
          <input type="radio" checked={custom} onChange={() => setCustom(true)} />
          Свой
        </label>
        <input
          className={styles.wide}
          disabled={!custom}
          placeholder="https://gateway.example.com"
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && dirty && value.trim()) save(value);
          }}
        />
        <button
          className={styles.secondary}
          disabled={!custom || !dirty || !value.trim()}
          onClick={() => save(value)}
        >
          Сохранить
        </button>
      </div>
      {error && <p className={styles.bad}>{error}</p>}
      {custom && endpoint && <p className={styles.muted}>Через этот адрес идут ключ и текст разговора.</p>}
    </>
  );
}

function ApiKeyRow({ provider, saved }: { provider: LlmProviderId; saved: boolean }): React.JSX.Element {
  const [key, setKey] = useState('');
  return (
    <div className={styles.row}>
      <span className={styles.label}>API-ключ</span>
      {saved ? (
        <>
          <span className={styles.ok}>сохранён (зашифрован)</span>
          <button
            className={styles.secondary}
            onClick={() => void window.api.invoke('assistant:set-key', provider, null)}
          >
            Удалить
          </button>
        </>
      ) : (
        <>
          <input
            type="password"
            placeholder="API-ключ"
            value={key}
            onChange={(e) => setKey(e.target.value)}
          />
          <button
            className={styles.secondary}
            disabled={!key.trim()}
            onClick={() => void window.api.invoke('assistant:set-key', provider, key).then(() => setKey(''))}
          >
            Сохранить
          </button>
        </>
      )}
    </div>
  );
}

function RouteRow({
  task,
  label,
  route,
  keys,
}: {
  task: LlmTask;
  label: string;
  route: LlmRoute;
  keys: Record<LlmProviderId, boolean>;
}): React.JSX.Element {
  const set = (patch: Partial<LlmRoute>): void => void window.api.invoke('assistant:set-route', task, patch);
  return (
    <div className={styles.row}>
      <span className={styles.label}>{label}</span>
      <select value={route.provider} onChange={(e) => set({ provider: e.target.value as LlmProviderId })}>
        {LLM_PROVIDERS.map((p) => (
          <option key={p.id} value={p.id}>
            {p.label}
          </option>
        ))}
      </select>
      {/* key: re-mount when the provider switches the model to its default */}
      <input key={route.model} defaultValue={route.model} onBlur={(e) => set({ model: e.target.value })} />
      effort
      <select
        className={styles.short}
        value={route.effort}
        onChange={(e) => set({ effort: e.target.value as Effort })}
      >
        <option value="low">low</option>
        <option value="medium">medium</option>
        <option value="high">high</option>
      </select>
      {!keys[route.provider] && <span className={styles.bad}>нет ключа</span>}
    </div>
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
          Сквозной (клики проходят насквозь, кроме верхней полосы и полосы прокрутки справа)
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
                <kbd>{formatAccelerator(h.accelerator, state.platform.os)}</kbd>
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
