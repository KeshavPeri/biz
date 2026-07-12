import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';

import { TabPlaceholder } from '@/components/tab-placeholder';
import { testSupabaseConnection } from '@/lib/supabase';

// Discover — the default (`index`) tab. Placeholder shell (task 6.5); real
// discovery UI lands in Phase 8.
export default function DiscoverScreen() {
  // THROWAWAY Supabase connection smoke-test (task 6.6) — remove once real
  // Discover content lands. Runs once on mount, surfaces a small status line.
  const [status, setStatus] = useState('Checking Supabase…');

  useEffect(() => {
    let alive = true;
    testSupabaseConnection().then((r) => {
      if (alive) setStatus(r.message);
    });
    return () => {
      alive = false;
    };
  }, []);

  return (
    <TabPlaceholder title="Discover">
      <View className="mt-4 rounded-panel bg-surface-recess px-3 py-2">
        <Text className="font-geist-medium text-micro text-ink-3">
          Supabase check · {status}
        </Text>
      </View>
    </TabPlaceholder>
  );
}
