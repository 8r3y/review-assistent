import type { VideoStartOptions } from '@shared/ipc';
import { startChunkedRecorder, type ChunkedRecorder } from './recorder';

/** Preferred first: H.264 is usually hardware-encoded and remuxes into MP4 without re-encoding. */
const MIME_TYPES = ['video/webm;codecs=h264', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];

/**
 * Records a screen or window to WebM. Main's display-media handler decides the source:
 * a video-only getDisplayMedia request gets the source picked in the control panel.
 * In portal mode it records a copy of the session's stream, which stays open after the recording.
 */
export class VideoCapture {
  private stream: MediaStream | null = null;
  private recorder: ChunkedRecorder | null = null;

  /** @param onEnded the source went away (window closed, display unplugged). */
  constructor(private readonly onEnded: () => void) {}

  /** @param source the session's stream track (portal mode). */
  async start(
    options: VideoStartOptions,
    source: MediaStreamTrack | null,
  ): Promise<{ startedAt: number; mimeType: string }> {
    const mimeType = MIME_TYPES.find((type) => MediaRecorder.isTypeSupported(type));
    if (!mimeType) throw new Error('Запись видео не поддерживается');
    const stream = source
      ? new MediaStream([source.clone()])
      : await navigator.mediaDevices.getDisplayMedia({
          audio: false,
          video: {
            width: { max: options.maxWidth },
            height: { max: options.maxHeight },
            frameRate: { max: options.maxFrameRate },
          },
        });
    this.stream = stream;
    const track = stream.getVideoTracks()[0];
    if (!track) throw new Error('Источник видео недоступен');
    // Screen text matters more than motion: keep resolution, drop frames under load.
    track.contentHint = 'detail';
    track.onended = () => this.onEnded();
    this.recorder = await startChunkedRecorder(
      stream,
      { mimeType, videoBitsPerSecond: options.bitrate },
      (chunk) => window.api.invoke('capture:video-chunk', chunk),
    );
    return { startedAt: this.recorder.startedAt, mimeType };
  }

  async stop(): Promise<void> {
    if (this.stream) for (const track of this.stream.getTracks()) track.onended = null;
    await this.recorder?.stop();
    this.recorder = null;
    for (const track of this.stream?.getTracks() ?? []) track.stop();
    this.stream = null;
  }
}
