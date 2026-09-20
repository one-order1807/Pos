import React from 'react';
import { Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { PrintLine } from '../printing/layout';
import { colors } from './theme';

const MONO = Platform.select({ android: 'monospace', ios: 'Menlo', default: 'monospace' });
const FONT = 12;
const CHAR_W = FONT * 0.6;

export function Receipt({ lines, columns, maxHeight }: { lines: PrintLine[]; columns: number; maxHeight?: number }) {
  const width = Math.ceil(columns * CHAR_W) + 24;
  return (
    <ScrollView style={[styles.scroll, maxHeight ? { maxHeight } : null]} nestedScrollEnabled>
      <View style={[styles.paper, { width }]}>
        {lines.map((l, i) => {
          const size = l.size === 2 ? FONT * 2 : l.tall ? FONT * 1.4 : FONT;
          return (
            <Text
              key={i}
              style={{
                fontFamily: MONO,
                fontSize: size,
                lineHeight: size * 1.25,
                fontWeight: l.bold ? '700' : '400',
                textAlign: l.align ?? 'left',
                color: '#111',
              }}
            >
              {l.text.length ? l.text : ' '}
            </Text>
          );
        })}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { alignSelf: 'center', maxWidth: '100%' },
  paper: {
    backgroundColor: '#FFFDF7',
    padding: 12,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 4,
    alignSelf: 'center',
  },
});
