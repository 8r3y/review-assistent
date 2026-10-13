import { app } from 'electron';
import { createWriteStream, mkdirSync, rmSync, writeFileSync, type WriteStream } from 'node:fs';
import { join } from 'node:path';
import { SessionClock } from '@shared/clock';
import type { Segment, SpeakerId } from '@shared/transcript';
import { finalizeWebm, muxVideo } from './ffmpeg';

export interface SessionInfo {
  id: string;
  dir: string;
  clock: SessionClock;
}

/** One start–stop of the video recorder within a session. */
interface VideoRecording {
  /** Raw MediaRecorder output; replaced by `file` when the session stops. */
  raw: string;
  /** Final file name, set once the session stopped. */
  file: string | null;
  source: string;
  mimeType: string | null;
  /** Session ms when the recorder started and stopped. */
  startMs: number | null;
  endMs: number | null;
}

/** Owns the lifetime of a recording session: its folder, clock, transcript, audio and video files. */
export class SessionManager {
  private current: SessionInfo | null = null;
  private segments: Segment[] = [];
  private audio: WriteStream | null = null;
  /** Session ms at which audio.webm starts (the recorder starts after the session clock). */
  private audioOffsetMs: number | null = null;
  private videos: VideoRecording[] = [];
  /** Screenshot files with the session ms they were taken at. */
  private screenshots: { file: string; atMs: number }[] = [];
  private videoStream: WriteStream | null = null;

  /** Folder that holds all session folders (created on demand). */
  static rootDir(): string {
    const dir = join(app.getPath('userData'), 'sessions');
    mkdirSync(dir, { recursive: true });
    return dir;
  }

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
    const dir = join(SessionManager.rootDir(), id);
    mkdirSync(dir, { recursive: true });
    this.current = { id, dir, clock };
    this.segments = [];
    this.audioOffsetMs = null;
    this.videos = [];
    this.screenshots = [];
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

  /** @returns the file name in the session folder, or null without a session. */
  saveScreenshot(png: Buffer): string | null {
    if (!this.current) return null;
    const file = `screenshot-${String(this.screenshots.length + 1).padStart(2, '0')}.png`;
    writeFileSync(join(this.current.dir, file), png);
    this.screenshots.push({ file, atMs: this.current.clock.now() });
    this.writeMeta();
    return file;
  }

  /** Opens the next video file; chunks go to it until endVideo(). */
  beginVideo(source: string): void {
    if (!this.current || this.videoStream) return;
    const raw = `video-${String(this.videos.length + 1).padStart(2, '0')}.raw.webm`;
    this.videos.push({ raw, file: null, source, mimeType: null, startMs: null, endMs: null });
    this.videoStream = createWriteStream(join(this.current.dir, raw));
  }

  setVideoStarted(wallMs: number, mimeType: string): void {
    const video = this.videos.at(-1);
    if (!this.current || !video || !this.videoStream) return;
    video.startMs = wallMs - this.current.clock.startedAtWall;
    video.mimeType = mimeType;
    this.writeMeta();
  }

  appendVideo(chunk: ArrayBuffer): void {
    this.videoStream?.write(Buffer.from(chunk));
  }

  /** Closes the current video file; with `discard` (it never started) deletes it. */
  async endVideo(options: { discard?: boolean } = {}): Promise<void> {
    const stream = this.videoStream;
    if (!stream || !this.current) return;
    this.videoStream = null;
    await new Promise<void>((resolve) => stream.end(resolve));
    const video = this.videos.at(-1)!;
    if (options.discard || video.startMs === null) {
      rmSync(join(this.current.dir, video.raw), { force: true });
      this.videos.pop();
    } else {
      video.endMs = this.current.clock.now();
    }
    this.writeMeta();
  }

  /** @returns user-facing warnings for files that could not be finalized. */
  async stop(): Promise<string[]> {
    if (!this.current) return [];
    await this.endVideo();
    const audio = this.audio;
    this.audio = null;
    const warnings: string[] = [];
    let audioReady = false;
    if (audio) {
      await new Promise<void>((resolve) => audio.end(resolve));
      try {
        await finalizeWebm(join(this.current.dir, 'audio.webm'));
        audioReady = true;
      } catch (e) {
        warnings.push(`audio.webm не финализирован (нет длительности): ${errorText(e)}`);
      }
    }
    for (const video of this.videos) {
      const warning = await this.finalizeVideo(video, audioReady);
      if (warning) warnings.push(warning);
    }
    this.writeMeta(Date.now());
    this.current = null;
    return warnings;
  }

  /** Writes the playable file with the call audio; the raw recording is kept if that fails. */
  private async finalizeVideo(video: VideoRecording, audioReady: boolean): Promise<string | null> {
    const { dir } = this.current!;
    const raw = join(dir, video.raw);
    const audio = audioReady && this.audioOffsetMs !== null ? join(dir, 'audio.webm') : null;
    try {
      const out = await muxVideo({
        video: raw,
        h264: /h264|avc1/i.test(video.mimeType ?? ''),
        audio,
        audioOffsetSec: ((video.startMs ?? 0) - (this.audioOffsetMs ?? 0)) / 1000,
        outBase: join(dir, video.raw.replace(/\.raw\.webm$/, '')),
      });
      video.file = out.slice(dir.length + 1);
      rmSync(raw, { force: true });
      return null;
    } catch (e) {
      return `${video.raw} не собран: ${errorText(e)}`;
    }
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
      // Video time = session ms - startMs; the final files carry the call audio.
      videos: this.videos.map(({ raw, file, source, mimeType, startMs, endMs }) => ({
        file: file ?? raw,
        source,
        mimeType,
        startMs,
        endMs,
      })),
      screenshots: this.screenshots,
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

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
