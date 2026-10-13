// Pipeline utility process: PCM from the capture window → VAD → STT → transcript.
import type { MessagePortMain } from 'electron';
import type { MainToPipeline, PipelineToMain } from '@shared/pipeline-protocol';
import type { PcmMessage } from '@shared/transcript';
import { PipelineSession } from './session';

const ACTIVITY_INTERVAL_MS = 100;

const parent = process.parentPort;
let session: PipelineSession | null = null;
let audioPort: MessagePortMain | null = null;

function send(message: PipelineToMain): void {
  parent.postMessage(message);
}

setInterval(() => {
  if (session) send({ type: 'activity', activity: session.activity() });
}, ACTIVITY_INTERVAL_MS);

parent.on('message', ({ data, ports }: { data: MainToPipeline; ports: MessagePortMain[] }) => {
  switch (data.type) {
    case 'ping':
      send({ type: 'pong', at: Date.now() });
      break;
    case 'audio-port':
      audioPort?.close();
      audioPort = ports[0] ?? null;
      audioPort?.on('message', ({ data: pcm }: { data: PcmMessage }) => session?.handlePcm(pcm));
      audioPort?.start();
      break;
    case 'session:start':
      void session?.stop();
      session = new PipelineSession(data.config, send);
      send({ type: 'log', level: 'info', message: `session ${data.config.sessionId} started` });
      break;
    case 'assistant:answer':
      session?.answer(data.questionId);
      break;
    case 'assistant:mark-question':
      session?.markQuestion();
      break;
    case 'assistant:set-triggers':
      session?.setTriggerPhrases(data.phrases);
      break;
    case 'assistant:dismiss':
      session?.dismissQuestion(data.questionId);
      break;
    case 'diarization:set-threshold':
      session?.setDiarizationThreshold(data.threshold);
      break;
    case 'session:stop': {
      const current = session;
      session = null;
      void (current?.stop() ?? Promise.resolve())
        .catch((e: unknown) => send({ type: 'log', level: 'error', message: `stop failed: ${String(e)}` }))
        .finally(() => send({ type: 'session:stopped' }));
      break;
    }
    case 'shutdown':
      void (session?.stop() ?? Promise.resolve()).finally(() => process.exit(0));
      break;
  }
});

send({ type: 'log', level: 'info', message: 'started' });
