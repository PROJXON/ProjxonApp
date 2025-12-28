import * as React from 'react';
import { Animated, View } from 'react-native';

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
  const dot1 = React.useRef(new Animated.Value(0)).current;
  const dot2 = React.useRef(new Animated.Value(0)).current;
  const dot3 = React.useRef(new Animated.Value(0)).current;

  React.useEffect(() => {
    const makeDotAnim = (v: Animated.Value) =>
      Animated.sequence([
        Animated.timing(v, {
          toValue: 1,
          duration: 250,
          useNativeDriver: true,
        }),
        Animated.timing(v, {
          toValue: 0,
          duration: 250,
          useNativeDriver: true,
        }),
      ]);

    const loop = Animated.loop(
      Animated.sequence([
        Animated.stagger(staggerMs, [makeDotAnim(dot1), makeDotAnim(dot2), makeDotAnim(dot3)]),
        Animated.delay(holdMs),
      ])
    );

    loop.start();
    return () => loop.stop();
  }, [dot1, dot2, dot3, staggerMs, holdMs]);

  const dotStyle = (v: Animated.Value) => ({
    opacity: v.interpolate({ inputRange: [0, 1], outputRange: [0.25, 1] }),
  });

  return (
    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
      <Animated.Text style={[{ color, fontSize: size, fontWeight: '900', lineHeight: size }, dotStyle(dot1)]}>
        {dot}
      </Animated.Text>
      <Animated.Text style={[{ color, fontSize: size, fontWeight: '900', lineHeight: size }, dotStyle(dot2)]}>
        {dot}
      </Animated.Text>
      <Animated.Text style={[{ color, fontSize: size, fontWeight: '900', lineHeight: size }, dotStyle(dot3)]}>
        {dot}
      </Animated.Text>
    </View>
  );
}


