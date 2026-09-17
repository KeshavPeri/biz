import { useState } from 'react';
import { ScrollView, View } from 'react-native';

import { MakerCheckerConfig } from '@/components/maker-checker-config';
import { TabPlaceholder } from '@/components/tab-placeholder';
import { Button, ButtonSpinner, ButtonText } from '@/components/ui/button';
import { useTabBarInset } from '@/hooks/use-tab-bar-inset';
import { supabase } from '@/lib/supabase';

// Account — placeholder shell (task 6.5). Settings land in later phases; for now
// it hosts a temporary Log out control (7.4) so the whole auth loop is testable.
export default function AccountScreen() {
  const [signingOut, setSigningOut] = useState(false);
  const tabBarInset = useTabBarInset();

  const handleLogout = async () => {
    if (!supabase) return;
    setSigningOut(true);
    // signOut clears the session; onAuthStateChange then routes back to (auth).
    await supabase.auth.signOut();
    setSigningOut(false);
  };

  return (
    <TabPlaceholder title="Account">
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: tabBarInset + 16 }}
      >
        {/* Brand admins see maker-checker config here; renders nothing otherwise. */}
        <MakerCheckerConfig />

        <View className="mt-8">
          <Button
            action="secondary"
            size="md"
            isDisabled={signingOut}
            onPress={handleLogout}
          >
            {signingOut ? <ButtonSpinner /> : null}
            <ButtonText>Log out</ButtonText>
          </Button>
        </View>
      </ScrollView>
    </TabPlaceholder>
  );
}
