import React, { useMemo, useRef, useState } from 'react';
import {
  Animated,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { formatDuration } from '../domain/money';
import {
  activeSessionForTable,
  addTableDraft,
  lockedTableIds,
  mergeTablesDraft,
  moveTableDraft,
  naturalCompare,
  removeTableDraft,
  renameTableDraft,
  tableStatus,
  unmergeTableDraft,
  type TableMap,
} from '../domain/ops';
import type { TableDef, TableStatus } from '../domain/types';
import { useStore } from '../store/store';
import { Btn, Chip, Confirm, Dot, EmptyState, Field, Icon, Modal, toast, useNow } from '../ui/components';
import { colors, fonts, shadow } from '../ui/theme';
import { STATUS_TEXT, statusColor } from './TablePicker';

type Mode = null | 'labels' | 'merge' | 'arrange';
const CARD_W = 118;
const CARD_H = 96;
const CANVAS_MIN_W = 900;
const CANVAS_MIN_H = 560;

export function TablesScreen() {
  const data = useStore((s) => s.data);
  const openTable = useStore((s) => s.openTable);
  const setTab = useStore((s) => s.setTab);
  const saveTables = useStore((s) => s.saveTables);
  const rollbackTables = useStore((s) => s.rollbackTables);
  const now = useNow(10000);

  const [view, setView] = useState<'layout' | 'list'>('layout');
  const [mode, setMode] = useState<Mode>(null);
  const [draft, setDraft] = useState<TableMap | null>(null);
  const [confirmRollback, setConfirmRollback] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [renaming, setRenaming] = useState<TableDef | null>(null);
  const [renameText, setRenameText] = useState('');
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<'name' | 'status'>('name');
  const scroll = useRef({ x: 0, y: 0 });
  const canvasOrigin = useRef({ x: 0, y: 0 });
  const canvasRef = useRef<View>(null);

  const editing = draft !== null;
  const tablesMap = draft ?? data.tables;
  const locked = useMemo(() => lockedTableIds(data), [data]);
  const visible = useMemo(
    () =>
      Object.values(tablesMap)
        .filter((t) => (mode === 'arrange' ? true : !t.mergedInto))
        .filter((t) => (mode === 'arrange' ? !t.members : true)),
    [tablesMap, mode],
  );

  function beginMode(m: Exclude<Mode, null>) {
    setDraft((d) => d ?? { ...data.tables });
    setMode(m);
    setSelected([]);
  }

  function finishSave() {
    if (!draft) return;
    const err = saveTables(draft);
    if (err) {
      toast(err, 'error');
      return;
    }
    toast('Table changes saved.', 'success');
    setDraft(null);
    setMode(null);
    setSelected([]);
  }

  function discard() {
    setDraft(null);
    setMode(null);
    setSelected([]);
    setConfirmDiscard(false);
  }

  const dirty = draft !== null && draft !== data.tables && JSON.stringify(draft) !== JSON.stringify(data.tables);

  function onTablePress(t: TableDef) {
    if (mode === 'labels') {
      setRenaming(t);
      setRenameText(t.label);
      return;
    }
    if (mode === 'merge') {
      if (t.members) {
        const r = unmergeTableDraft(draft!, t.id, locked);
        if (r.error) toast(r.error, 'error');
        else setDraft(r.tables);
        return;
      }
      if (locked.has(t.id)) {
        toast('That table has an active order and cannot be merged.', 'error');
        return;
      }
      setSelected((sel) => (sel.includes(t.id) ? sel.filter((x) => x !== t.id) : [...sel, t.id]));
      return;
    }
    if (mode === 'arrange') return;
    const r = openTable(t.id);
    if (r.redirected) toast(`${t.label} already has an order — opened it.`);
  }

  function doMerge() {
    const r = mergeTablesDraft(draft!, selected, locked);
    if (r.error) {
      toast(r.error, 'error');
      return;
    }
    setDraft(r.tables);
    setSelected([]);
    toast('Merged. Save to apply.');
  }

  const canvasW = Math.max(CANVAS_MIN_W, ...visible.map((t) => t.x + CARD_W + 80));
  const canvasH = Math.max(CANVAS_MIN_H, ...visible.map((t) => t.y + CARD_H + 80));

  function addAt(x: number, y: number) {
    setDraft((d) => addTableDraft(d!, x, y));
  }

  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    const arr = Object.values(data.tables)
      .filter((t) => !t.mergedInto)
      .filter((t) => !q || t.label.toLowerCase().includes(q));
    const rank: Record<TableStatus, number> = { payment: 0, cooking: 1, occupied: 2, available: 3 };
    return arr.sort((a, b) => {
      const am = a.members ? 0 : 1;
      const bm = b.members ? 0 : 1;
      if (am !== bm) return am - bm;
      if (sort === 'status') {
        const d = rank[tableStatus(data, a.id)] - rank[tableStatus(data, b.id)];
        if (d) return d;
      }
      return naturalCompare(a.label, b.label);
    });
  }, [data, query, sort]);

  return (
    <View style={styles.root}>
      <View style={styles.topRow}>
        <View style={styles.switcher}>
          <Chip label="Layout View" active={view === 'layout'} onPress={() => setView('layout')} />
          <Chip label="List View" active={view === 'list'} onPress={() => setView('list')} />
        </View>
        <View style={styles.manage}>
          {editing ? (
            <>
              <Chip label="Labels" active={mode === 'labels'} onPress={() => beginMode('labels')} color={colors.teal} />
              <Chip label="Merge" active={mode === 'merge'} onPress={() => beginMode('merge')} color={colors.teal} />
              <Chip label="Arrange" active={mode === 'arrange'} onPress={() => beginMode('arrange')} color={colors.teal} />
              <Btn small label="Save" icon="check" variant="success" onPress={finishSave} disabled={!dirty} />
              <View style={{ width: 8 }} />
              <Btn
                small
                label="Discard"
                icon="x"
                variant="secondary"
                onPress={() => (dirty ? setConfirmDiscard(true) : discard())}
              />
            </>
          ) : (
            <>
              <Btn small label="Labels" icon="edit-2" variant="secondary" onPress={() => beginMode('labels')} />
              <View style={{ width: 8 }} />
              <Btn small label="Merge" icon="git-merge" variant="secondary" onPress={() => beginMode('merge')} />
              <View style={{ width: 8 }} />
              <Btn small label="Arrange" icon="move" variant="secondary" onPress={() => beginMode('arrange')} />
            </>
          )}
        </View>
      </View>

      {editing ? (
        <View style={styles.banner}>
          <Icon name="info" size={16} color={colors.primaryDark} />
          <Text style={styles.bannerText}>
            {mode === 'labels' && 'Tap a table to rename it.'}
            {mode === 'merge' && 'Tap 2 or more free tables, then Merge. Tap a merged table to unmerge it.'}
            {mode === 'arrange' && 'Drag tables anywhere. Drag the + token onto the canvas to add a table.'}
            {' '}Changes apply only when you press Save.
          </Text>
          {mode === 'merge' ? (
            <Btn small label={`Merge ${selected.length || ''}`.trim()} icon="git-merge" onPress={doMerge} disabled={selected.length < 2} />
          ) : null}
          {mode === 'arrange' && (data.settings.main.layoutPrev?.length ?? 0) > 0 ? (
            <Btn small label="Rollback to last saved layout" icon="rotate-ccw" variant="secondary" onPress={() => setConfirmRollback(true)} />
          ) : null}
        </View>
      ) : null}

      {view === 'layout' ? (
        <View
          style={styles.canvasWrap}
          ref={canvasRef}
          onLayout={() => canvasRef.current?.measureInWindow((x, y) => (canvasOrigin.current = { x, y }))}
        >
          {visible.length === 0 && mode !== 'arrange' ? (
            <EmptyState icon="grid" text="No tables. Use Arrange to add tables." />
          ) : (
            <ScrollView
              scrollEnabled={!dragging}
              onScroll={(e) => (scroll.current.y = e.nativeEvent.contentOffset.y)}
              scrollEventThrottle={16}
            >
              <ScrollView
                horizontal
                scrollEnabled={!dragging}
                onScroll={(e) => (scroll.current.x = e.nativeEvent.contentOffset.x)}
                scrollEventThrottle={16}
              >
                <View style={{ width: canvasW, height: canvasH }}>
                  {visible.map((t) => (
                    <TableCard
                      key={t.id}
                      t={t}
                      mode={mode}
                      selected={selected.includes(t.id)}
                      locked={locked.has(t.id)}
                      now={now}
                      onPress={() => onTablePress(t)}
                      onMove={(x, y) => setDraft((d) => moveTableDraft(d!, t.id, x, y))}
                      onDelete={() => {
                        const next = removeTableDraft(draft!, t.id, locked);
                        if (next === draft) toast('A table with an active order cannot be removed.', 'error');
                        else setDraft(next);
                      }}
                      setDragging={setDragging}
                    />
                  ))}
                </View>
              </ScrollView>
            </ScrollView>
          )}
          {mode === 'arrange' ? (
            <AddToken
              onDrop={(pageX, pageY) => {
                const x = pageX - canvasOrigin.current.x + scroll.current.x - CARD_W / 2;
                const y = pageY - canvasOrigin.current.y + scroll.current.y - CARD_H / 2;
                addAt(Math.round(x / 10) * 10, Math.round(y / 10) * 10);
              }}
              onTap={() => addAt(20 + scroll.current.x, 20 + scroll.current.y)}
              setDragging={setDragging}
            />
          ) : null}
        </View>
      ) : (
        <View style={{ flex: 1, padding: 12 }}>
          <View style={styles.listTools}>
            <TextInput
              style={styles.listSearch}
              placeholder="Search tables"
              placeholderTextColor="#94A3B8"
              value={query}
              onChangeText={setQuery}
            />
            <Chip label="Name" active={sort === 'name'} onPress={() => setSort('name')} />
            <Chip label="Status" active={sort === 'status'} onPress={() => setSort('status')} />
          </View>
          <ScrollView>
            {list.length === 0 ? <EmptyState icon="grid" text="No tables to show." /> : null}
            {list.map((t) => {
              const st = tableStatus(data, t.id);
              const s = activeSessionForTable(data, t.id);
              return (
                <Pressable key={t.id} style={styles.listRow} onPress={() => onTablePress(t)} accessibilityRole="button">
                  <Dot color={statusColor(st)} size={12} />
                  <Text style={styles.listName}>{t.label}</Text>
                  <Text style={styles.listStatus}>{STATUS_TEXT[st]}</Text>
                  <Text style={styles.listTime}>{s?.startedAt ? formatDuration(now - s.startedAt) : '—'}</Text>
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
      )}

      <Confirm
        visible={confirmRollback}
        title="Roll back the layout?"
        message="This restores the table layout from before your last save. Any unsaved edits on this screen will be lost."
        confirmLabel="Roll back"
        danger
        onCancel={() => setConfirmRollback(false)}
        onConfirm={() => {
          setConfirmRollback(false);
          const err = rollbackTables();
          if (err) {
            toast(err, 'error');
            return;
          }
          setDraft(null);
          setMode(null);
          setSelected([]);
          toast('Previous layout restored.', 'success');
        }}
      />
      <Modal visible={!!renaming} onClose={() => setRenaming(null)} title="Rename table" width={400}>
        <Field label="Label" value={renameText} onChangeText={setRenameText} maxLength={16} autoFocus />
        <Btn
          label="Apply"
          full
          onPress={() => {
            if (renaming && renameText.trim()) setDraft((d) => renameTableDraft(d!, renaming.id, renameText));
            setRenaming(null);
          }}
        />
      </Modal>
      <Confirm
        visible={confirmDiscard}
        title="Discard changes?"
        message="Your table edits have not been saved and will be lost."
        confirmLabel="Discard"
        danger
        onCancel={() => setConfirmDiscard(false)}
        onConfirm={discard}
      />
      {!editing && view === 'layout' ? (
        <Pressable style={styles.hintBar} onPress={() => setTab('order')}>
          <Text style={styles.hintText}>Tap a table to open or start its order.</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function TableCard({
  t,
  mode,
  selected,
  locked,
  now,
  onPress,
  onMove,
  onDelete,
  setDragging,
}: {
  t: TableDef;
  mode: Mode;
  selected: boolean;
  locked: boolean;
  now: number;
  onPress: () => void;
  onMove: (x: number, y: number) => void;
  onDelete: () => void;
  setDragging: (d: boolean) => void;
}) {
  const data = useStore((s) => s.data);
  const status = tableStatus(data, t.id);
  const s = activeSessionForTable(data, t.id);
  const start = useRef({ x: 0, y: 0 });
  const latest = useRef({ x: t.x, y: t.y, onMove });
  latest.current = { x: t.x, y: t.y, onMove };
  const moved = useRef(false);

  const pan = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: () => {
          start.current = { x: latest.current.x, y: latest.current.y };
          moved.current = false;
          setDragging(true);
        },
        onPanResponderMove: (_e, g) => {
          if (Math.abs(g.dx) + Math.abs(g.dy) > 4) moved.current = true;
          latest.current.onMove(Math.round((start.current.x + g.dx) / 10) * 10, Math.round((start.current.y + g.dy) / 10) * 10);
        },
        onPanResponderRelease: () => setDragging(false),
        onPanResponderTerminate: () => setDragging(false),
      }),
    [setDragging],
  );

  const dot = mode === 'arrange' ? colors.textSoft : statusColor(status);
  const body = (
    <View
      style={[
        styles.card,
        { left: t.x, top: t.y },
        status !== 'available' && mode === null && { borderColor: colors.red, backgroundColor: '#FEF2F2' },
        selected && { borderColor: colors.primary, backgroundColor: colors.primaryTint, borderWidth: 2 },
        t.members ? { borderStyle: 'dashed' } : null,
      ]}
    >
      <View style={styles.cardTop}>
        <Dot color={dot} />
        <Text style={styles.cardLabel} numberOfLines={1}>
          {t.label}
        </Text>
        {mode === 'labels' ? <Icon name="edit-2" size={16} color={colors.primary} /> : null}
      </View>
      {t.members ? (
        <Text style={styles.cardSub} numberOfLines={1}>
          {t.members.map((m) => data.tables[m]?.label ?? '').join(', ')}
        </Text>
      ) : null}
      <Text style={styles.cardSub}>
        {mode === 'arrange' ? 'Drag to move' : STATUS_TEXT[status]}
        {mode === null && s?.startedAt ? ` · ${formatDuration(now - s.startedAt)}` : ''}
        {mode === 'merge' && locked ? ' · in use' : ''}
      </Text>
      {mode === 'arrange' && !t.members ? (
        <Pressable style={styles.del} onPress={onDelete} accessibilityLabel={`Remove ${t.label}`} hitSlop={8}>
          <Icon name="trash-2" size={16} color={colors.red} />
        </Pressable>
      ) : null}
    </View>
  );

  if (mode === 'arrange') {
    return (
      <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
        <View
          style={{ position: 'absolute', left: t.x, top: t.y, width: CARD_W, height: CARD_H }}
          {...pan.panHandlers}
        >
          {React.cloneElement(body, { style: [body.props.style, { left: 0, top: 0 }] })}
        </View>
      </View>
    );
  }
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${t.label} ${STATUS_TEXT[status]}`}
      onPress={onPress}
      style={{ position: 'absolute', left: t.x, top: t.y, width: CARD_W, height: CARD_H }}
    >
      {React.cloneElement(body, { style: [body.props.style, { left: 0, top: 0 }] })}
    </Pressable>
  );
}

function AddToken({
  onDrop,
  onTap,
  setDragging,
}: {
  onDrop: (pageX: number, pageY: number) => void;
  onTap: () => void;
  setDragging: (d: boolean) => void;
}) {
  const pos = useRef(new Animated.ValueXY()).current;
  const cb = useRef({ onDrop, onTap });
  cb.current = { onDrop, onTap };
  const pan = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: () => setDragging(true),
        onPanResponderMove: Animated.event([null, { dx: pos.x, dy: pos.y }], { useNativeDriver: false }),
        onPanResponderRelease: (_e, g) => {
          setDragging(false);
          if (Math.abs(g.dx) + Math.abs(g.dy) < 8) cb.current.onTap();
          else cb.current.onDrop(g.moveX, g.moveY);
          Animated.spring(pos, { toValue: { x: 0, y: 0 }, useNativeDriver: false }).start();
        },
        onPanResponderTerminate: () => {
          setDragging(false);
          Animated.spring(pos, { toValue: { x: 0, y: 0 }, useNativeDriver: false }).start();
        },
      }),
    [pos, setDragging],
  );
  return (
    <Animated.View style={[styles.token, { transform: pos.getTranslateTransform() }]} {...pan.panHandlers}>
      <Icon name="plus" size={26} color="#fff" />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 12, flexWrap: 'wrap', gap: 8 },
  switcher: { flexDirection: 'row' },
  manage: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 12,
    marginBottom: 8,
    padding: 10,
    borderRadius: 10,
    backgroundColor: colors.primaryTint,
  },
  bannerText: { flex: 1, fontFamily: fonts.medium, fontSize: 13, color: colors.primaryDark },
  canvasWrap: {
    flex: 1,
    marginHorizontal: 12,
    marginBottom: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: '#fff',
    overflow: 'hidden',
  },
  card: {
    position: 'absolute',
    width: CARD_W,
    height: CARD_H,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.white,
    padding: 10,
    justifyContent: 'space-between',
    ...(shadow as object),
  },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  cardLabel: { flex: 1, fontFamily: fonts.semibold, fontSize: 16, color: colors.text },
  cardSub: { fontFamily: fonts.body, fontSize: 11, color: colors.textSoft },
  del: { position: 'absolute', right: 6, bottom: 6, width: 28, height: 28, alignItems: 'center', justifyContent: 'center' },
  token: {
    position: 'absolute',
    right: 20,
    bottom: 20,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.teal,
    alignItems: 'center',
    justifyContent: 'center',
    ...(shadow as object),
  },
  listTools: { flexDirection: 'row', alignItems: 'center', marginBottom: 10, gap: 4 },
  listSearch: {
    flex: 1,
    minHeight: 48,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingHorizontal: 12,
    marginRight: 8,
    backgroundColor: '#fff',
    fontFamily: fonts.body,
    fontSize: 15,
    color: colors.text,
  },
  listRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 56,
    backgroundColor: '#fff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 14,
    marginBottom: 8,
    gap: 12,
  },
  listName: { flex: 1, fontFamily: fonts.semibold, fontSize: 16, color: colors.text },
  listStatus: { fontFamily: fonts.medium, fontSize: 13, color: colors.textSoft },
  listTime: { fontFamily: fonts.semibold, fontSize: 14, color: colors.text, minWidth: 64, textAlign: 'right' },
  hintBar: { alignItems: 'center', paddingBottom: 10 },
  hintText: { fontFamily: fonts.body, fontSize: 12, color: colors.textSoft },
});
