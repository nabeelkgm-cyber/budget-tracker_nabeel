import { router } from 'expo-router';
import { View } from 'react-native';
import { Button, Card, Divider, IconCircle, Loading, Row, Screen, SectionTitle } from '@/components/ui';
import { listCategories } from '@/db/repositories/categories';
import { useDbQuery } from '@/hooks/useDbQuery';
import type { Category, CategoryKind } from '@/types';

export default function CategoriesScreen() {
  const { data } = useDbQuery((db) => listCategories(db, { includeArchived: true }));
  if (!data) return <Loading />;

  const section = (kind: CategoryKind, archived: boolean) => {
    const parents = data.filter((c) => c.kind === kind && !c.parent_id);
    const rows: { c: Category; depth: number }[] = [];
    for (const p of parents) {
      rows.push({ c: p, depth: 0 });
      for (const s of data.filter((c) => c.parent_id === p.id)) rows.push({ c: s, depth: 1 });
    }
    const shown = rows.filter((r) => !!r.c.is_archived === archived);
    if (!shown.length) return null;
    return (
      <Card>
        {shown.map(({ c, depth }, i) => (
          <View key={c.id}>
            {i > 0 ? <Divider /> : null}
            <View style={{ paddingLeft: depth * 28 }}>
              <Row
                muted={archived}
                onPress={() => router.push(`/categories/${c.id}`)}
                left={<IconCircle icon={c.icon} color={c.color} size={depth ? 30 : 40} />}
                title={c.name}
              />
            </View>
          </View>
        ))}
      </Card>
    );
  };

  return (
    <Screen>
      <Button title="+ Add category" onPress={() => router.push('/categories/new')} />
      <SectionTitle>Expense</SectionTitle>
      {section('expense', false)}
      <SectionTitle>Income</SectionTitle>
      {section('income', false)}
      {data.some((c) => c.is_archived) ? (
        <>
          <SectionTitle>Archived</SectionTitle>
          {section('expense', true)}
          {section('income', true)}
        </>
      ) : null}
    </Screen>
  );
}
