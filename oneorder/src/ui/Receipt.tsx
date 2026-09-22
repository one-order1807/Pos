import React from 'react';
import { Image, Platform, StyleSheet, Text, View } from 'react-native';
import { isPrintImage, type PrintBlock } from '../printing/layout';
import { printImageToBmpDataUri } from '../printing/raster';
import { colors, fonts } from './theme';

const MONO = Platform.select({ android: 'monospace', ios: 'Menlo', default: 'monospace' });
const FONT = 12;
const CHAR_W = FONT * 0.6;

// Plain, unscrolled paper content - the caller is responsible for putting this inside a scroll
// container (see AutoScrollView). Two nested ScrollViews here previously made long bills look
// "stuck" showing only their first screenful, with no reliable way to reach the bottom.
export function Receipt({ lines, columns }: { lines: PrintBlock[]; columns: number }) {
  const width = Math.ceil(columns * CHAR_W) + 24;
  const contentWidth = width - 24;

  return (
    <View style={[styles.paper, { width }]}>
      {lines.map((b, i) => {
        if (isPrintImage(b)) {
          const displayW = Math.min(contentWidth, b.width);
          const displayH = (b.height / b.width) * displayW;
          const align = b.align === 'left' ? 'flex-start' : b.align === 'right' ? 'flex-end' : 'center';
          return (
            <Image
              key={i}
              source={{ uri: printImageToBmpDataUri(b) }}
              style={{ width: displayW, height: displayH, alignSelf: align, marginVertical: 4 }}
              resizeMode="contain"
            />
          );
        }
        const brand = !!b.brand;
        const size = b.size === 2 ? FONT * 2 : b.tall ? FONT * 1.4 : brand ? FONT + 2 : FONT;
        return (
          <Text
            key={i}
            style={{
              fontFamily: brand ? fonts.wordmark : MONO,
              fontSize: size,
              lineHeight: size * 1.25,
              fontWeight: b.bold && !brand ? '700' : '400',
              textAlign: b.align ?? 'left',
              color: brand ? colors.primary : '#111',
              letterSpacing: brand ? 0.5 : 0,
            }}
          >
            {b.text.length ? b.text : ' '}
          </Text>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  paper: {
    backgroundColor: '#FFFDF7',
    padding: 12,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 4,
    alignSelf: 'center',
  },
});
