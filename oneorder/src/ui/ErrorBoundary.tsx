import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Btn } from './components';
import { colors, fonts } from './theme';

interface State {
  error: Error | null;
}

// Catches any render-time exception anywhere below it (a corrupt restored backup field, a bad
// value that slipped past validation, anything unforeseen) and shows a recoverable screen instead
// of the blank white screen React leaves behind by default when nothing catches the error.
export class ErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <View style={styles.center}>
          <Text style={styles.title}>Something went wrong</Text>
          <Text style={styles.msg}>{this.state.error.message || String(this.state.error)}</Text>
          <Btn label="Try again" icon="refresh-cw" onPress={() => this.setState({ error: null })} />
        </View>
      );
    }
    return this.props.children;
  }
}

const styles = StyleSheet.create({
  center: { flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 12 },
  title: { fontFamily: fonts.heading, fontSize: 28, color: colors.text },
  msg: { fontFamily: fonts.body, fontSize: 14, color: colors.textSoft, textAlign: 'center' },
});
