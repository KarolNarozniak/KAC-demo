import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, Platform, View } from 'react-native';

type Props = { screenIndex: number; renderScreen: (index: number, active: boolean) => React.ReactNode };

export default function ScreenTransition({ screenIndex, renderScreen }: Props) {
  const previousIndex = useRef(screenIndex);
  const visited = useRef(new Set([screenIndex]));
  visited.current.add(screenIndex);
  const progress = useRef(new Animated.Value(1)).current;
  const [width, setWidth] = useState(0);
  const [outgoing, setOutgoing] = useState<number | null>(null);
  const [direction, setDirection] = useState(1);
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    let active = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
      if (active) setReduceMotion(enabled);
    });
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => { active = false; subscription.remove(); };
  }, []);

  useLayoutEffect(() => {
    const previous = previousIndex.current;
    previousIndex.current = screenIndex;
    progress.stopAnimation();
    if (reduceMotion || previous === screenIndex || width === 0) {
      progress.setValue(1);
      setOutgoing(null);
      return;
    }
    setOutgoing(previous);
    setDirection(screenIndex > previous ? 1 : -1);
    progress.setValue(0);
    const animation = Animated.timing(progress, {
      toValue: 1, duration: 220, easing: Easing.out(Easing.cubic), useNativeDriver: Platform.OS !== 'web',
    });
    animation.start(({ finished }) => { if (finished) setOutgoing(null); });
    return () => animation.stop();
  }, [screenIndex, reduceMotion, width, progress]);

  return <View onLayout={({ nativeEvent: { layout } }) => setWidth(layout.width)} style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
    {Array.from(visited.current).map((index) => {
      const active = index === screenIndex;
      const visible = active || index === outgoing;
      const translateX = progress.interpolate({ inputRange: [0, 1], outputRange: active ? [direction * width, 0] : [0, -direction * width] });
      return <Animated.View key={index} pointerEvents={active ? 'auto' : 'none'} accessibilityElementsHidden={!active} importantForAccessibility={active ? 'auto' : 'no-hide-descendants'} style={{ position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, display: visible ? 'flex' : 'none', transform: [{ translateX }] }}>
        {renderScreen(index, active)}
      </Animated.View>;
    })}
  </View>;
}
