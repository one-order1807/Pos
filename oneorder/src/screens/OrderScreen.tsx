import React, { useMemo, useState } from 'react';
import { FlatList, Pressable, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native';
import { formatDuration, formatMoney } from '../domain/money';
import { openSessions, sessionLabel } from '../domain/ops';
import type { MenuItem, OrderType, Session } from '../domain/types';
import { printConnectivityTest } from '../printing/actions';
import { useStore } from '../store/store';
import { Btn, Chip, DelayedConfirm, Dot, EmptyState, Icon, Modal, toast, useNow } from '../ui/components';
import { colors, fonts, shadow } from '../ui/theme';
import { ItemModal } from './ItemModal';
import { OrderPanel } from './OrderPanel';
import { TablePicker } from './TablePicker';

const PANEL_WIDTH = 380;

export function OrderScreen() {
  const { width } = useWindowDimensions();
  const compact = width < 820;
  const data = useStore((s) => s.data);
  const activeId = useStore((s) => s.activeSessionId);
  const setActive = useStore((s) => s.setActive);
  const newOrder = useStore((s) => s.newOrder);
  const quickAdd = useStore((s) => s.quickAdd);
  const addCustom = useStore((s) => s.addCustom);
  const closeTab = useStore((s) => s.closeTab);
  const openTable = useStore((s) => s.openTable);
  const now = useNow(15000);

  const [search, setSearch] = useState('');
  const [catId, setCatId] = useState<string>('all');
  const [customItem, setCustomItem] = useState<MenuItem | null>(null);
  const [newMenu, setNewMenu] = useState(false);
  const [tablePick, setTablePick] = useState(false);
  const [closing, setClosing] = useState<Session | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [testingPrinter, setTestingPrinter] = useState(false);

  async function testPrinter() {
    if (testingPrinter) return;
    setTestingPrinter(true);
    const r = await printConnectivityTest();
    setTestingPrinter(false);
    if (r.ok) toast('Test print sent - check the printer.', 'success');
    else toast(`Printer test failed: ${r.error}`, 'error', 5000);
  }

  const settings = data.settings.main;
  const sessions = openSessions(data);
  const active = activeId ? data.sessions[activeId] : undefined;
  const categories = useMemo(
    () => Object.values(data.categories).sort((a, b) => a.sort - b.sort),
    [data.categories],
  );
  const selectedCat = catId === 'all' || data.categories[catId] ? catId : 'all';

  const items = useMemo(() => {
    const q = search.trim().toLowerCase();
    return Object.values(data.items)
      .filter((i) => i.active)
      .filter((i) => {
        if (q) return i.name.toLowerCase().includes(q) || i.code.toLowerCase().includes(q) || i.id.toLowerCase() === q;
        return selectedCat === 'all' || i.categoryId === selectedCat;
      })
      .sort((a, b) => {
        if (selectedCat === 'all' && !q) {
          const d = (data.categories[a.categoryId]?.sort ?? 0) - (data.categories[b.categoryId]?.sort ?? 0);
          if (d) return d;
        }
        return a.name.localeCompare(b.name);
      });
  }, [data.items, data.categories, search, selectedCat]);

  const qtyInOrder = useMemo(() => {
    const m = new Map<string, number>();
    active?.lines.forEach((l) => m.set(l.itemId, (m.get(l.itemId) ?? 0) + l.qty));
    return m;
  }, [active]);

  const gridWidth = (compact ? width : width - PANEL_WIDTH) - 24;
  const cols = Math.max(2, Math.floor(gridWidth / 170));
  const cardWidth = Math.floor((gridWidth - (cols - 1) * 10) / cols);

  function startOrder(type: OrderType) {
    setNewMenu(false);
    newOrder(type);
  }

  function requestClose(s: Session) {
    if (s.lines.length > 0 || s.rounds > 0) setClosing(s);
    else closeTab(s.id);
  }

  function pickFromNew(tableId: string) {
    setTablePick(false);
    setNewMenu(false);
    const r = openTable(tableId);
    if (r.redirected) toast('That table already has an order — opened it.');
  }

  const onAdd = (item: MenuItem) => {
    if (!active) {
      toast('Start a New Order first.');
      return;
    }
    quickAdd(item.id);
  };

  const orderTotal = active ? active.lines.reduce((n, l) => n + l.qty, 0) : 0;

  return (
    <View style={styles.root}>
      <View style={[styles.tabBar, { flexDirection: 'row', alignItems: 'center' }]}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ alignItems: 'center', paddingRight: 8 }} style={{ flex: 1 }}>
          {sessions.map((s) => {
            const isActive = s.id === activeId;
            const label = sessionLabel(data, s);
            return (
              <View key={s.id} style={[styles.tab, isActive && styles.tabActive]}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Open ${label}`}
                  style={styles.tabMain}
                  onPress={() => setActive(s.id)}
                >
                  {s.tableId ? <Dot color={colors.red} size={9} /> : null}
                  <Text style={[styles.tabText, isActive && { color: '#fff' }]} numberOfLines={1}>
                    {label}
                    {s.startedAt ? ` · ${formatDuration(now - s.startedAt)}` : ''}
                  </Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Close ${label}`}
                  style={styles.tabClose}
                  onPress={() => requestClose(s)}
                >
                  <Icon name="x" size={16} color={isActive ? '#fff' : colors.textSoft} />
                </Pressable>
              </View>
            );
          })}
          <Pressable accessibilityRole="button" accessibilityLabel="New order" style={styles.plus} onPress={() => setNewMenu(true)}>
            <Icon name="plus" size={20} color={colors.primary} />
            <Text style={styles.plusText}>New Order</Text>
          </Pressable>
        </ScrollView>
        <Btn
          small
          label="Test Print"
          icon="printer"
          variant="secondary"
          onPress={testPrinter}
          disabled={testingPrinter}
          style={{ marginHorizontal: 12 }}
        />
      </View>

      <View style={styles.body}>
        <View style={styles.left}>
          <View style={styles.searchWrap}>
            <Icon name="search" size={18} color={colors.textSoft} />
            <TextInput
              style={styles.search}
              placeholder="Search by item ID or name (all categories)"
              placeholderTextColor="#94A3B8"
              value={search}
              onChangeText={setSearch}
              autoCorrect={false}
            />
            {search ? (
              <Pressable onPress={() => setSearch('')} accessibilityLabel="Clear search" style={styles.clear}>
                <Icon name="x-circle" size={18} color={colors.textSoft} />
              </Pressable>
            ) : null}
          </View>
          <View style={{ height: 52 }}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ alignItems: 'center' }}>
              <Chip
                label="All"
                active={!search && selectedCat === 'all'}
                onPress={() => {
                  setSearch('');
                  setCatId('all');
                }}
              />
              {categories.map((c) => (
                <Chip
                  key={c.id}
                  label={c.name}
                  active={!search && c.id === selectedCat}
                  onPress={() => {
                    setSearch('');
                    setCatId(c.id);
                  }}
                />
              ))}
            </ScrollView>
          </View>
          <FlatList
            key={cols}
            data={items}
            numColumns={cols}
            keyExtractor={(i) => i.id}
            style={{ flex: 1 }}
            contentContainerStyle={{ paddingBottom: compact ? 84 : 12 }}
            columnWrapperStyle={{ gap: 10 }}
            ListEmptyComponent={<EmptyState icon="search" text={search ? 'No items match your search.' : 'No items in this category.'} />}
            renderItem={({ item }) => {
              const inOrder = qtyInOrder.get(item.id) ?? 0;
              return (
                <View style={{ width: cardWidth, marginBottom: 10 }}>
                  <View style={[styles.itemCard, { flex: 1 }]}>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Customize ${item.name}`}
                      style={styles.itemBody}
                      onPress={() => (active ? setCustomItem(item) : toast('Start a New Order first.'))}
                    >
                      <Text style={styles.itemCode}>{item.code}</Text>
                      <Text style={styles.itemName} numberOfLines={2}>
                        {item.name}
                      </Text>
                      <Text style={styles.itemPrice}>{formatMoney(item.price)}</Text>
                    </Pressable>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Quick add ${item.name}`}
                      style={styles.quickAdd}
                      onPress={() => onAdd(item)}
                    >
                      {inOrder > 0 ? <Text style={styles.badge}>{inOrder}</Text> : <Icon name="plus" size={22} color="#fff" />}
                    </Pressable>
                  </View>
                </View>
              );
            }}
          />
        </View>
        {!compact ? (
          <View style={{ width: PANEL_WIDTH }}>
            <OrderPanel sessionId={activeId} />
          </View>
        ) : null}
      </View>

      {compact ? (
        <View style={styles.bottomBar}>
          <Btn
            full
            icon="shopping-bag"
            label={active ? `View order · ${orderTotal} item(s)` : 'No order open'}
            onPress={() => (active ? setPanelOpen(true) : setNewMenu(true))}
          />
        </View>
      ) : null}
      {compact ? (
        <Modal visible={panelOpen} onClose={() => setPanelOpen(false)} width={560}>
          <View style={{ height: 520 }}>
            <OrderPanel sessionId={activeId} />
          </View>
        </Modal>
      ) : null}

      <ItemModal
        item={customItem}
        onClose={() => setCustomItem(null)}
        onAdd={(item, qty, note) => addCustom(item.id, qty, note)}
      />

      <Modal visible={newMenu} onClose={() => setNewMenu(false)} title="New Order" width={440}>
        <Text style={styles.newHint}>How is this order being served?</Text>
        <Btn label="Dine-in" icon="coffee" full onPress={() => startOrder('dine-in')} style={{ marginBottom: 10 }} />
        <Btn label="Takeaway" icon="shopping-bag" full onPress={() => startOrder('takeaway')} style={{ marginBottom: 10 }} />
        <Btn label="Delivery" icon="truck" full onPress={() => startOrder('delivery')} style={{ marginBottom: 10 }} />
        {settings.tableMode ? (
          <Btn
            label="Pick a table first"
            icon="grid"
            variant="secondary"
            full
            onPress={() => {
              setNewMenu(false);
              setTablePick(true);
            }}
          />
        ) : null}
      </Modal>
      <TablePicker visible={tablePick} onClose={() => setTablePick(false)} onPick={pickFromNew} />

      <DelayedConfirm
        visible={!!closing}
        title="Close this tab?"
        message={
          closing?.tableId
            ? 'This table has an unpaid order — close anyway?'
            : 'This order is unpaid — close anyway?'
        }
        confirmLabel="Close anyway"
        onCancel={() => setClosing(null)}
        onConfirm={() => {
          if (closing) closeTab(closing.id);
          setClosing(null);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  tabBar: { height: 60, paddingLeft: 12, borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: colors.white, justifyContent: 'center' },
  tab: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 48,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bg,
    marginRight: 8,
  },
  tabActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  tabMain: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 6, paddingLeft: 14, paddingRight: 6, maxWidth: 220 },
  tabText: { fontFamily: fonts.semibold, fontSize: 14, color: colors.text },
  tabClose: { width: 44, minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  plus: { flexDirection: 'row', alignItems: 'center', minHeight: 48, paddingHorizontal: 14, gap: 6, borderRadius: 12, borderWidth: 1, borderStyle: 'dashed', borderColor: colors.primary },
  plusText: { fontFamily: fonts.semibold, color: colors.primary, fontSize: 14 },
  body: { flex: 1, flexDirection: 'row' },
  left: { flex: 1, padding: 12, paddingBottom: 0 },
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.white,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    paddingLeft: 12,
    marginBottom: 10,
    minHeight: 48,
  },
  search: { flex: 1, minHeight: 48, paddingHorizontal: 10, fontFamily: fonts.body, fontSize: 15, color: colors.text },
  clear: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  itemCard: {
    backgroundColor: colors.white,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    flexDirection: 'row',
    overflow: 'hidden',
    ...(shadow as object),
  },
  itemBody: { flex: 1, padding: 12, minHeight: 92, justifyContent: 'space-between' },
  itemCode: { fontFamily: fonts.medium, fontSize: 11, color: colors.textSoft },
  // Fixed to exactly 2 lines' worth of height (15 * 1.2 line-height * 2) so a one-line name and a
  // two-line name leave the price at the same vertical position - without this, cards in the same
  // FlatList row stretch to the tallest sibling (React Native's row default) but the card border
  // itself doesn't grow to fill that space, so shorter cards looked "cut off" above their taller
  // row-mates instead of bottom-aligning with them.
  itemName: { fontFamily: fonts.semibold, fontSize: 15, lineHeight: 18, height: 36, color: colors.text, marginVertical: 2 },
  itemPrice: { fontFamily: fonts.bold, fontSize: 14, color: colors.primary },
  quickAdd: { width: 52, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  badge: { fontFamily: fonts.bold, color: '#fff', fontSize: 18 },
  bottomBar: { position: 'absolute', left: 12, right: 12, bottom: 12 },
  newHint: { fontFamily: fonts.body, color: colors.textSoft, marginBottom: 12 },
});
