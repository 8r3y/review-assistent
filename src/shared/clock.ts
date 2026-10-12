/**
 * Session clock: one monotonic time base for every channel, recorder and marker.
 * Session time is milliseconds since session start; wall-clock is derived from it.
 */
export class SessionClock {
  private constructor(
    /** Epoch ms at session start. */
    readonly startedAtWall: number,
    /** Monotonic ms (performance.now) at session start. */
    private readonly startedAtMono: number,
    private readonly mono: () => number,
  ) {}

  static start(now: () => number = Date.now, mono: () => number = () => performance.now()): SessionClock {
    return new SessionClock(now(), mono(), mono);
  }

  /** Clock of a session started elsewhere (another process), given its wall-clock start. */
  static fromWallStart(startedAtWall: number): SessionClock {
    const mono = (): number => performance.timeOrigin + performance.now();
    return new SessionClock(startedAtWall, startedAtWall, mono);
  }

  /** Current session time, ms. */
  now(): number {
    return this.mono() - this.startedAtMono;
  }

  /** Session time → epoch ms. */
  toWall(sessionMs: number): number {
    return this.startedAtWall + sessionMs;
  }

  /** Session time → ISO string. */
  toIso(sessionMs: number): string {
    return new Date(this.toWall(sessionMs)).toISOString();
  }
}

/** Formats session ms as H:MM:SS or M:SS. */
export function formatSessionTime(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}
