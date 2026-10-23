import { Loading, Screen } from '@/components/ui';
import { NetAssetsPanel } from '@/components/home/panels';
import { useHomeData } from '@/components/home/useHomeData';

export default function NetAssetsScreen() {
  const { data } = useHomeData();
  if (!data) return <Loading />;
  return (
    <Screen>
      <NetAssetsPanel data={data} />
    </Screen>
  );
}
