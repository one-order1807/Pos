import Feather from '@expo/vector-icons/Feather';
import React, { useEffect, useRef, useState } from 'react';
import {
  AppState,
  Animated,
  Easing,
  Modal as RNModal,
  Pressable,
  StyleProp,
  StyleSheet,
  Text,
  TextInput,
  TextInputProps,
  View,
  ViewStyle,
  useWindowDimensions,
} from 'react-native';
import { colors, fonts, radius, shadow } from './theme';

export type IconName = React.ComponentProps<typeof Feather>['name'];

export function Icon({ name, size = 20, color = colors.text }: { name: IconName; size?: number; color?: string }) {
  return <Feather name={name} size={size} color={color} />;
}

// ---------- toast ----------

type ToastKind = 'info' | 'success' | 'error';
interface ToastMsg {
  id: number;
  text: string;
  kind: ToastKind;
}
let toastSeq = 0;
let toastSetter: ((t: ToastMsg | null) => void) | null = null;
let toastTimer: ReturnType<typeof setTimeout> | null = null;

export function toast(text: string, kind: ToastKind = 'info', ms = 3200) {
  toastSeq += 1;
  toastSetter?.({ id: toastSeq, text, kind });
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastSetter?.(null), ms);
}

export function ToastHost() {
  const [t, setT] = useState<ToastMsg | null>(null);
  useEffect(() => {
    toastSetter = setT;
    return () => {
      toastSetter = null;
    };
  }, []);
  if (!t) return null;
  const bg = t.kind === 'error' ? colors.red : t.kind === 'success' ? '#15803D' : colors.text;
  return (
    <View pointerEvents="none" style={styles.toastWrap}>
      <FadeIn key={t.id}>
        <View style={[styles.toast, { backgroundColor: bg }]}>
          <Text style={styles.toastText}>{t.text}</Text>
        </View>
      </FadeIn>
    </View>
  );
}

// ---------- motion helpers ----------

export function FadeIn({ children, style, delay = 0 }: { children: React.ReactNode; style?: StyleProp<ViewStyle>; delay?: number }) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(v, { toValue: 1, duration: 300, delay, easing: Easing.out(Easing.quad), useNativeDriver: true }).start();
  }, [v, delay]);
  return (
    <Animated.View
      style={[style, { opacity: v, transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [10, 0] }) }] }]}
    >
      {children}
    </Animated.View>
  );
}

export function Skeleton({ width = '100%', height = 16, style }: { width?: number | `${number}%`; height?: number; style?: StyleProp<ViewStyle> }) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(Animated.timing(v, { toValue: 1, duration: 1400, easing: Easing.linear, useNativeDriver: true }));
    loop.start();
    return () => loop.stop();
  }, [v]);
  return (
    <View style={[{ width, height, backgroundColor: colors.muted, borderRadius: 8, overflow: 'hidden' }, style]}>
      <Animated.View
        style={{
          ...StyleSheet.absoluteFill,
          width: 160,
          backgroundColor: 'rgba(255,255,255,0.65)',
          transform: [{ translateX: v.interpolate({ inputRange: [0, 1], outputRange: [-160, 420] }) }],
        }}
      />
    </View>
  );
}

// ---------- buttons ----------

type BtnVariant = 'primary' | 'secondary' | 'danger' | 'ghost' | 'success';

