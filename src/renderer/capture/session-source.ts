import type { VideoStartOptions } from '@shared/ipc';

/**
 * Portal mode (Wayland): a screen or window stream kept open for the whole session.
 * Every new capture opens the portal dialog, so the source is picked once and both screenshots and
 * video recordings read from this stream.
 */
export class SessionSource {
  private stream: MediaStream | null = null;
  private opening: Promise<MediaStreamTrack> | null = null;

  /** The live track; opens the portal dialog when there is none. */
  track(options: VideoStartOptions): Promise<MediaStreamTrack> {
    const live = this.stream?.getVideoTracks()[0];
    if (live?.readyState === 'live') return Promise.resolve(live);
    this.opening ??= this.open(options).finally(() => (this.opening = null));
    return this.opening;
  }

  /** Drops the current stream and asks for a source again. */
  async reopen(options: VideoStartOptions): Promise<void> {
    this.close();
    await this.track(options);
  }

  /** A PNG frame scaled down to fit `maxSize`, base64-encoded. */
  async screenshot(options: VideoStartOptions, maxSize: { width: number; height: number }): Promise<string> {
    const track = await this.track(options);
    const frame = await new ImageCapture(track).grabFrame();
    const scale = Math.min(1, maxSize.width / frame.width, maxSize.height / frame.height);
    const canvas = new OffscreenCanvas(Math.round(frame.width * scale), Math.round(frame.height * scale));
    canvas.getContext('2d')?.drawImage(frame, 0, 0, canvas.width, canvas.height);
    frame.close();
    const bytes = new Uint8Array(await (await canvas.convertToBlob({ type: 'image/png' })).arrayBuffer());
    let binary = '';
    for (let i = 0; i < bytes.length; i += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    }
    return btoa(binary);
  }

  close(): void {
    for (const track of this.stream?.getTracks() ?? []) track.stop();
    this.stream = null;
  }

  private async open(options: VideoStartOptions): Promise<MediaStreamTrack> {
    const stream = await navigator.mediaDevices.getDisplayMedia({
      audio: false,
      video: {
        width: { max: options.maxWidth },
        height: { max: options.maxHeight },
        frameRate: { max: options.maxFrameRate },
      },
    });
    const track = stream.getVideoTracks()[0];
    if (!track) {
      for (const t of stream.getTracks()) t.stop();
      throw new Error('Источник видео недоступен');
    }
    // Screen text matters more than motion: keep resolution, drop frames under load.
    track.contentHint = 'detail';
    this.stream = stream;
    return track;
  }
}
