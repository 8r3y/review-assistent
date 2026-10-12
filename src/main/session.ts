import { app } from 'electron';
import { createWriteStream, mkdirSync, writeFileSync, type WriteStream } from 'node:fs';
import { join } from 'node:path';
import { SessionClock } from '@shared/clock';
import type { Segment, SpeakerId } from '@shared/transcript';
import { finalizeWebm } from './ffmpeg';

export interface SessionInfo {
  id: string;
  dir: string;
  clock: SessionClock;
}

/** Owns the lifetime of a recording session: its folder, clock, transcript and audio file. */
export class SessionManager {
  private current: SessionInfo | null = null;
  private segments: Segment[] = [];
  private audio: WriteStream | null = null;
  /** Session ms at which audio.webm starts (the recorder starts after the session clock). */
  private audioOffsetMs: number | null = null;

  get info(): SessionInfo | null {
    return this.current;
  }

  get transcript(): Segment[] {
    return this.segments;
  }

  start(options: { recordAudio: boolean }): SessionInfo {
    if (this.current) return this.current;
    const clock = SessionClock.start();
    const id = sessionId(new Date(clock.startedAtWall));
    const dir = join(app.getPath('userData'), 'sessions', id);
    mkdirSync(dir, { recursive: true });
    this.current = { id, dir, clock };
    this.segments = [];
    this.audioOffsetMs = null;
    this.audio = options.recordAudio ? createWriteStream(join(dir, 'audio.webm')) : null;
    this.writeMeta();
    return this.current;
  }

  addSegment(segment: Segment): void {
    this.segments.push(segment);
  }

  retractSegment(id: string): void {
    this.segments = this.segments.filter((s) => s.id !== id);
  }

  relabelSegment(id: string, speaker: SpeakerId): void {
    this.segments = this.segments.map((s) => (s.id === id ? { ...s, speaker } : s));
  }

  setRecordingStartedAt(wallMs: number): void {
    if (!this.current) return;
    this.audioOffsetMs = wallMs - this.current.clock.startedAtWall;
    this.writeMeta();
  }

  appendAudio(chunk: ArrayBuffer): void {
    this.audio?.write(Buffer.from(chunk));
  }

  /** @returns a user-facing warning if the audio file could not be finalized. */
  async stop(): Promise<string | null> {
    if (!this.current) return null;
    const audio = this.audio;
    this.audio = null;
    let warning: string | null = null;
    if (audio) {
      await new Promise<void>((resolve) => audio.end(resolve));
      try {
        await finalizeWebm(join(this.current.dir, 'audio.webm'));
      } catch (e) {
        warning = `audio.webm не финализирован (нет длительности): ${e instanceof Error ? e.message : e}`;
      }
    }
    this.writeMeta(Date.now());
    this.current = null;
    return warning;
  }

  private writeMeta(endedAt?: number): void {
    if (!this.current) return;
    const { id, dir, clock } = this.current;
    const meta = {
      id,
      startedAt: new Date(clock.startedAtWall).toISOString(),
      endedAt: endedAt ? new Date(endedAt).toISOString() : null,
      // Transcript times are session ms; audio.webm time = session ms - audioOffsetMs.
      audioOffsetMs: this.audioOffsetMs,
      files: { transcript: 'transcript.jsonl', audio: 'audio.webm (L = mic, R = system)' },
    };
    writeFileSync(join(dir, 'session.json'), JSON.stringify(meta, null, 2));
  }
}

function sessionId(date: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0');
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_` +
    `${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`
  );
}