export function Btn({
  label,
  onPress,
  onLongPress,
  delayLongPress,
  icon,
  variant = 'primary',
  disabled,
  style,
  small,
  full,
}: {
  label?: string;
  onPress: () => void;
  onLongPress?: () => void;
  delayLongPress?: number;
  icon?: IconName;
  variant?: BtnVariant;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  small?: boolean;
  full?: boolean;
}) {
  const scale = useRef(new Animated.Value(1)).current;
  const to = (v: number) =>
    Animated.timing(scale, { toValue: v, duration: 200, easing: Easing.out(Easing.quad), useNativeDriver: true }).start();
  const palette = {
    primary: { bg: colors.primary, fg: '#fff', border: colors.primary },
    secondary: { bg: colors.white, fg: colors.primary, border: colors.midSoft },
    danger: { bg: colors.red, fg: '#fff', border: colors.red },
    success: { bg: '#16A34A', fg: '#fff', border: '#16A34A' },
    ghost: { bg: 'transparent', fg: colors.primary, border: 'transparent' },
  }[variant];
  return (
    <Animated.View style={[{ transform: [{ scale }], opacity: disabled ? 0.45 : 1 }, full && { alignSelf: 'stretch' }, style]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        disabled={disabled}
        onPress={onPress}
        onLongPress={onLongPress}
        delayLongPress={delayLongPress}
        onPressIn={() => to(1.05)}
        onPressOut={() => to(1)}
        hitSlop={4}
        style={[
          styles.btn,
          small && styles.btnSmall,
          { backgroundColor: palette.bg, borderColor: palette.border },
          variant !== 'ghost' && shadow,
        ]}
      >
        {icon ? <Icon name={icon} size={small ? 16 : 18} color={palette.fg} /> : null}
        {label ? <Text style={[styles.btnText, small && { fontSize: 13 }, { color: palette.fg }]}>{label}</Text> : null}
      </Pressable>
    </Animated.View>
  );
}

export function Card({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function Chip({ label, active, onPress, color }: { label: string; active?: boolean; onPress?: () => void; color?: string }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={[
        styles.chip,
        active && { backgroundColor: color ?? colors.primary, borderColor: color ?? colors.primary },
      ]}
    >
      <Text style={[styles.chipText, active && { color: '#fff' }]}>{label}</Text>
    </Pressable>
  );
}

export function Field({ label, style, ...props }: TextInputProps & { label?: string }) {
  return (
    <View style={{ marginBottom: 12 }}>
      {label ? <Text style={styles.fieldLabel}>{label}</Text> : null}
      <TextInput
        placeholderTextColor="#94A3B8"
        {...props}
        style={[styles.input, style]}
      />
    </View>
  );
}

// ---------- modal ----------

export function Modal({
  visible,
  onClose,
  title,
  children,
  width = 520,
}: {
  visible: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  width?: number;
}) {
  const dim = useWindowDimensions();
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (visible) {
      v.setValue(0);
      Animated.timing(v, { toValue: 1, duration: 200, easing: Easing.out(Easing.quad), useNativeDriver: true }).start();
    }
  }, [visible, v]);
  return (
    <RNModal visible={visible} transparent animationType="none" onRequestClose={onClose} supportedOrientations={['portrait', 'landscape']}>
      <Pressable style={styles.overlay} onPress={onClose}>
        <Animated.View
          style={{
            opacity: v,
            transform: [{ scale: v.interpolate({ inputRange: [0, 1], outputRange: [0.94, 1] }) }],
            width: Math.min(width, dim.width - 32),
            maxHeight: dim.height - 48,
          }}
        >
          <Pressable style={styles.modalCard} onPress={() => {}}>
            {title ? (
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>{title}</Text>
                <Pressable onPress={onClose} hitSlop={12} accessibilityLabel="Close" style={styles.closeBtn}>
                  <Icon name="x" size={20} color={colors.textSoft} />
                </Pressable>
              </View>
            ) : null}
            {children}
          </Pressable>
        </Animated.View>
      </Pressable>
    </RNModal>
  );
}

export function Confirm({
  visible,
  title,
  message,
  confirmLabel = 'Confirm',
  danger,
  onConfirm,
  onCancel,
}: {
  visible: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Modal visible={visible} onClose={onCancel} title={title} width={440}>
      <Text style={styles.confirmMsg}>{message}</Text>
      <View style={styles.row}>
        <Btn label="Cancel" variant="secondary" onPress={onCancel} style={{ flex: 1 }} />
        <Btn label={confirmLabel} variant={danger ? 'danger' : 'primary'} onPress={onConfirm} style={{ flex: 1 }} />
      </View>
    </Modal>
  );
}

export function useCountdown(active: boolean, seconds: number): number {
  const [left, setLeft] = useState(seconds);
  useEffect(() => {
    if (!active) return;
    setLeft(seconds);
    const started = Date.now();
    const id = setInterval(() => {
      const remaining = Math.max(0, seconds - Math.floor((Date.now() - started) / 1000));
      setLeft(remaining);
      if (remaining === 0) clearInterval(id);
    }, 250);
    return () => clearInterval(id);
  }, [active, seconds]);
  return left;
}

