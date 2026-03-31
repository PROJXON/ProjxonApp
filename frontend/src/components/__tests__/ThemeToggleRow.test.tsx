import { fireEvent, render } from '@testing-library/react-native';
import * as React from 'react';
import { Platform, Switch } from 'react-native';

import type { ThemeToggleRowStyles } from '../ThemeToggleRow';
import { ThemeToggleRow } from '../ThemeToggleRow';

jest.mock('@expo/vector-icons/Feather', () => {
  const React = require('react');
  const { Text } = require('react-native');

  return function MockFeather(props: { name?: unknown }) {
    return React.createElement(Text, { testID: 'feather-icon' }, String(props.name ?? ''));
  };
});

type PlatformOS = 'ios' | 'android' | 'web';

function withPlatformOS<T>(os: PlatformOS, run: () => T): T {
  const originalOS = Platform.OS;
  Object.defineProperty(Platform, 'OS', { value: os, configurable: true });

  try {
    return run();
  } finally {
    Object.defineProperty(Platform, 'OS', { value: originalOS, configurable: true });
  }
}

const styles: ThemeToggleRowStyles = {
  themeToggle: {},
  webToggleTrack: {},
  webToggleThumb: {},
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe('ThemeToggleRow (native branch)', () => {
  test('Android: renders Switch and maps value changes to onSetTheme', () => {
    withPlatformOS('android', () => {
      const onSetTheme = jest.fn();

      const screen = render(
        <ThemeToggleRow isDark={false} onSetTheme={onSetTheme} styles={styles} />,
      );

      const sw = screen.UNSAFE_getByType(Switch);
      sw.props.onValueChange(true);

      expect(onSetTheme).toHaveBeenCalledTimes(1);
      expect(onSetTheme).toHaveBeenCalledWith('dark');
    });
  });

  test('iOS: custom toggle press maps to onSetTheme', () => {
    withPlatformOS('ios', () => {
      const onSetTheme = jest.fn();

      const screen = render(
        <ThemeToggleRow isDark={false} onSetTheme={onSetTheme} styles={styles} />,
      );

      fireEvent.press(screen.getByLabelText('Toggle theme'));

      expect(onSetTheme).toHaveBeenCalledTimes(1);
      expect(onSetTheme).toHaveBeenCalledWith('dark');
    });
  });

  test('shows sun/moon icon based on isDark', () => {
    withPlatformOS('ios', () => {
      const screenLight = render(
        <ThemeToggleRow isDark={false} onSetTheme={() => {}} styles={styles} />,
      );
      expect(screenLight.getByTestId('feather-icon').props.children).toBe('sun');

      const screenDark = render(<ThemeToggleRow isDark onSetTheme={() => {}} styles={styles} />);
      expect(screenDark.getByTestId('feather-icon').props.children).toBe('moon');
    });
  });
});

describe('ThemeToggleRow (web branch)', () => {
  test('renders a button and toggles theme on press', () => {
    withPlatformOS('web', () => {
      const onSetTheme = jest.fn();

      const screen = render(
        <ThemeToggleRow isDark={false} onSetTheme={onSetTheme} styles={styles} />,
      );
      fireEvent.press(screen.getByLabelText('Toggle theme'));

      expect(onSetTheme).toHaveBeenCalledTimes(1);
      expect(onSetTheme).toHaveBeenCalledWith('dark');
    });
  });
});
