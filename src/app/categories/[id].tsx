import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useState } from 'react';
import { Alert, Switch, Text, View } from 'react-native';
import { Button, Chip, ChipRow, ColorPicker, Field, IconPicker, Label, Loading, Screen, Segmented } from '@/components/ui';
import { createCategory, getCategory, listCategories, setCategoryArchived, updateCategory } from '@/db/repositories/categories';
import { useDbQuery } from '@/hooks/useDbQuery';
import { COLOR_CHOICES, useTheme } from '@/theme';
import type { CategoryKind } from '@/types';

export default function CategoryForm() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const isNew = id === 'new';
  const db = useSQLiteContext();
  const t = useTheme();
  const { data: all } = useDbQuery((d) => listCategories(d));

  const [loaded, setLoaded] = useState(isNew);
  const [name, setName] = useState('');
  const [kind, setKind] = useState<CategoryKind>('expense');
  const [parentId, setParentId] = useState<string | null>(null);
  const [icon, setIcon] = useState('pricetag');
  const [color, setColor] = useState(COLOR_CHOICES[0]);
  const [isSavings, setIsSavings] = useState(false);
  const [archived, setArchived] = useState(false);
  const [hasParent, setHasParent] = useState(false);

  useEffect(() => {
    if (isNew) return;
    getCategory(db, id).then((c) => {
      if (!c) return router.back();
      setName(c.name);
      setKind(c.kind);
      setParentId(c.parent_id);
      setHasParent(!!c.parent_id);
      setIcon(c.icon);
      setColor(c.color);
      setIsSavings(!!c.is_savings);
      setArchived(!!c.is_archived);
      setLoaded(true);
    });
  }, [db, id, isNew]);

  if (!loaded || !all) return <Loading />;
  const parents = all.filter((c) => c.kind === kind && !c.parent_id && c.id !== id);

  const save = async () => {
    if (!name.trim()) return Alert.alert('Name needed', 'Give the category a name.');
    try {
      if (isNew) await createCategory(db, { name, kind, parentId, icon, color, isSavings });
      else await updateCategory(db, id, { name, icon, color, isSavings });
      router.back();
    } catch (e) {
      Alert.alert('Could not save', String(e instanceof Error ? e.message : e));
    }
  };

  const toggleArchive = async () => {
    await setCategoryArchived(db, id, !archived);
    router.back();
  };

  return (
    <Screen>
      <Stack.Screen options={{ title: isNew ? 'New category' : 'Edit category' }} />
      {isNew ? (
        <Segmented
          value={kind}
          onChange={(k) => {
            setKind(k);
            setParentId(null);
          }}
          options={[
            { value: 'expense', label: 'Expense', color: t.expense },
            { value: 'income', label: 'Income', color: t.income },
          ]}
        />
      ) : null}
      <Field label="Name" value={name} onChangeText={setName} placeholder="e.g. Eating out" />

      {isNew || hasParent ? (
        <>
          <Label>Sub-category of {isNew ? '' : '(cannot be moved)'}</Label>
          <ChipRow>
            {isNew ? <Chip label="None (main category)" selected={parentId === null} onPress={() => setParentId(null)} /> : null}
            {parents
              .filter((p) => isNew || p.id === parentId)
              .map((p) => (
                <Chip key={p.id} label={p.name} selected={parentId === p.id} onPress={() => isNew && setParentId(p.id)} />
              ))}
          </ChipRow>
        </>
      ) : null}

      {kind === 'expense' ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 16, gap: 12 }}>
          <View style={{ flex: 1 }}>
            <Text style={{ color: t.text, fontWeight: '600' }}>Counts as savings</Text>
            <Text style={{ color: t.textMuted, fontSize: 12 }}>
              Still budgeted as an expense, but added back when the savings rate is calculated.
            </Text>
          </View>
          <Switch value={isSavings} onValueChange={setIsSavings} />
        </View>
      ) : null}

      <Label>Icon</Label>
      <IconPicker value={icon} color={color} onChange={setIcon} />
      <Label>Colour</Label>
      <ColorPicker value={color} onChange={setColor} />

      <Button title={isNew ? 'Add category' : 'Save changes'} onPress={save} />
      {!isNew ? (
        <>
          <Button title={archived ? 'Restore category' : 'Archive category'} kind="secondary" onPress={toggleArchive} />
          <Text style={{ color: t.textMuted, fontSize: 12 }}>
            Archived categories disappear from the add screen but stay on past transactions.
          </Text>
        </>
      ) : null}
    </Screen>
  );
}
