import { utilityProcess, type MessagePortMain, type UtilityProcess } from 'electron';
import { join } from 'node:path';
import type { MainToPipeline, PipelineToMain } from '@shared/pipeline-protocol';

const RESTART_DELAY_MS = 1000;
const PING_INTERVAL_MS = 5000;
const PING_TIMEOUT_MS = 3000;

type Listener = (message: PipelineToMain) => void;

/** Runs the transcription pipeline in a utility process and restarts it if it dies. */
export class PipelineHost {
  private child: UtilityProcess | null = null;
  private pingTimer: NodeJS.Timeout | null = null;
  private lastPong = 0;
  private stopped = false;
  private readonly listeners = new Set<Listener>();

  constructor(private readonly onAliveChanged: (alive: boolean) => void) {}

  start(): void {
    this.stopped = false;
    this.spawn();
    this.pingTimer = setInterval(() => {
      this.send({ type: 'ping', at: Date.now() });
      if (Date.now() - this.lastPong > PING_INTERVAL_MS + PING_TIMEOUT_MS) this.onAliveChanged(false);
    }, PING_INTERVAL_MS);
  }

  stop(): void {
    this.stopped = true;
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.send({ type: 'shutdown' });
    this.child = null;
  }

  send(message: MainToPipeline, ports?: MessagePortMain[]): void {
    this.child?.postMessage(message, ports);
  }

  onMessage(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Resolves with the first message of `type`, or null after `timeoutMs`. */
  waitFor<T extends PipelineToMain['type']>(type: T, timeoutMs: number): Promise<PipelineToMain | null> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        off();
        resolve(null);
      }, timeoutMs);
      const off = this.onMessage((message) => {
        if (message.type !== type) return;
        clearTimeout(timer);
        off();
        resolve(message);
      });
    });
  }

  private spawn(): void {
    const child = utilityProcess.fork(join(__dirname, 'pipeline.js'), [], {
      serviceName: 'pipeline',
      stdio: 'pipe',
    });
    this.child = child;
    child.stdout?.on('data', (data: Buffer) => process.stdout.write(`[pipeline] ${data.toString()}`));
    child.stderr?.on('data', (data: Buffer) => process.stderr.write(`[pipeline] ${data.toString()}`));
    child.on('spawn', () => this.send({ type: 'ping', at: Date.now() }));
    child.on('message', (message: PipelineToMain) => this.handle(message));
    child.on('exit', (code) => {
      if (this.child === child) this.child = null;
      this.onAliveChanged(false);
      if (this.stopped) return;
      console.warn(`[pipeline] exited with code ${code}, restarting`);
      setTimeout(() => {
        if (!this.stopped) this.spawn();
      }, RESTART_DELAY_MS);
    });
  }

  private handle(message: PipelineToMain): void {
    switch (message.type) {
      case 'pong':
        this.lastPong = Date.now();
        this.onAliveChanged(true);
        break;
      case 'log':
        console[message.level](`[pipeline] ${message.message}`);
        break;
    }
    for (const listener of this.listeners) listener(message);
  }
}
