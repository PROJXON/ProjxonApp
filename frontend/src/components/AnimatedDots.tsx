import * as React from 'react';
import { Animated, Easing, View } from 'react-native';

export function AnimatedDots({
  color,
  size = 18,
  dot = '.',
  staggerMs = 130,
  holdMs = 450,
}: {
  color: string;
  size?: number;
  dot?: string;
  staggerMs?: number;
  holdMs?: number;
}): React.JSX.Element {
  /**
   * IMPORTANT:
   * We intentionally avoid `Animated.stagger/sequence/delay` here because those often rely on JS-side
   * scheduling even with `useNativeDriver: true`, which can "freeze" when the JS thread is busy doing
   * crypto work. A single continuously-running native-driver animation + interpolations stays smooth.
   */
  const progress = React.useRef(new Animated.Value(0)).current;

  React.useEffect(() => {
    // Reset before each start so hot reloads don't "jump" mid-cycle.
    progress.setValue(0);
    const phaseMs = 500; // 250 in + 250 out
    const activeMs = phaseMs + 2 * staggerMs;
    const totalMs = activeMs + holdMs;

    const loop = Animated.loop(
      Animated.timing(progress, {
        toValue: 1,
        duration: totalMs,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
      { resetBeforeIteration: true }
    );

    loop.start();
    return () => {
      loop.stop();
    };
  }, [progress, staggerMs, holdMs]);

  const baseOpacity = 0.25;
  const phaseMs = 500;
  const activeMs = phaseMs + 2 * staggerMs;
  const totalMs = activeMs + holdMs;

  const makeOpacity = (offsetMs: number) => {
    const start = offsetMs / totalMs;
    const mid = (offsetMs + phaseMs / 2) / totalMs;
    const end = (offsetMs + phaseMs) / totalMs;
    return progress.interpolate({
      inputRange: [0, start, mid, end, 1],
      outputRange: [baseOpacity, baseOpacity, 1, baseOpacity, baseOpacity],
      extrapolate: 'clamp',
    });
  };

  return (
    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
      <Animated.Text
        style={[
          { color, fontSize: size, fontWeight: '900', lineHeight: size },
          { opacity: makeOpacity(0) },
        ]}
      >
        {dot}
      </Animated.Text>
      <Animated.Text
        style={[
          { color, fontSize: size, fontWeight: '900', lineHeight: size },
          { opacity: makeOpacity(staggerMs) },
        ]}
      >
        {dot}
      </Animated.Text>
      <Animated.Text
        style={[
          { color, fontSize: size, fontWeight: '900', lineHeight: size },
          { opacity: makeOpacity(2 * staggerMs) },
        ]}
      >
        {dot}
      </Animated.Text>
    </View>
  );
}


