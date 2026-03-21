import { InteractionManager, Platform } from 'react-native';

/**
 * Wait until after the current transition/animation (e.g. native Modal dismiss).
 * Use before showing a second modal/prompt on iOS to avoid nested-modal freezes.
 */
export async function deferForModalTransition(): Promise<void> {
  if (Platform.OS === 'web') return;
  await new Promise<void>((resolve) => {
    InteractionManager.runAfterInteractions(() => resolve());
  });
}
