import React, { useEffect, useRef } from 'react';
import { ScrollView, StyleProp, ViewStyle } from 'react-native';

const AUTO_SCROLL_DELAY_MS = 2500;

/**
 * The single scroll owner for a bill preview: bump `autoScrollSignal` (e.g. Date.now()) each time
 * the bill is (re)opened or printed to trigger a delayed scroll-to-bottom. If the person starts
 * dragging manually - before or during that delay - the pending auto-scroll is cancelled so it
 * never fights their own scroll.
 *
 * Deliberately the *only* ScrollView in a bill preview (Receipt itself renders plain, unscrolled
 * content) - nesting a second ScrollView inside this one is what made long bills look "stuck"
 * half-visible with no way to reach the bottom.
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

  useEffect(() => {
    if (!autoScrollSignal) return undefined;
    cancelled.current = false;
    const id = setTimeout(() => {
      if (!cancelled.current) ref.current?.scrollToEnd({ animated: true });
    }, AUTO_SCROLL_DELAY_MS);
    return () => clearTimeout(id);
  }, [autoScrollSignal]);

  return (
    <ScrollView
      ref={ref}
      style={style}
      contentContainerStyle={contentContainerStyle}
      showsVerticalScrollIndicator
      persistentScrollbar
      onScrollBeginDrag={() => {
        cancelled.current = true;
      }}
    >
      {children}
    </ScrollView>
  );
}
