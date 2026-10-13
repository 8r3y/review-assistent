import { spawn } from 'node:child_process';
import { renameSync, rmSync } from 'node:fs';
import ffmpegStatic from 'ffmpeg-static';

/** ffmpeg binary path; inside a packaged app it lives in app.asar.unpacked. */
function ffmpegPath(): string {
  if (!ffmpegStatic) throw new Error('ffmpeg binary is not available for this platform');
  return ffmpegStatic.replace('app.asar', 'app.asar.unpacked');
}

function run(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath(), ['-hide_banner', '-loglevel', 'error', '-y', ...args], {
      windowsHide: true,
    });
    let stderr = '';
    child.stderr.on('data', (d: Buffer) => (stderr += d.toString()));
    child.on('error', reject);
    child.on('close', (code) =>
      code === 0 ? resolve() : reject(new Error(`ffmpeg exited with ${code}: ${stderr.trim()}`)),
    );
  });
}

/**
 * MediaRecorder writes WebM without duration and cues (the file is not seekable).
 * A stream-copy remux writes both; the file is replaced in place.
 */
export async function finalizeWebm(file: string): Promise<void> {
  const tmp = file.replace(/\.webm$/, '.finalizing.webm');
  try {
    await run(['-i', file, '-c', 'copy', tmp]);
    renameSync(tmp, file);
  } finally {
    rmSync(tmp, { force: true });
  }
}

export interface VideoMuxJob {
  /** Raw MediaRecorder WebM. */
  video: string;
  /** H.264 can be copied into MP4; VP8/VP9 stay in WebM. */
  h264: boolean;
  /** Finalized audio.webm (L = mic, R = system), or null to keep the video silent. */
  audio: string | null;
  /** Seconds into audio.webm where the video starts; negative when the audio started later. */
  audioOffsetSec: number;
  /** Output path without extension. */
  outBase: string;
}

/**
 * Turns a raw video recording into a playable file with the call audio mixed in.
 * The video stream is copied, never re-encoded. Mic and system audio are mixed into both ears.
 * @returns the written file path.
 */
export async function muxVideo(job: VideoMuxJob): Promise<string> {
  const out = `${job.outBase}.${job.h264 ? 'mp4' : 'webm'}`;
  const args = ['-i', job.video];
  if (job.audio) {
    const offset = job.audioOffsetSec.toFixed(3);
    // -ss before an input seeks it; -itsoffset delays it when the audio started after the video.
    if (job.audioOffsetSec >= 0) args.push('-ss', offset, '-i', job.audio);
    else args.push('-itsoffset', (-job.audioOffsetSec).toFixed(3), '-i', job.audio);
    args.push(
      '-map',
      '0:v:0',
      '-map',
      '1:a:0',
      '-af',
      'pan=stereo|c0<c0+c1|c1<c0+c1',
      '-c:a',
      job.h264 ? 'aac' : 'libopus',
      '-b:a',
      '160k',
      '-shortest',
    );
  }
  args.push('-c:v', 'copy');
  if (job.h264) args.push('-movflags', '+faststart');
  args.push(out);
  await run(args);
  return out;
}
