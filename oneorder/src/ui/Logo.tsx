import React from 'react';
import { Text, View } from 'react-native';
import Svg, { Circle, Polygon } from 'react-native-svg';
import { colors, fonts } from './theme';

// The "O1" monogram: a navy disc, a blue sweeping accent arc (one continuous ring motion - "One"),
// and a bold geometric "1" numeral. Mirrors the same geometry used to generate the static app-icon
// PNGs (see the icon-generation notes in AGENTS.md / the Round 5 commit) so the in-app mark and the
// installed app icon read as the same brand, just at different sizes.
//
// The numeral is drawn as a single fused polygon (flag + stem, one shape) rather than SVG <Text>,
// so it renders identically everywhere - no dependency on a font being loaded for a tiny mark like
// the floating-bubble preview or a toolbar icon.
function numeralPoints(cx: number, cy: number, r: number): string {
  const totalH = r * 1.1;
  const stemW = r * 0.32;
  const top = cy - totalH / 2;
  const bottom = top + totalH;
  const x = cx - stemW / 2;
  const xR = x + stemW;
  const flagOut = r * 0.28;
  const flagTipY = top + r * 0.3;
  const flagJoinY = top + r * 0.44;
  return [
    [x - flagOut, flagTipY],
    [x, top],
    [xR, top],
    [xR, bottom],
    [x, bottom],
    [x, flagJoinY],
  ]
    .map(([px, py]) => `${px},${py}`)
    .join(' ');
}

export function LogoMark({ size = 64 }: { size?: number }) {
  const cx = size / 2;
  const cy = size / 2;
  const R = size * 0.47;
  const rimR = R * 0.88;
  const rimW = R * 0.1;
  const numR = R * 0.74;
  const circ = 2 * Math.PI * rimR;
  const arcLen = (circ * 140) / 360;
  return (
    <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <Circle cx={cx} cy={cy} r={R} fill={colors.text} />
      <Circle
        cx={cx}
        cy={cy}
        r={rimR}
        stroke={colors.primary}
        strokeWidth={rimW}
        fill="none"
        strokeLinecap="round"
        strokeDasharray={`${arcLen} ${circ}`}
        rotation={-110}
        origin={`${cx}, ${cy}`}
      />
      <Polygon points={numeralPoints(cx, cy, numR)} fill="#fff" />
    </Svg>
  );
}

export function LogoWordmark({ size = 24 }: { size?: number }) {
  return (
    <View style={{ flexDirection: 'row' }}>
      <Text style={{ fontFamily: fonts.bold, fontSize: size, color: colors.text, letterSpacing: 0.5 }}>ONE-</Text>
      <Text style={{ fontFamily: fonts.bold, fontSize: size, color: colors.primary, letterSpacing: 0.5 }}>ORDER</Text>
    </View>
  );
}
