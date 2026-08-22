export const CLOUD_TOP_TIME_ZONE = "America/Mexico_City";
export const CLOUD_TOP_WINDOW_HOURS = 6;
export const CLOUD_TOP_FRAME_DURATION_MS = 2000;
export const CLOUD_TOP_LAST_FRAME_HOLD_MS = 2000;
export const CLOUD_TOP_STALE_THRESHOLD_MS = 2 * 60 * 60 * 1000;

export const CLOUD_TOP_SPEEDS = {
  slow: 2500,
  normal: CLOUD_TOP_FRAME_DURATION_MS,
  fast: 1500,
};

export function normalizeCloudTopFrames(frames, options = {}) {
  const now = new Date(options.now || Date.now());
  const windowMs = Number(options.windowHours || CLOUD_TOP_WINDOW_HOURS) * 60 * 60 * 1000;
  const cutoff = new Date(now.getTime() - windowMs);
  const byTimestamp = new Map();

  (Array.isArray(frames) ? frames : []).forEach((frame) => {
    const timestamp = parseFrameTimestamp(frame?.timestamp);
    if (!timestamp || timestamp < cutoff || timestamp > new Date(now.getTime() + 10 * 60 * 1000)) return;
    const key = timestamp.toISOString();
    if (!byTimestamp.has(key)) {
      byTimestamp.set(key, {
        ...frame,
        id: frame?.id || key,
        timestamp: key,
      });
    }
  });

  return [...byTimestamp.values()].sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
}

