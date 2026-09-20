import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, View, useWindowDimensions } from 'react-native';
import { formatMoney } from '../domain/money';
import { uid } from '../domain/ops';
import type { Category, MenuItem } from '../domain/types';
import { useStore } from '../store/store';
import { Btn, Chip, Confirm, EmptyState, Field, Icon, Modal, toast } from '../ui/components';
import { colors, fonts } from '../ui/theme';

export function MenuScreen() {
  const data = useStore((s) => s.data);
  const upsertCategory = useStore((s) => s.upsertCategory);
  const deleteCategory = useStore((s) => s.deleteCategory);
  const upsertItem = useStore((s) => s.upsertItem);
  const deleteItem = useStore((s) => s.deleteItem);
  const { width } = useWindowDimensions();
  const narrow = width < 800;

  const categories = useMemo(() => Object.values(data.categories).sort((a, b) => a.sort - b.sort), [data.categories]);
  const [catId, setCatId] = useState<string | null>(null);
  const selected = catId && data.categories[catId] ? catId : categories[0]?.id ?? null;
  const items = useMemo(
    () =>
      Object.values(data.items)
        .filter((i) => i.categoryId === selected)
        .sort((a, b) => a.name.localeCompare(b.name)),
    [data.items, selected],
  );

  const [catModal, setCatModal] = useState<{ cat: Category | null } | null>(null);
  const [catName, setCatName] = useState('');
  const [itemModal, setItemModal] = useState<{ item: MenuItem | null } | null>(null);
  const [form, setForm] = useState({ name: '', code: '', price: '', active: true, categoryId: '' });
  const [delItem, setDelItem] = useState<MenuItem | null>(null);
  const [delCat, setDelCat] = useState<Category | null>(null);

  function openCat(cat: Category | null) {
    setCatName(cat?.name ?? '');
    setCatModal({ cat });
  }
  function saveCat() {
    const name = catName.trim();
    if (!name) return toast('Enter a category name.', 'error');
    if (catModal?.cat) upsertCategory({ ...catModal.cat, name });
    else {
      const id = uid('cat');
      upsertCategory({ id, name, sort: categories.reduce((m, c) => Math.max(m, c.sort), -1) + 1 });
      setCatId(id);
    }
    setCatModal(null);
  }

  function openItem(item: MenuItem | null) {
    if (!selected && !item) return toast('Add a category first.', 'error');
    setForm(
      item
        ? { name: item.name, code: item.code, price: String(item.price), active: item.active, categoryId: item.categoryId }
        : { name: '', code: '', price: '', active: true, categoryId: selected! },
    );
    setItemModal({ item });
  }
  function saveItem() {
    const name = form.name.trim();
    const price = Number(form.price);
    if (!name) return toast('Enter an item name.', 'error');
    if (!Number.isFinite(price) || price < 0 || form.price.trim() === '') return toast('Enter a valid price.', 'error');
    const existing = itemModal?.item;
    const code = form.code.trim() || `M${Object.keys(data.items).length + 1}`;
    const clash = Object.values(data.items).find((i) => i.code.toLowerCase() === code.toLowerCase() && i.id !== existing?.id);
    if (clash) return toast(`Item ID "${code}" is already used by ${clash.name}.`, 'error');
    upsertItem({
      id: existing?.id ?? uid('itm'),
      code,
      name,
      price: Math.round(price * 100) / 100,
      active: form.active,
      categoryId: form.categoryId,
    });
    setItemModal(null);
  }

  return (
    <View style={styles.root}>
      <Text style={styles.title}>Menu</Text>
      <View style={[styles.body, narrow && { flexDirection: 'column' }]}>
        <View style={[styles.cats, narrow && { width: '100%', maxHeight: 130 }]}>
          <ScrollView horizontal={narrow} showsHorizontalScrollIndicator={false}>
            <View style={narrow ? { flexDirection: 'row' } : undefined}>
              {categories.map((c) => (
                <View key={c.id} style={[styles.catRow, c.id === selected && styles.catRowActive]}>
                  <Pressable style={styles.catMain} onPress={() => setCatId(c.id)} accessibilityRole="button">
                    <Text style={[styles.catName, c.id === selected && { color: '#fff' }]} numberOfLines={1}>
                      {c.name}
                    </Text>
                  </Pressable>
                  <Pressable style={styles.iconBtn} onPress={() => openCat(c)} accessibilityLabel={`Rename ${c.name}`}>
                    <Icon name="edit-2" size={16} color={c.id === selected ? '#fff' : colors.textSoft} />
                  </Pressable>
                  <Pressable style={styles.iconBtn} onPress={() => setDelCat(c)} accessibilityLabel={`Delete ${c.name}`}>
                    <Icon name="trash-2" size={16} color={c.id === selected ? '#fff' : colors.red} />
                  </Pressable>
                </View>
              ))}
              <Btn small label="Category" icon="plus" variant="secondary" onPress={() => openCat(null)} style={{ margin: 6 }} />
            </View>
          </ScrollView>
        </View>
        <View style={styles.itemsCol}>
          <View style={styles.itemsHead}>
            <Text style={styles.sub}>{items.length} item(s)</Text>
            <Btn small label="Add item" icon="plus" onPress={() => openItem(null)} />
          </View>
          <ScrollView>
            {items.length === 0 ? <EmptyState icon="coffee" text="No items in this category yet." /> : null}
            {items.map((i) => (
              <Pressable key={i.id} style={[styles.itemRow, !i.active && { opacity: 0.55 }]} onPress={() => openItem(i)} accessibilityRole="button">
                <Text style={styles.code}>{i.code}</Text>
                <Text style={styles.name} numberOfLines={1}>
                  {i.name}
                </Text>
                {!i.active ? <Chip label="Hidden" /> : null}
                <Text style={styles.price}>{formatMoney(i.price)}</Text>
                <Pressable style={styles.iconBtn} onPress={() => setDelItem(i)} accessibilityLabel={`Delete ${i.name}`}>
                  <Icon name="trash-2" size={18} color={colors.red} />
                </Pressable>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      </View>

      <Modal visible={!!catModal} onClose={() => setCatModal(null)} title={catModal?.cat ? 'Rename category' : 'New category'} width={400}>
        <Field label="Name" value={catName} onChangeText={setCatName} autoFocus maxLength={30} />
        <Btn label="Save" full onPress={saveCat} />
      </Modal>

      <Modal visible={!!itemModal} onClose={() => setItemModal(null)} title={itemModal?.item ? 'Edit item' : 'New item'} width={460}>
        <Field label="Name" value={form.name} onChangeText={(t) => setForm({ ...form, name: t })} maxLength={50} />
        <Field label="Item ID (used in search)" value={form.code} onChangeText={(t) => setForm({ ...form, code: t })} placeholder="auto" maxLength={12} autoCapitalize="characters" />
        <Field label="Price (Rs)" value={form.price} onChangeText={(t) => setForm({ ...form, price: t.replace(/[^0-9.]/g, '') })} keyboardType="decimal-pad" />
        <Text style={styles.lbl}>Category</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12 }}>
          {categories.map((c) => (
            <Chip key={c.id} label={c.name} active={form.categoryId === c.id} onPress={() => setForm({ ...form, categoryId: c.id })} />
          ))}
        </ScrollView>
        <View style={styles.switchRow}>
          <Text style={styles.lbl}>Available on the Order screen</Text>
          <Switch value={form.active} onValueChange={(v) => setForm({ ...form, active: v })} trackColor={{ true: colors.primary }} />
        </View>
        <Btn label="Save item" full onPress={saveItem} />
      </Modal>

      <Confirm
        visible={!!delItem}
        title="Delete item?"
        message={`"${delItem?.name}" will be removed from the menu. Past bills keep their history.`}
        confirmLabel="Delete"
        danger
        onCancel={() => setDelItem(null)}
        onConfirm={() => {
          if (delItem) deleteItem(delItem.id);
          setDelItem(null);
        }}
      />
      <Confirm
        visible={!!delCat}
        title="Delete category?"
        message={`"${delCat?.name}" will be removed. It must be empty first.`}
        confirmLabel="Delete"
        danger
        onCancel={() => setDelCat(null)}
        onConfirm={() => {
          if (delCat) {
            const err = deleteCategory(delCat.id);
            if (err) toast(err, 'error');
          }
          setDelCat(null);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  title: { fontFamily: fonts.heading, fontSize: 34, color: colors.text, paddingHorizontal: 14, paddingTop: 10 },
  body: { flex: 1, flexDirection: 'row', padding: 12, gap: 12 },
  cats: { width: 250, backgroundColor: '#fff', borderRadius: 14, borderWidth: 1, borderColor: colors.border, padding: 6 },
  catRow: { flexDirection: 'row', alignItems: 'center', borderRadius: 10, minHeight: 48, marginBottom: 4 },
  catRowActive: { backgroundColor: colors.primary },
  catMain: { flex: 1, minHeight: 48, justifyContent: 'center', paddingLeft: 12 },
  catName: { fontFamily: fonts.semibold, fontSize: 15, color: colors.text },
  iconBtn: { width: 40, height: 44, alignItems: 'center', justifyContent: 'center' },
  itemsCol: { flex: 1, backgroundColor: '#fff', borderRadius: 14, borderWidth: 1, borderColor: colors.border, padding: 10 },
  itemsHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  sub: { fontFamily: fonts.medium, fontSize: 13, color: colors.textSoft },
  itemRow: { flexDirection: 'row', alignItems: 'center', minHeight: 56, borderBottomWidth: 1, borderBottomColor: colors.muted, gap: 10 },
  code: { fontFamily: fonts.medium, fontSize: 12, color: colors.textSoft, width: 48 },
  name: { flex: 1, fontFamily: fonts.semibold, fontSize: 15, color: colors.text },
  price: { fontFamily: fonts.bold, fontSize: 15, color: colors.primary, minWidth: 70, textAlign: 'right' },
  lbl: { fontFamily: fonts.medium, fontSize: 13, color: colors.textSoft, marginBottom: 6 },
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 },
});
