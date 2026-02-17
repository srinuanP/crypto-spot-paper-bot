import type { DashboardEvent } from '../types/events';

export type ReplayEngineState = {
  currentIndex: number;
  currentTime: number;
  isPlaying: boolean;
  speed: number;
  total: number;
};

function sortEvents(events: DashboardEvent[]): DashboardEvent[] {
  return [...events].sort((a, b) => {
    if (a.ts !== b.ts) return a.ts - b.ts;
    return a.id.localeCompare(b.id);
  });
}

function upperBoundByTime(events: DashboardEvent[], ts: number): number {
  let lo = 0;
  let hi = events.length;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (events[mid].ts <= ts) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export class ReplayEngine {
  private events: DashboardEvent[] = [];
  private currentIndex = 0;
  private currentTime = 0;
  private isPlaying = false;
  private speed = 1;

  constructor(events: DashboardEvent[] = []) {
    this.setEvents(events);
  }

  setEvents(events: DashboardEvent[]): void {
    this.events = sortEvents(events);
    this.currentIndex = 0;
    this.currentTime = this.events.length > 0 ? this.events[0].ts : 0;
    this.isPlaying = false;
    this.speed = 1;
  }

  setSpeed(speed: number): void {
    if (!Number.isFinite(speed) || speed <= 0) return;
    this.speed = speed;
  }

  play(): void {
    this.isPlaying = true;
  }

  pause(): void {
    this.isPlaying = false;
  }

  seekToTime(ts: number): void {
    this.currentTime = ts;
    this.currentIndex = upperBoundByTime(this.events, ts);
  }

  jumpToIndex(index: number): void {
    const safeIndex = Math.max(0, Math.min(this.events.length, Math.floor(index)));
    this.currentIndex = safeIndex;
    if (safeIndex <= 0) {
      this.currentTime = this.events[0]?.ts ?? 0;
      return;
    }
    this.currentTime = this.events[safeIndex - 1]?.ts ?? this.currentTime;
  }

  tick(deltaMs: number): DashboardEvent[] {
    if (!this.isPlaying || this.events.length === 0) return [];
    const safeDelta = Math.max(0, deltaMs);
    this.currentTime += safeDelta * this.speed;

    const emitted: DashboardEvent[] = [];
    while (this.currentIndex < this.events.length && this.events[this.currentIndex].ts <= this.currentTime) {
      emitted.push(this.events[this.currentIndex]);
      this.currentIndex += 1;
    }
    return emitted;
  }

  stepForward(): DashboardEvent | null {
    if (this.currentIndex >= this.events.length) return null;
    const event = this.events[this.currentIndex];
    this.currentIndex += 1;
    this.currentTime = event.ts;
    return event;
  }

  stepBackward(): DashboardEvent | null {
    if (this.events.length === 0) return null;
    if (this.currentIndex <= 0) {
      this.currentIndex = 0;
      this.currentTime = this.events[0].ts;
      return this.events[0];
    }

    const removedIndex = this.currentIndex - 1;
    this.currentIndex = removedIndex;
    this.currentTime = this.currentIndex > 0
      ? this.events[this.currentIndex - 1].ts
      : this.events[0].ts;
    return this.events[removedIndex] ?? null;
  }

  getState(): ReplayEngineState {
    return {
      currentIndex: this.currentIndex,
      currentTime: this.currentTime,
      isPlaying: this.isPlaying,
      speed: this.speed,
      total: this.events.length
    };
  }
}
