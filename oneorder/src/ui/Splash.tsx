import React, { useEffect, useRef } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import Svg, { Circle, Ellipse, Path } from 'react-native-svg';
import { colors, fonts } from './theme';

const FILL_H = 80;
const TOTAL_MS = 3000;

// Abstract wedge - reads as "a slice" through shape and colour alone, not a literal illustration.
function Wedge() {
  return (
    <Svg width={80} height={80} viewBox="0 0 80 80">
      <Path d="M40 6 L75 72 A40 40 0 0 1 5 72 Z" fill={colors.amber} opacity={0.92} />
      <Path d="M40 6 L75 72 A40 40 0 0 1 5 72 Z" fill="none" stroke={colors.primary} strokeWidth={3} strokeLinejoin="round" />
      <Circle cx={40} cy={42} r={4} fill={colors.coral} />
      <Circle cx={25} cy={58} r={3} fill={colors.coral} />
      <Circle cx={55} cy={58} r={3} fill={colors.coral} />
    </Svg>
  );
}

// A calligraphy-style flourish - decorative, not representational.
function Flourish() {
  return (
    <Svg width={112} height={70} viewBox="0 0 112 70">
      <Path
        d="M4 50 C 26 8, 54 8, 40 34 C 30 52, 70 60, 78 30 C 84 8, 100 8, 106 24"
        stroke={colors.coral}
        strokeWidth={7}
        strokeLinecap="round"
        fill="none"
      />
    </Svg>
  );
}

export function Splash({ name, onDone }: { name: string; onDone: () => void }) {
  const { width } = useWindowDimensions();
  const fill = useRef(new Animated.Value(0)).current;
  const nameAnim = useRef(new Animated.Value(0)).current;
  const foods = useRef(new Animated.Value(0)).current;
  const steam = useRef([0, 1, 2].map(() => new Animated.Value(0))).current;
  const done = useRef(false);
  const offscreen = width / 2 + 100;

  const finish = () => {
    if (done.current) return;
    done.current = true;
    onDone();
  };

  useEffect(() => {
    Animated.timing(fill, { toValue: 1, duration: 900, easing: Easing.out(Easing.quad), useNativeDriver: false }).start();
    Animated.timing(nameAnim, { toValue: 1, duration: 400, delay: 400, easing: Easing.out(Easing.quad), useNativeDriver: true }).start();
    Animated.sequence([
      Animated.delay(1000),
      Animated.timing(foods, { toValue: 1, duration: 650, easing: Easing.inOut(Easing.cubic), useNativeDriver: true }),
      Animated.delay(800),
      Animated.timing(foods, { toValue: 2, duration: 550, easing: Easing.inOut(Easing.cubic), useNativeDriver: true }),
    ]).start();
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
    const t = setTimeout(finish, TOTAL_MS);
    return () => {
      clearTimeout(t);
      loops.forEach((l) => l.stop());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const lift = nameAnim.interpolate({ inputRange: [0, 1], outputRange: [8, 0] });
  const showCafe = name.trim() && name.trim().toUpperCase() !== 'ONEORDER';

  return (
    <Pressable style={styles.root} onPress={finish} accessibilityLabel="Skip intro">
      <View style={styles.stage}>
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
              <Ellipse cx={60} cy={112} rx={44} ry={4} fill={colors.primaryTint} />
            </Svg>
          </View>
        </View>

        <Animated.View
          pointerEvents="none"
          style={[
            styles.food,
            { left: width / 2 - 200, transform: [{ translateX: foods.interpolate({ inputRange: [0, 1, 2], outputRange: [-offscreen, 0, -offscreen] }) }] },
          ]}
        >
          <Wedge />
        </Animated.View>
        <Animated.View
          pointerEvents="none"
          style={[
            styles.food,
            { left: width / 2 + 90, transform: [{ translateX: foods.interpolate({ inputRange: [0, 1, 2], outputRange: [offscreen, 0, offscreen] }) }] },
          ]}
        >
          <Flourish />
        </Animated.View>
      </View>

      <Animated.View style={{ opacity: nameAnim, transform: [{ translateY: lift }], alignItems: 'center' }}>
        {showCafe ? <Text style={styles.cafe}>{name.trim()}</Text> : null}
        <Text style={styles.name}>ONEORDER</Text>
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' },
  stage: { width: '100%', height: 190, alignItems: 'center', justifyContent: 'center' },
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
  food: { position: 'absolute', top: 70 },
  name: { marginTop: 4, fontFamily: fonts.wordmark, fontSize: 22, color: colors.textSoft, letterSpacing: 0.5 },
  cafe: { fontFamily: fonts.heading, fontSize: 40, color: colors.primary },
});
