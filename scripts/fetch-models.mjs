// Downloads ONNX models into resources/models (not stored in git). Skips files that already exist.
import { createWriteStream, existsSync, mkdirSync, renameSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const MODELS = [
  {
    file: 'silero_vad.onnx',
    url: 'https://raw.githubusercontent.com/snakers4/silero-vad/master/src/silero_vad/data/silero_vad.onnx',
  },
  {
    // 3D-Speaker ERes2Net (Apache-2.0), speaker embeddings for local diarization.
    file: 'speaker_eres2net_base_16k.onnx',
    url: 'https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-recongition-models/3dspeaker_speech_eres2net_base_sv_zh-cn_3dspeaker_16k.onnx',
  },
];

const dir = resolve(import.meta.dirname, '..', 'resources', 'models');
mkdirSync(dir, { recursive: true });

let failed = false;
for (const { file, url } of MODELS) {
  const target = join(dir, file);
  if (existsSync(target)) continue;
  const tmp = `${target}.download`;
  try {
    const res = await fetch(url);
    if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
    await pipeline(Readable.fromWeb(res.body), createWriteStream(tmp));
    renameSync(tmp, target);
    console.log(`downloaded ${file}`);
  } catch (e) {
    rmSync(tmp, { force: true });
    console.error(`failed to download ${file}: ${e instanceof Error ? e.message : e}`);
    failed = true;
  }
}
if (failed) process.exitCode = 1;
