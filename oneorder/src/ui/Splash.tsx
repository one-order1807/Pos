import React, { useEffect, useRef } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text, View } from 'react-native';
import appJson from '../../app.json';
import { LogoMark, LogoWordmark } from './Logo';
import { colors, fonts } from './theme';

const TOTAL_MS = 3200;
const MARK_SIZE = 148;

export function Splash({ name, onDone }: { name: string; onDone: () => void }) {
  const markScale = useRef(new Animated.Value(0.6)).current;
  const markOpacity = useRef(new Animated.Value(0)).current;
  const pulse = useRef(new Animated.Value(0)).current;
  const pulseLoopRef = useRef<ReturnType<typeof Animated.loop> | null>(null);
  const wordmarkAnim = useRef(new Animated.Value(0)).current;
  const footerAnim = useRef(new Animated.Value(0)).current;
  const done = useRef(false);

  const finish = () => {
    if (done.current) return;
    done.current = true;
    onDone();
  };

  useEffect(() => {
    Animated.timing(markOpacity, { toValue: 1, duration: 420, easing: Easing.out(Easing.quad), useNativeDriver: true }).start();
    Animated.timing(markScale, {
      toValue: 1,
      duration: 650,
      easing: Easing.out(Easing.back(1.5)),
      useNativeDriver: true,
    }).start(() => {
      // A slow, continuous breathing pulse once the entrance settles - keeps the mark genuinely
      // alive on screen instead of freezing into one static frame for the rest of the splash.
      const loop = Animated.loop(
        Animated.sequence([
          Animated.timing(pulse, { toValue: 1, duration: 1300, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
          Animated.timing(pulse, { toValue: 0, duration: 1300, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        ]),
      );
      loop.start();
      pulseLoopRef.current = loop;
    });
    Animated.timing(wordmarkAnim, { toValue: 1, duration: 420, delay: 480, easing: Easing.out(Easing.quad), useNativeDriver: true }).start();
    Animated.timing(footerAnim, { toValue: 1, duration: 380, delay: 820, easing: Easing.out(Easing.quad), useNativeDriver: true }).start();
    const t = setTimeout(finish, TOTAL_MS);
    return () => {
      clearTimeout(t);
      pulseLoopRef.current?.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pulseScale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.035] });
  const wordmarkLift = wordmarkAnim.interpolate({ inputRange: [0, 1], outputRange: [10, 0] });
  const footerLift = footerAnim.interpolate({ inputRange: [0, 1], outputRange: [8, 0] });
  const cafeName = name.trim();
  const showCafe = cafeName && cafeName.toUpperCase() !== 'ONEORDER' && cafeName.toUpperCase() !== 'ONE ORDER';

  return (
    <Pressable style={styles.root} onPress={finish} accessibilityLabel="Skip intro">
      <Animated.View
        style={{
          opacity: markOpacity,
          transform: [{ scale: Animated.multiply(markScale, pulseScale) }],
          marginBottom: 20,
        }}
      >
        <LogoMark size={MARK_SIZE} />
      </Animated.View>

      <Animated.View style={{ opacity: wordmarkAnim, transform: [{ translateY: wordmarkLift }] }}>
        <LogoWordmark size={28} />
      </Animated.View>

      <Animated.View style={{ opacity: footerAnim, transform: [{ translateY: footerLift }], alignItems: 'center', marginTop: 10 }}>
        {showCafe ? <Text style={styles.cafe}>× {cafeName}</Text> : null}
        <Text style={styles.version}>v{appJson.expo.version}</Text>
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' },
  cafe: { fontFamily: fonts.medium, fontSize: 16, color: colors.textSoft, marginBottom: 2 },
  version: { fontFamily: fonts.body, fontSize: 12, color: colors.textSoft, opacity: 0.7 },
});