export function parseFrameTimestamp(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function detectTemporalGaps(frames, expectedIntervalMs) {
  if (!Array.isArray(frames) || frames.length < 2 || !Number.isFinite(expectedIntervalMs)) return [];
  const gaps = [];
  for (let index = 1; index < frames.length; index += 1) {
    const previous = Date.parse(frames[index - 1].timestamp);
    const current = Date.parse(frames[index].timestamp);
    const delta = current - previous;
    if (Number.isFinite(delta) && delta > expectedIntervalMs * 1.5) {
      gaps.push({
        from: frames[index - 1].timestamp,
        to: frames[index].timestamp,
        minutes: Math.round(delta / 60000),
      });
    }
  }
  return gaps;
}

export function getFrameAgeStatus(timestamp, options = {}) {
  const date = parseFrameTimestamp(timestamp);
  if (!date) return { isStale: true, ageMs: Infinity, label: "Sin fecha valida" };
  const now = new Date(options.now || Date.now());
  const thresholdMs = Number(options.thresholdMs || CLOUD_TOP_STALE_THRESHOLD_MS);
  const ageMs = Math.max(0, now.getTime() - date.getTime());
  return {
    isStale: ageMs > thresholdMs,
    ageMs,
    label: formatAge(ageMs),
  };
}

export function formatFrameTime(timestamp, options = {}) {
  const date = parseFrameTimestamp(timestamp);
  if (!date) return "Hora no disponible";
  const formatter = new Intl.DateTimeFormat("es-MX", {
    timeZone: options.timeZone || CLOUD_TOP_TIME_ZONE,
    day: options.includeDate === false ? undefined : "2-digit",
    month: options.includeDate === false ? undefined : "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  return formatter.format(date).replace(".", "");
}

export function formatAge(ageMs) {
  if (!Number.isFinite(ageMs)) return "sin dato reciente";
  const minutes = Math.round(ageMs / 60000);
  if (minutes < 1) return "hace menos de 1 min";
  if (minutes < 60) return `hace ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `hace ${hours} h ${rest} min` : `hace ${hours} h`;
}

export function shouldAutoPlay(options = {}) {
  return Boolean(options.frameCount >= 2 && options.visible !== false);
}

export function mergeCloudTopFrames(currentFrames, incomingFrames, options = {}) {
  return normalizeCloudTopFrames([...(currentFrames || []), ...(incomingFrames || [])], options);
}

export class CloudTopPlaybackController {
  constructor(options = {}) {
    this.frameDurationMs = Number(options.frameDurationMs || CLOUD_TOP_FRAME_DURATION_MS);
    this.lastFrameHoldMs = Number(options.lastFrameHoldMs || CLOUD_TOP_LAST_FRAME_HOLD_MS);
    this.setTimeoutFn = options.setTimeoutFn || globalThis.setTimeout?.bind(globalThis);
    this.clearTimeoutFn = options.clearTimeoutFn || globalThis.clearTimeout?.bind(globalThis);
    this.onFrameChange = options.onFrameChange || (() => {});
    this.onStateChange = options.onStateChange || (() => {});
    this.frames = [];
    this.index = 0;
    this.playing = false;
    this.visible = true;
    this.timer = null;
  }

  setFrames(frames, options = {}) {
    const previousTimestamp = this.currentFrame()?.timestamp;
    this.frames = Array.isArray(frames) ? frames : [];
    if (!this.frames.length) {
      this.index = 0;
      this.pause();
      this.emit();
      return;
    }
    const preservedIndex = previousTimestamp
      ? this.frames.findIndex((frame) => frame.timestamp === previousTimestamp)
      : -1;
    this.index = preservedIndex >= 0 ? preservedIndex : clampIndex(options.index ?? this.frames.length - 1, this.frames.length);
    this.emit();
    if (options.autoplay) this.play();
  }

  currentFrame() {
    return this.frames[this.index] || null;
  }

  play() {
    if (this.frames.length < 2 || this.playing || !this.visible) return;
    this.playing = true;
    this.onStateChange(this.getState());
    this.schedule();
  }

  pause() {
    if (this.timer) {
      this.clearTimeoutFn?.(this.timer);
      this.timer = null;
    }
    if (!this.playing) return;
    this.playing = false;
    this.onStateChange(this.getState());
  }

  toggle() {
    if (this.playing) this.pause();
    else this.play();
  }

  next(options = {}) {
    if (!this.frames.length) return null;
    this.index = (this.index + 1) % this.frames.length;
    this.emit();
    if (options.reschedule !== false && this.playing) this.schedule();
    return this.currentFrame();
  }

  previous() {
    if (!this.frames.length) return null;
    this.index = (this.index - 1 + this.frames.length) % this.frames.length;
    this.emit();
    if (this.playing) this.schedule();
    return this.currentFrame();
  }

  goTo(index) {
    if (!this.frames.length) return null;
    this.index = clampIndex(index, this.frames.length);
    this.emit();
    if (this.playing) this.schedule();
    return this.currentFrame();
  }

  setVisible(visible) {
    this.visible = Boolean(visible);
    if (!this.visible) this.pause();
    this.onStateChange(this.getState());
  }

  setSpeed(durationMs) {
    if (!Number.isFinite(Number(durationMs)) || Number(durationMs) <= 0) return;
    this.frameDurationMs = Number(durationMs);
    if (this.playing) this.schedule();
  }

  schedule() {
    if (!this.playing || !this.visible || this.frames.length < 2 || !this.setTimeoutFn) return;
    if (this.timer) this.clearTimeoutFn?.(this.timer);
    const delay = this.index === this.frames.length - 1 ? this.lastFrameHoldMs : this.frameDurationMs;
    this.timer = this.setTimeoutFn(() => {
      this.timer = null;
      this.next({ reschedule: false });
      this.schedule();
    }, delay);
  }

  destroy() {
    this.pause();
    this.frames = [];
  }

  emit() {
    this.onFrameChange(this.currentFrame(), this.getState());
  }

  getState() {
    return {
      frameCount: this.frames.length,
      index: this.index,
      playing: this.playing,
      visible: this.visible,
      currentFrame: this.currentFrame(),
    };
  }
}

function clampIndex(index, length) {
  if (!length) return 0;
  const numeric = Number(index);
  if (!Number.isFinite(numeric)) return 0;
  return Math.min(length - 1, Math.max(0, Math.round(numeric)));
}
