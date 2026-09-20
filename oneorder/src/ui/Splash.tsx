import React, { useEffect, useRef } from 'react';
import { Animated, Easing, Pressable, StyleSheet, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { colors, fonts } from './theme';

const FILL_H = 80;

export function Splash({ name, onDone }: { name: string; onDone: () => void }) {
  const fill = useRef(new Animated.Value(0)).current;
  const nameAnim = useRef(new Animated.Value(0)).current;
  const steam = useRef([0, 1, 2].map(() => new Animated.Value(0))).current;
  const done = useRef(false);

  const finish = () => {
    if (done.current) return;
    done.current = true;
    onDone();
  };

  useEffect(() => {
    Animated.timing(fill, { toValue: 1, duration: 900, easing: Easing.out(Easing.quad), useNativeDriver: false }).start();
    Animated.timing(nameAnim, { toValue: 1, duration: 400, delay: 400, easing: Easing.out(Easing.quad), useNativeDriver: true }).start();
    const loops = steam.map((v, i) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(i * 150),
          Animated.timing(v, { toValue: 1, duration: 900, easing: Easing.out(Easing.quad), useNativeDriver: true }),
          Animated.timing(v, { toValue: 0, duration: 0, useNativeDriver: true }),
        ]),
      ),
    );
    loops.forEach((l) => l.start());
    const t = setTimeout(finish, 1500);
    return () => {
      clearTimeout(t);
      loops.forEach((l) => l.stop());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Pressable style={styles.root} onPress={finish} accessibilityLabel="Skip intro">
      <View style={styles.cupBox}>
        <View style={styles.steamRow}>
          {steam.map((v, i) => (
            <Animated.View
              key={i}
              style={[
                styles.wisp,
                {
                  opacity: v.interpolate({ inputRange: [0, 0.3, 1], outputRange: [0, 0.7, 0] }),
                  transform: [
                    { translateY: v.interpolate({ inputRange: [0, 1], outputRange: [0, -30] }) },
                    { scaleX: v.interpolate({ inputRange: [0, 1], outputRange: [1, 1.4] }) },
                  ],
                },
              ]}
            />
          ))}
        </View>
        <View style={styles.cupWrap}>
          <View style={styles.coffeeClip}>
            <Animated.View style={[styles.coffee, { height: fill.interpolate({ inputRange: [0, 1], outputRange: [0, FILL_H] }) }]} />
          </View>
          <Svg width={140} height={120} viewBox="0 0 140 120" style={StyleSheet.absoluteFill}>
            <Path
              d="M10 20 H110 V66 A34 34 0 0 1 76 100 H44 A34 34 0 0 1 10 66 Z"
              stroke={colors.primary}
              strokeWidth={5}
              fill="none"
              strokeLinejoin="round"
            />
            <Path d="M110 38 H122 A16 16 0 0 1 122 74 H107" stroke={colors.primary} strokeWidth={5} fill="none" strokeLinecap="round" />
          </Svg>
        </View>
      </View>
      <Animated.Text
        style={[
          styles.name,
          {
            opacity: nameAnim,
            transform: [{ translateY: nameAnim.interpolate({ inputRange: [0, 1], outputRange: [8, 0] }) }],
          },
        ]}
      >
        {name}
      </Animated.Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' },
  cupBox: { alignItems: 'center' },
  steamRow: { flexDirection: 'row', gap: 16, height: 44, marginLeft: -10, marginBottom: 4, alignItems: 'flex-end' },
  wisp: { width: 6, height: 22, borderRadius: 3, backgroundColor: colors.teal },
  cupWrap: { width: 140, height: 120 },
  coffeeClip: {
    position: 'absolute',
    left: 12.5,
    top: 22.5,
    width: 95,
    height: 75,
    borderBottomLeftRadius: 31,
    borderBottomRightRadius: 31,
    overflow: 'hidden',
    justifyContent: 'flex-end',
  },
  coffee: { width: '100%', backgroundColor: colors.amber },
  name: { marginTop: 18, fontFamily: fonts.heading, fontSize: 44, color: colors.primary, letterSpacing: 1 },
});
