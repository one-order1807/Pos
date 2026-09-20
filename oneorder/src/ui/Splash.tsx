import React, { useEffect, useRef } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import Svg, { Circle, Ellipse, Path, Polygon, Rect } from 'react-native-svg';
import { colors, fonts } from './theme';

const FILL_H = 80;
const TOTAL_MS = 3000;

function Pizza() {
  return (
    <Svg width={92} height={92} viewBox="0 0 92 92">
      <Circle cx={46} cy={46} r={42} fill="#E9A23B" />
      <Circle cx={46} cy={46} r={34} fill="#F8CB5B" />
      {[
        [34, 32],
        [58, 36],
        [46, 54],
        [30, 56],
        [62, 58],
      ].map(([x, y], i) => (
        <Circle key={i} cx={x} cy={y} r={6.5} fill="#DC2626" />
      ))}
      <Circle cx={46} cy={30} r={2.6} fill="#166534" />
      <Circle cx={40} cy={46} r={2.6} fill="#166534" />
      <Circle cx={54} cy={48} r={2.6} fill="#166534" />
    </Svg>
  );
}

function Sandwich() {
  return (
    <Svg width={96} height={84} viewBox="0 0 96 84">
      <Polygon points="6,66 48,10 90,66" fill="#D9A15B" />
      <Polygon points="16,58 48,17 80,58" fill="#F3D08F" />
      <Path d="M14 58 Q24 50 34 58 T54 58 T74 58 T84 58 L84 64 L14 64 Z" fill="#22A34A" />
      <Rect x={16} y={62} width={64} height={6} rx={3} fill="#EF4444" />
      <Polygon points="12,68 84,68 78,74 18,74" fill="#FACC15" />
      <Rect x={6} y={72} width={84} height={9} rx={4.5} fill="#C98A45" />
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
      Animated.timing(foods, { toValue: 1, duration: 600, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.delay(700),
      Animated.timing(foods, { toValue: 2, duration: 500, easing: Easing.in(Easing.cubic), useNativeDriver: true }),
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
          <Pizza />
        </Animated.View>
        <Animated.View
          pointerEvents="none"
          style={[
            styles.food,
            { left: width / 2 + 104, transform: [{ translateX: foods.interpolate({ inputRange: [0, 1, 2], outputRange: [offscreen, 0, offscreen] }) }] },
          ]}
        >
          <Sandwich />
        </Animated.View>
      </View>

      <Animated.View style={{ opacity: nameAnim, transform: [{ translateY: lift }], alignItems: 'center' }}>
        <View style={styles.lockup}>
          <Text style={styles.agency}>Cloud Build</Text>
          <Text style={styles.times}>×</Text>
          <Text style={styles.name}>ONEORDER</Text>
        </View>
        {showCafe ? <Text style={styles.cafe}>ONEORDER × {name.trim()}</Text> : null}
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
  lockup: { marginTop: 18, flexDirection: 'row', alignItems: 'center', gap: 10 },
  agency: { fontFamily: fonts.semibold, fontSize: 18, color: colors.textSoft },
  times: { fontFamily: fonts.medium, fontSize: 22, color: colors.mid },
  name: { fontFamily: fonts.wordmark, fontSize: 44, color: colors.primary, letterSpacing: 1 },
  cafe: { marginTop: 4, fontFamily: fonts.medium, fontSize: 16, color: colors.textSoft },
});