export function CountdownBtn({
  label,
  seconds,
  active,
  onPress,
  variant = 'danger',
  icon,
  full,
  style,
}: {
  label: string;
  seconds: number;
  active: boolean;
  onPress: () => void;
  variant?: BtnVariant;
  icon?: IconName;
  full?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const left = useCountdown(active, seconds);
  return (
    <Btn
      label={left > 0 ? `${label} (${left})` : label}
      onPress={onPress}
      disabled={left > 0}
      variant={variant}
      icon={icon}
      full={full}
      style={style}
    />
  );
}

export const CLOSE_DELAY_SECONDS = 5;

export function DelayedConfirm({
  visible,
  title,
  message,
  confirmLabel = 'Close anyway',
  onConfirm,
  onCancel,
}: {
  visible: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Modal visible={visible} onClose={onCancel} title={title} width={440}>
      <Text style={styles.confirmMsg}>{message}</Text>
      <View style={styles.row}>
        <Btn label="Cancel" variant="secondary" onPress={onCancel} style={{ flex: 1 }} />
        <CountdownBtn
          label={confirmLabel}
          seconds={CLOSE_DELAY_SECONDS}
          active={visible}
          onPress={onConfirm}
          style={{ flex: 1 }}
        />
      </View>
    </Modal>
  );
}

export function Wordmark({ size = 26, color = colors.primary }: { size?: number; color?: string }) {
  return <Text style={{ fontFamily: fonts.wordmark, fontSize: size, color, letterSpacing: 0.6 }}>ONEORDER</Text>;
}

export function Dot({ color, size = 10 }: { color: string; size?: number }) {
  return <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: color }} />;
}

export function SectionTitle({ children }: { children: React.ReactNode }) {
  return <Text style={styles.sectionTitle}>{children}</Text>;
}

export function EmptyState({ icon, text }: { icon: IconName; text: string }) {
  return (
    <View style={styles.empty}>
      <Icon name={icon} size={28} color={colors.textSoft} />
      <Text style={styles.emptyText}>{text}</Text>
    </View>
  );
}

export function useNow(intervalMs = 10000): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    const sub = AppState.addEventListener('change', (st) => {
      if (st === 'active') setNow(Date.now());
    });
    return () => {
      clearInterval(id);
      sub.remove();
    };
  }, [intervalMs]);
  return now;
}

const styles = StyleSheet.create({
  btn: {
    minHeight: 48,
    paddingHorizontal: 18,
    borderRadius: radius,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  btnSmall: { minHeight: 40, paddingHorizontal: 12 },
  btnText: { fontFamily: fonts.semibold, fontSize: 15 },
  card: {
    backgroundColor: colors.white,
    borderRadius: radius,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14,
    ...(shadow as object),
  },
  chip: {
    minHeight: 44,
    paddingHorizontal: 16,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 8,
  },
  chipText: { fontFamily: fonts.medium, fontSize: 14, color: colors.text },
  fieldLabel: { fontFamily: fonts.medium, fontSize: 13, color: colors.textSoft, marginBottom: 6 },
  input: {
    minHeight: 48,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius,
    paddingHorizontal: 12,
    fontFamily: fonts.body,
    fontSize: 15,
    color: colors.text,
    backgroundColor: colors.white,
  },
  overlay: { flex: 1, backgroundColor: colors.overlay, alignItems: 'center', justifyContent: 'center', padding: 16 },
  modalCard: { backgroundColor: colors.white, borderRadius: 16, padding: 18 },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  modalTitle: { fontFamily: fonts.heading, fontSize: 26, color: colors.text, flex: 1 },
  closeBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  confirmMsg: { fontFamily: fonts.body, fontSize: 15, color: colors.text, marginBottom: 16, lineHeight: 22 },
  row: { flexDirection: 'row', gap: 10 },
  toastWrap: { position: 'absolute', left: 0, right: 0, bottom: 24, alignItems: 'center', zIndex: 999 },
  toast: { paddingHorizontal: 16, paddingVertical: 12, borderRadius: 12, maxWidth: 560 },
  toastText: { color: '#fff', fontFamily: fonts.medium, fontSize: 14 },
  sectionTitle: { fontFamily: fonts.heading, fontSize: 24, color: colors.text, marginBottom: 8 },
  empty: { alignItems: 'center', justifyContent: 'center', padding: 24, gap: 8 },
  emptyText: { fontFamily: fonts.body, fontSize: 14, color: colors.textSoft, textAlign: 'center' },
});
