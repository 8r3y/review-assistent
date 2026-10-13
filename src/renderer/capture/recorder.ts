const TIMESLICE_MS = 1000;

export interface ChunkedRecorder {
  /** Wall-clock ms when the recorder started. */
  startedAt: number;
  /** Stops recording; resolves once every chunk has been uploaded. */
  stop(): Promise<void>;
}

/**
 * Runs a MediaRecorder that hands a chunk to `upload` every second.
 * Uploads are chained so chunks reach main in order.
 */
export async function startChunkedRecorder(
  stream: MediaStream,
  options: MediaRecorderOptions,
  upload: (chunk: ArrayBuffer) => Promise<void>,
): Promise<ChunkedRecorder> {
  const recorder = new MediaRecorder(stream, options);
  let uploads = Promise.resolve();
  recorder.ondataavailable = (event) => {
    if (event.data.size === 0) return;
    uploads = uploads.then(async () => upload(await event.data.arrayBuffer()));
  };
  const done = new Promise<void>((resolve) => {
    recorder.onstop = () => void uploads.then(resolve);
  });
  const started = new Promise<number>((resolve, reject) => {
    recorder.onstart = () => resolve(Date.now());
    recorder.onerror = (event) => reject((event as ErrorEvent).error ?? new Error('MediaRecorder error'));
  });
  recorder.start(TIMESLICE_MS);
  return {
    startedAt: await started,
    stop: async () => {
      if (recorder.state !== 'inactive') recorder.stop();
      await done;
    },
  };
}
