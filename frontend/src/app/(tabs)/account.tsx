import { useState } from 'react';
import { View } from 'react-native';

import { TabPlaceholder } from '@/components/tab-placeholder';
import { Button, ButtonSpinner, ButtonText } from '@/components/ui/button';
import { supabase } from '@/lib/supabase';

// Account — placeholder shell (task 6.5). Settings land in later phases; for now
// it hosts a temporary Log out control (7.4) so the whole auth loop is testable.
export default function AccountScreen() {
  const [signingOut, setSigningOut] = useState(false);

  const handleLogout = async () => {
    if (!supabase) return;
    setSigningOut(true);
    // signOut clears the session; onAuthStateChange then routes back to (auth).
    await supabase.auth.signOut();
    setSigningOut(false);
  };

  return (
    <TabPlaceholder title="Account">
      <View className="mt-6">
        <Button
          action="secondary"
          variant="outline"
          size="lg"
          isDisabled={signingOut}
          onPress={handleLogout}
        >
          {signingOut ? <ButtonSpinner color="#1C1B18" /> : null}
          <ButtonText>Log out</ButtonText>
        </Button>
      </View>
    </TabPlaceholder>
  );
}
