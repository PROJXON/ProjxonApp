import * as React from 'react';
import { Animated, Keyboard, Platform } from 'react-native';

export function useMessageActionMenu<TTarget = unknown>() {
  const [open, setOpen] = React.useState(false);
  const [target, setTarget] = React.useState<TTarget | null>(null);
  const [anchor, setAnchor] = React.useState<{ x: number; y: number } | null>(null);

  const anim = React.useRef(new Animated.Value(0)).current;

  const measuredHRef = React.useRef<number>(0);
  const [measuredH, setMeasuredH] = React.useState<number>(0);

  const openMenu = React.useCallback(
    (msg: TTarget, nextAnchor?: { x: number; y: number }) => {
      if (!msg) return;
      // iOS often keeps the IME up on long-press, which clips the anchored menu; Android/web
      // behave fine without forcing dismiss.
      if (Platform.OS === 'ios') Keyboard.dismiss();
      setTarget(msg);
      if (nextAnchor && Number.isFinite(nextAnchor.x) && Number.isFinite(nextAnchor.y))
        setAnchor(nextAnchor);
      else setAnchor(null);
      setOpen(true);
      anim.setValue(0);
      Animated.spring(anim, {
        toValue: 1,
        useNativeDriver: Platform.OS !== 'web',
        friction: 9,
        tension: 90,
      }).start();
    },
    [anim],
  );

  const closeMenu = React.useCallback(() => {
    setOpen(false);
    setTarget(null);
    setAnchor(null);
  }, []);

  const onMeasuredH = React.useCallback((h: number) => {
    measuredHRef.current = h;
    setMeasuredH((prev) => (Math.abs(prev - h) > 1 ? h : prev));
  }, []);

  return {
    open,
    target,
    anchor,
    anim,
    measuredH,
    measuredHRef,
    openMenu,
    closeMenu,
    onMeasuredH,
  };
}
