import React, { useEffect, useRef } from 'react';
import { Animated, Easing, ScrollView, StyleProp, ViewStyle } from 'react-native';

const AUTO_SCROLL_DELAY_MS = 2500;
const AUTO_SCROLL_DURATION_MS = 1700;

/**
 * The single scroll owner for a bill preview: bump `autoScrollSignal` (e.g. Date.now()) each time
 * the bill is (re)opened or printed to trigger a delayed scroll-to-bottom. If the person starts
 * touching the scroll area at any point - before or during that delay, or mid-animation - the
 * auto-scroll is cancelled immediately so it never fights their own scroll.
 *
 * The scroll-to-bottom is driven manually (an Animated.Value feeding repeated `scrollTo({y,
 * animated: false})` calls) rather than the native `scrollToEnd({animated: true})`, because that
 * API gives no control over duration or easing and read as an abrupt jump rather than a slow,
 * smooth scroll - this version's speed/feel is fully controlled by AUTO_SCROLL_DURATION_MS below.
 *
 * Deliberately the *only* ScrollView in a bill preview (Receipt itself renders plain, unscrolled
 * content, and the Modal this sits inside must be opened with `scrollable={false}`) - nesting a
 * second ScrollView around this one (either inside Receipt, or via Modal's own default wrapping
 * ScrollView) is what made long bills look "stuck" half-visible with no reliable way to scroll by
 * hand either: same-axis nested ScrollViews fight over the drag gesture on Android regardless of
 * nestedScrollEnabled.
 */
export function AutoScrollView({
  children,
  autoScrollSignal,
  style,
  contentContainerStyle,
}: {
  children: React.ReactNode;
  autoScrollSignal?: number;
  style?: StyleProp<ViewStyle>;
  contentContainerStyle?: StyleProp<ViewStyle>;
}) {
  const ref = useRef<ScrollView>(null);
  const cancelled = useRef(false);
  const contentHeight = useRef(0);
  const viewportHeight = useRef(0);
  const scrollY = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const id = scrollY.addListener(({ value }) => {
      ref.current?.scrollTo({ y: value, animated: false });
    });
    return () => scrollY.removeListener(id);
  }, [scrollY]);

  const cancelAutoScroll = () => {
    cancelled.current = true;
    scrollY.stopAnimation();
  };

  useEffect(() => {
    if (!autoScrollSignal) return undefined;
    cancelled.current = false;
    const id = setTimeout(() => {
      if (cancelled.current) return;
      const target = Math.max(0, contentHeight.current - viewportHeight.current);
      if (target <= 0) return;
      Animated.timing(scrollY, {
        toValue: target,
        duration: AUTO_SCROLL_DURATION_MS,
        easing: Easing.inOut(Easing.quad),
        useNativeDriver: false,
      }).start();
    }, AUTO_SCROLL_DELAY_MS);
    return () => clearTimeout(id);
  }, [autoScrollSignal, scrollY]);

  return (
    <ScrollView
      ref={ref}
      style={style}
      contentContainerStyle={contentContainerStyle}
      showsVerticalScrollIndicator
      persistentScrollbar
      scrollEventThrottle={16}
      onLayout={(e) => {
        viewportHeight.current = e.nativeEvent.layout.height;
      }}
      onContentSizeChange={(_w, h) => {
        contentHeight.current = h;
      }}
      onTouchStart={cancelAutoScroll}
      onScrollBeginDrag={cancelAutoScroll}
    >
      {children}
    </ScrollView>
  );
}
