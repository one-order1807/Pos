import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { EVENT_TYPES, type Customer, type EventType } from '../domain/types';
import { filterUsers, usersToRows, type EventFilter } from '../domain/users';
import { useStore } from '../store/store';
import { Btn, Chip, Confirm, EmptyState, Field, Icon, Modal, toast } from '../ui/components';
import { colors, fonts } from '../ui/theme';
import { buildXlsx } from '../util/xlsx';
import { shareBinary } from '../util/files';


export function UsersScreen() {
  const customers = useStore((s) => s.data.customers);
  const saveCustomer = useStore((s) => s.saveCustomer);
  const deleteCustomer = useStore((s) => s.deleteCustomer);

  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<EventFilter>('all');
  const [editing, setEditing] = useState<{ user: Customer | null } | null>(null);
  const [form, setForm] = useState<{ name: string; phone: string; event: EventType | '' }>({ name: '', phone: '', event: '' });
  const [deleting, setDeleting] = useState<Customer | null>(null);
  const [busy, setBusy] = useState(false);

  const list = useMemo(() => filterUsers(customers, query, filter), [customers, query, filter]);

  function openEditor(user: Customer | null) {
    setForm(user ? { name: user.name, phone: user.phone, event: user.event ?? '' } : { name: '', phone: '', event: '' });
    setEditing({ user });
  }

  function save() {
    const err = saveCustomer({ oldId: editing?.user?.id, name: form.name, phone: form.phone, event: form.event });
    if (err) toast(err, 'error');
    else {
      toast(editing?.user ? 'User updated.' : 'User added.', 'success');
      setEditing(null);
    }
  }

  async function exportExcel() {
    if (busy) return;
    if (list.length === 0) {
      toast('No users to export.');
      return;
    }
    setBusy(true);
    try {
      const { headers, rows } = usersToRows(list);
      const bytes = buildXlsx('Users', headers, rows);
      await shareBinary(
        `oneorder-users-${new Date().toISOString().slice(0, 10)}.xlsx`,
        bytes,
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      );
    } catch (e: any) {
      toast(e?.message ?? 'Export failed.', 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.root}>
      <View style={styles.head}>
        <Text style={styles.title}>Users</Text>
        <View style={styles.headBtns}>
          <Btn small label={`Export Excel (${list.length})`} icon="download" variant="secondary" onPress={exportExcel} disabled={busy} />
          <Btn small label="Add user" icon="user-plus" onPress={() => openEditor(null)} />
        </View>
      </View>

      <View style={styles.tools}>
        <View style={styles.searchWrap}>
          <Icon name="search" size={18} color={colors.textSoft} />
          <TextInput
            style={styles.search}
            placeholder="Search name or phone"
            placeholderTextColor="#94A3B8"
            value={query}
            onChangeText={setQuery}
          />
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }}>
          <Chip label="All" active={filter === 'all'} onPress={() => setFilter('all')} />
          {EVENT_TYPES.map((e) => (
            <Chip key={e} label={e} active={filter === e} onPress={() => setFilter(e)} />
          ))}
          <Chip label="No event" active={filter === 'none'} onPress={() => setFilter('none')} />
        </ScrollView>
      </View>

      <View style={styles.tableHead}>
        <Text style={[styles.th, { width: 56 }]}>Sr. No.</Text>
        <Text style={[styles.th, { flex: 1.4 }]}>Name</Text>
        <Text style={[styles.th, { flex: 1 }]}>Phone</Text>
        <Text style={[styles.th, { width: 120 }]}>Event</Text>
        <View style={{ width: 44 }} />
      </View>
      <ScrollView contentContainerStyle={{ paddingHorizontal: 12, paddingBottom: 24 }}>
        {list.length === 0 ? (
          <EmptyState
            icon="users"
            text={Object.keys(customers).length === 0 ? 'No users yet. Add one, or enter a phone number at payment.' : 'No users match this filter.'}
          />
        ) : null}
        {list.map((u, i) => (
          <Pressable key={u.id} style={styles.row} onPress={() => openEditor(u)} accessibilityRole="button" accessibilityLabel={`Edit ${u.name || u.phone}`}>
            <Text style={[styles.td, { width: 56 }]}>{i + 1}</Text>
            <Text style={[styles.tdBold, { flex: 1.4 }]} numberOfLines={1}>
              {u.name || '—'}
            </Text>
            <Text style={[styles.td, { flex: 1 }]} numberOfLines={1}>
              {u.phone || '—'}
            </Text>
            <View style={{ width: 120 }}>
              {u.event ? (
                <View style={styles.pill}>
                  <Text style={styles.pillText}>{u.event}</Text>
                </View>
              ) : (
                <Text style={styles.td}>—</Text>
              )}
            </View>
            <Pressable style={styles.del} onPress={() => setDeleting(u)} accessibilityLabel={`Delete ${u.name || u.phone}`}>
              <Icon name="trash-2" size={18} color={colors.red} />
            </Pressable>
          </Pressable>
        ))}
      </ScrollView>

      <Modal visible={!!editing} onClose={() => setEditing(null)} title={editing?.user ? 'Edit user' : 'Add user'} width={460}>
        <Field label="Name" value={form.name} onChangeText={(t) => setForm({ ...form, name: t })} maxLength={50} autoFocus />
        <Field
          label="Phone"
          value={form.phone}
          onChangeText={(t) => setForm({ ...form, phone: t.replace(/[^0-9+]/g, '') })}
          keyboardType="phone-pad"
          maxLength={15}
        />
        <Text style={styles.lbl}>Event</Text>
        <View style={styles.eventRow}>
          {EVENT_TYPES.map((e) => (
            <Chip key={e} label={e} active={form.event === e} onPress={() => setForm({ ...form, event: form.event === e ? '' : e })} />
          ))}
        </View>
        <Btn label="Save" full icon="check" onPress={save} />
      </Modal>

      <Confirm
        visible={!!deleting}
        title="Delete user?"
        message={`"${deleting?.name || deleting?.phone}" will be removed from the Users list. Past orders keep their history.`}
        confirmLabel="Delete"
        danger
        onCancel={() => setDeleting(null)}
        onConfirm={() => {
          if (deleting) deleteCustomer(deleting.id);
          setDeleting(null);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, paddingHorizontal: 14, paddingTop: 10 },
  headBtns: { flexDirection: 'row', gap: 8 },
  title: { fontFamily: fonts.heading, fontSize: 34, color: colors.text },
  tools: { paddingHorizontal: 12, paddingVertical: 10, gap: 8 },
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.white,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    paddingLeft: 12,
    minHeight: 48,
  },
  search: { flex: 1, minHeight: 48, paddingHorizontal: 10, fontFamily: fonts.body, fontSize: 15, color: colors.text },
  tableHead: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 24, paddingBottom: 6, gap: 10 },
  th: { fontFamily: fonts.semibold, fontSize: 12, color: colors.textSoft, textTransform: 'uppercase', letterSpacing: 0.4 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 56,
    backgroundColor: '#fff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 12,
    marginBottom: 8,
  },
  td: { fontFamily: fonts.body, fontSize: 14, color: colors.text },
  tdBold: { fontFamily: fonts.semibold, fontSize: 15, color: colors.text },
  pill: { alignSelf: 'flex-start', backgroundColor: colors.primaryTint, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 3 },
  pillText: { fontFamily: fonts.semibold, fontSize: 12, color: colors.primaryDark },
  del: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  lbl: { fontFamily: fonts.medium, fontSize: 13, color: colors.textSoft, marginBottom: 8 },
  eventRow: { flexDirection: 'row', flexWrap: 'wrap', rowGap: 8, marginBottom: 14 },
});
