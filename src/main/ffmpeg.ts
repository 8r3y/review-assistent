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
