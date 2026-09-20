import React, { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { DashboardScreen } from '../screens/DashboardScreen';
import { DevModeScreen } from '../screens/DevModeScreen';
import { KitchenScreen } from '../screens/KitchenScreen';
import { MenuScreen } from '../screens/MenuScreen';
import { OrderScreen } from '../screens/OrderScreen';
import { PrinterModal, printerStatusInfo } from '../screens/PrinterPanel';
import { TablesScreen } from '../screens/TablesScreen';
import { usePrinter } from '../printing/actions';
import { reconnectSaved } from '../printing/printer';
import { useStore, type TabKey } from '../store/store';
import { useSyncStatus } from '../sync/engine';
import { Dot, Icon, ToastHost, Wordmark, type IconName } from './components';
import { UsersScreen } from '../screens/UsersScreen';
import { colors, fonts } from './theme';

const NAV: { key: TabKey; label: string; icon: IconName }[] = [
  { key: 'order', label: 'Order', icon: 'shopping-cart' },
  { key: 'tables', label: 'Tables', icon: 'grid' },
  { key: 'kitchen', label: 'Kitchen', icon: 'coffee' },
  { key: 'menu', label: 'Menu', icon: 'book-open' },
  { key: 'users', label: 'Users', icon: 'users' },
  { key: 'dashboard', label: 'Dashboard', icon: 'bar-chart-2' },
  { key: 'dev', label: 'Dev Mode', icon: 'settings' },
];

export function Shell() {
  const tab = useStore((s) => s.tab);
  const setTab = useStore((s) => s.setTab);
  const lock = useStore((s) => s.lock);
  const tableMode = useStore((s) => s.data.settings.main.tableMode);
  const printerCfg = useStore((s) => s.data.settings.main.printer);
  const cafeName = useStore((s) => s.data.settings.main.bill.name);
  const pendingCount = useStore((s) => Object.values(s.data.tickets).filter((t) => t.status === 'pending').length);
  const saveError = useStore((s) => s.saveError);
  const retrySave = useStore((s) => s.retrySave);
  const printer = usePrinter();
  const sync = useSyncStatus();
  const [printerOpen, setPrinterOpen] = useState(false);

  useEffect(() => {
    if (printerCfg.deviceId) reconnectSaved(printerCfg.deviceId, printerCfg.deviceName || 'Printer');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function go(k: TabKey) {
    if (tab === 'dev' && k !== 'dev') lock();
    setTab(k);
  }

  const info = printerStatusInfo(printer.status);
  const items = NAV.filter((n) => n.key !== 'tables' || tableMode);
  const activeTab: TabKey = tab === 'tables' && !tableMode ? 'order' : tab;

  return (
    <SafeAreaView style={styles.root} edges={['top', 'left', 'right', 'bottom']}>
      <View style={styles.topBar}>
        <View style={styles.lockup}>
          <View style={styles.lockupRow}>
            <Text style={styles.agency}>Cloud Build</Text>
            <Text style={styles.times}>×</Text>
            <Wordmark size={26} />
          </View>
          {cafeName && cafeName.trim().toUpperCase() !== 'ONEORDER' ? (
            <Text style={styles.cafeCaption} numberOfLines={1}>
              ONEORDER × {cafeName.trim()}
            </Text>
          ) : null}
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flex: 1 }} contentContainerStyle={styles.navRow}>
          {items.map((n) => {
            const active = n.key === activeTab;
            return (
              <Pressable
                key={n.key}
                accessibilityRole="tab"
                accessibilityLabel={n.label}
                accessibilityState={{ selected: active }}
                onPress={() => go(n.key)}
                style={[styles.navItem, active && styles.navActive]}
              >
                <Icon name={n.icon} size={18} color={active ? '#fff' : colors.text} />
                <Text style={[styles.navText, active && { color: '#fff' }]}>{n.label}</Text>
                {n.key === 'kitchen' && pendingCount > 0 ? (
                  <View style={styles.badge}>
                    <Text style={styles.badgeText}>{pendingCount}</Text>
                  </View>
                ) : null}
              </Pressable>
            );
          })}
        </ScrollView>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Printer ${info.label}. Tap to manage`}
          onPress={() => setPrinterOpen(true)}
          style={styles.printerPill}
        >
          <Icon name="printer" size={16} color={colors.text} />
          <Dot color={info.color} />
          <Text style={styles.printerText}>{printer.status === 'connected' ? 'Connected' : 'Disconnected'}</Text>
        </Pressable>
        {sync.configured ? (
          <View style={styles.cloud} accessibilityLabel={`Cloud: ${sync.label}`}>
            <Icon name={sync.online ? 'cloud' : 'cloud-off'} size={18} color={sync.lastError ? colors.red : sync.pending > 0 ? colors.amber : colors.green} />
          </View>
        ) : null}
      </View>

      {saveError ? (
        <Pressable style={styles.errBar} onPress={retrySave}>
          <Icon name="alert-triangle" size={16} color="#fff" />
          <Text style={styles.errText}>Could not save to this tablet: {saveError}. Tap to retry.</Text>
        </Pressable>
      ) : null}

      <View style={{ flex: 1 }}>
        <Pane on={activeTab === 'order'}>
          <OrderScreen />
        </Pane>
        {tableMode ? (
          <Pane on={activeTab === 'tables'}>
            <TablesScreen />
          </Pane>
        ) : null}
        <Pane on={activeTab === 'kitchen'}>
          <KitchenScreen />
        </Pane>
        <Pane on={activeTab === 'menu'}>
          <MenuScreen />
        </Pane>
        <Pane on={activeTab === 'users'}>
          <UsersScreen />
        </Pane>
        <Pane on={activeTab === 'dashboard'}>
          <DashboardScreen />
        </Pane>
        {activeTab === 'dev' ? <DevModeScreen /> : null}
      </View>

      <PrinterModal visible={printerOpen} onClose={() => setPrinterOpen(false)} />
      <ToastHost />
    </SafeAreaView>
  );
}

function Pane({ on, children }: { on: boolean; children: React.ReactNode }) {
  return <View style={[styles.pane, !on && styles.hidden]}>{children}</View>;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 60,
    paddingHorizontal: 12,
    gap: 10,
    backgroundColor: colors.white,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  lockup: { justifyContent: 'center', maxWidth: 260 },
  lockupRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  agency: { fontFamily: fonts.semibold, fontSize: 12, color: colors.textSoft },
  times: { fontFamily: fonts.medium, fontSize: 14, color: colors.mid },
  cafeCaption: { fontFamily: fonts.medium, fontSize: 11, color: colors.textSoft, marginTop: -2 },
  navRow: { alignItems: 'center', paddingHorizontal: 4, gap: 6 },
  navItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: 44,
    paddingHorizontal: 14,
    borderRadius: 12,
  },
  navActive: { backgroundColor: colors.primary },
  navText: { fontFamily: fonts.semibold, fontSize: 14, color: colors.text },
  badge: { minWidth: 20, height: 20, borderRadius: 10, backgroundColor: colors.coral, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 5 },
  badgeText: { color: '#fff', fontFamily: fonts.bold, fontSize: 11 },
  printerPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: 44,
    paddingHorizontal: 12,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bg,
  },
  printerText: { fontFamily: fonts.semibold, fontSize: 13, color: colors.text },
  cloud: { width: 32, alignItems: 'center' },
  pane: { ...StyleSheet.absoluteFill },
  hidden: { display: 'none' },
  errBar: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.red, paddingHorizontal: 12, paddingVertical: 8 },
  errText: { flex: 1, color: '#fff', fontFamily: fonts.medium, fontSize: 13 },
});
