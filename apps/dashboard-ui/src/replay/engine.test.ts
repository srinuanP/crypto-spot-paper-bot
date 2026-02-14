import { describe, expect, it } from 'vitest';
import { ReplayEngine } from './engine';
import type { DashboardEvent } from '../types/events';

function event(ts: number, id: string): DashboardEvent {
  return {
    id,
    ts,
    type: 'LOG_LINE',
    level: 'info',
    source: 'paper',
    message: id
  };
}

describe('ReplayEngine', () => {
  it('plays deterministically with tick', () => {
    const engine = new ReplayEngine([event(1000, 'a'), event(1500, 'b'), event(3000, 'c')]);
    engine.setSpeed(1);
    engine.play();

    const first = engine.tick(400);
    expect(first).toHaveLength(1);
    expect(first[0].id).toBe('a');

    const second = engine.tick(600);
    expect(second).toHaveLength(1);
    expect(second[0].id).toBe('b');

    const third = engine.tick(1500);
    expect(third).toHaveLength(1);
    expect(third[0].id).toBe('c');
  });

  it('supports pause, seek and step deterministically', () => {
    const engine = new ReplayEngine([event(1000, 'a'), event(1500, 'b'), event(3000, 'c')]);
    engine.pause();
    expect(engine.tick(1000)).toHaveLength(0);

    engine.seekToTime(1499);
    expect(engine.getState().currentIndex).toBe(1);

    const step = engine.stepForward();
    expect(step?.id).toBe('b');
    expect(engine.getState().currentIndex).toBe(2);

    const back = engine.stepBackward();
    expect(back?.id).toBe('b');
    expect(engine.getState().currentIndex).toBe(1);
  });
});
