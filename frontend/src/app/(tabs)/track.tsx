import { SafeAreaView } from 'react-native-safe-area-context';

import ChartIcon from '@/assets/icons/line-chart.svg';
import { EmptyState } from '@/components/ui/empty-state';

// Track — placeholder shell (task 6.5); trackers land in Phase 11.
export default function TrackScreen() {
  return (
    <SafeAreaView className="flex-1 bg-app" edges={['top']}>
      <EmptyState
        Icon={ChartIcon}
        title="Track is coming together"
        description="Once your deals are live, this is where delivery, posting and payment progress will stay in view."
      />
    </SafeAreaView>
  );
}
