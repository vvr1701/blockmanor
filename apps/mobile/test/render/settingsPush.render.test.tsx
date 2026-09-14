/**
 * §12.1 × §8.7 (§0 v1.32(a)): changing a notification preference re-registers
 * an opted-in device, so the server's scan honours the new choice.
 */
import TestRenderer, { act, type ReactTestRenderer } from 'react-test-renderer';
import { beforeEach, describe, expect, it } from 'vitest';
import { SettingsScreen } from '../../src/screens/SettingsScreen';
import en from '../../src/i18n/en.json';
import { useMetaStore } from '../../src/state/useMetaStore';
import { firebaseMock, resetFirebaseMock } from '../mocks/react-native-firebase';

const flush = () => new Promise((r) => setTimeout(r, 0));

function toggle(renderer: ReactTestRenderer, label: string, value: boolean): void {
  const row = renderer.root.findAll(
    (n) => n.props.label === label && typeof n.props.onValueChange === 'function',
  )[0];
  expect(row, `no toggle "${label}"`).toBeDefined();
  act(() => {
    (row!.props.onValueChange as (v: boolean) => void)(value);
  });
}

beforeEach(() => {
  resetFirebaseMock();
  firebaseMock.configured = true;
  firebaseMock.callables['registerPush'] = () => ({ ok: true });
  act(() => {
    useMetaStore.setState({
      pushOptIn: 'granted',
      notificationPrefs: { dailyDrop: true, streakRisk: true },
    });
  });
});

describe('SettingsScreen notification toggles', () => {
  it('re-register an opted-in device with the new preferences', async () => {
    let r!: ReactTestRenderer;
    act(() => {
      r = TestRenderer.create(<SettingsScreen onExit={() => undefined} />);
    });
    toggle(r, en['settings.notifications.dailyDrop'], false);
    await flush();
    expect(firebaseMock.calls.at(-1)).toMatchObject({
      name: 'registerPush',
      data: { dailyDrop: false, streakRisk: true },
    });
    toggle(r, en['settings.notifications.streakRisk'], false);
    await flush();
    expect(firebaseMock.calls.at(-1)?.data).toMatchObject({ dailyDrop: false, streakRisk: false });
  });

  it('a player who never opted in registers nothing', async () => {
    act(() => {
      useMetaStore.setState({ pushOptIn: 'declined' });
    });
    let r!: ReactTestRenderer;
    act(() => {
      r = TestRenderer.create(<SettingsScreen onExit={() => undefined} />);
    });
    toggle(r, en['settings.notifications.dailyDrop'], false);
    await flush();
    expect(firebaseMock.calls).toHaveLength(0);
    expect(useMetaStore.getState().notificationPrefs.dailyDrop).toBe(false);
  });
});
