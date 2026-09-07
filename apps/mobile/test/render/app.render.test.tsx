/**
 * `App` returning-user skip — PRD §7.1 (v1.11): "returning users (existing
 * cloud/local save) bypass all FTUE." `ftueComplete` is the persisted flag;
 * `currentLevel > 1` additionally covers a save that predates the flag.
 */
import React from 'react';
import TestRenderer, { act, type ReactTestRenderer } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/services/analytics', () => ({ track: vi.fn() }));

import App from '../../src/App';
import { FtueScreen } from '../../src/screens/FtueScreen';
import { HomeScreen } from '../../src/screens/HomeScreen';
import { LevelMapScreen } from '../../src/screens/LevelMapScreen';
import { LevelSession } from '../../src/game/LevelSession';
import { useMetaStore } from '../../src/state/useMetaStore';

function render(el: React.ReactElement): ReactTestRenderer {
  let renderer!: ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(el);
  });
  return renderer;
}

beforeEach(() => {
  useMetaStore.setState({
    currentLevel: 1,
    ftueComplete: false,
    playerName: null,
    avatarId: null,
    attempts: {},
    stars: {},
    chestsClaimed: {},
    ownedFrames: [],
  });
});

describe('App returning-user skip (PRD §7.1 v1.11)', () => {
  it('a fresh install (currentLevel:1, ftueComplete:false) boots into FtueScreen', () => {
    const renderer = render(<App />);
    expect(renderer.root.findAllByType(FtueScreen).length).toBe(1);
    expect(renderer.root.findAllByType(HomeScreen).length).toBe(0);
  });

  it('ftueComplete:true bypasses FTUE straight to HomeScreen', () => {
    useMetaStore.setState({ ftueComplete: true });
    const renderer = render(<App />);
    expect(renderer.root.findAllByType(HomeScreen).length).toBe(1);
    expect(renderer.root.findAllByType(FtueScreen).length).toBe(0);
  });

  it('a pre-flag save (currentLevel > 1, ftueComplete still false) also bypasses FTUE', () => {
    useMetaStore.setState({ currentLevel: 12 });
    const renderer = render(<App />);
    expect(renderer.root.findAllByType(HomeScreen).length).toBe(1);
    expect(renderer.root.findAllByType(FtueScreen).length).toBe(0);
  });
});

describe('§7.10 level-map route', () => {
  it('§7.5s "Level map" ghost leaves the run and mounts `LevelMapScreen`; its Play CTA goes back into a run', () => {
    useMetaStore.setState({ ftueComplete: true, currentLevel: 12 });
    const renderer = render(<App />);

    act(() => {
      (renderer.root.findByType(HomeScreen).props as { onPlay: () => void }).onPlay();
    });
    expect(renderer.root.findAllByType(LevelSession).length).toBe(1);

    act(() => {
      (renderer.root.findByType(LevelSession).props as { onLevelMap: () => void }).onLevelMap();
    });
    expect(renderer.root.findAllByType(LevelSession).length).toBe(0);
    expect(renderer.root.findAllByType(LevelMapScreen).length).toBe(1);
    expect(renderer.root.findAllByType(HomeScreen).length).toBe(0);

    act(() => {
      (renderer.root.findByType(LevelMapScreen).props as { onPlay: () => void }).onPlay();
    });
    expect(renderer.root.findAllByType(LevelSession).length).toBe(1);
    expect(renderer.root.findAllByType(LevelMapScreen).length).toBe(0);
  });

  it('the map exits to Home (§12.9 — never a dead end)', () => {
    useMetaStore.setState({ ftueComplete: true, currentLevel: 12 });
    const renderer = render(<App />);
    act(() => {
      (renderer.root.findByType(HomeScreen).props as { onPlay: () => void }).onPlay();
    });
    act(() => {
      (renderer.root.findByType(LevelSession).props as { onLevelMap: () => void }).onLevelMap();
    });
    act(() => {
      (renderer.root.findByType(LevelMapScreen).props as { onExit: () => void }).onExit();
    });
    expect(renderer.root.findAllByType(HomeScreen).length).toBe(1);
  });
});
