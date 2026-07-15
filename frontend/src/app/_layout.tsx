import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import 'react-native-reanimated';

// Geist — Inflo's primary typeface (task 6.7). The useFonts hook loads at runtime
// on iOS/Android AND web, and works in Expo Go (the config plugin is native-only,
// so the hook is the correct cross-platform path). One family per weight because RN
// selects weight by the font file, not `fontWeight`.
import { useFonts } from '@expo-google-fonts/geist/useFonts';
import { Geist_400Regular } from '@expo-google-fonts/geist/400Regular';
import { Geist_500Medium } from '@expo-google-fonts/geist/500Medium';
import { Geist_600SemiBold } from '@expo-google-fonts/geist/600SemiBold';
import { Geist_700Bold } from '@expo-google-fonts/geist/700Bold';
import { GeistMono_400Regular } from '@expo-google-fonts/geist-mono/400Regular';
// Marck Script — the ONE deliberate exception to Geist, used only for the
// typed-signature preview (task 7.9 follow-up). A script font reads as a real
// signature; it balances "personal handwritten" with "business document"
// per design-direction.md's brand personality (Trustworthy + Personal/warm).
import { MarckScript_400Regular } from '@expo-google-fonts/marck-script/400Regular';

import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAuthSession } from '@/hooks/use-auth-session';
import { useAuthStore } from '@/store/auth-store';

import '../../global.css';

import { GluestackUIProvider } from '@/components/ui/gluestack-ui-provider';

export const unstable_settings = {
  anchor: '(tabs)',
};

// Keep the splash up until Geist is ready, so there's no font-flash on either platform.
SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const colorScheme = useColorScheme();

  // Restore/track the auth session (populates the store; effect runs even while
  // this component returns null below, so the loader can't deadlock).
  useAuthSession();
  const session = useAuthStore((s) => s.session);
  const authLoading = useAuthStore((s) => s.isLoading);
  const onboarded = useAuthStore((s) => s.onboarded);

  const [fontsLoaded] = useFonts({
    Geist_400Regular,
    Geist_500Medium,
    Geist_600SemiBold,
    Geist_700Bold,
    GeistMono_400Regular,
    MarckScript_400Regular,
  });

  // Hold the splash until fonts + auth are ready AND — when signed in — the
  // onboarding status has resolved (onboarded !== null). Otherwise we'd flash the
  // wrong world (auth vs onboarding vs app).
  const ready = fontsLoaded && !authLoading && (!session || onboarded !== null);
  useEffect(() => {
    if (ready) {
      SplashScreen.hideAsync();
    }
  }, [ready]);

  if (!ready) {
    return null;
  }

  return (
    <GluestackUIProvider mode="light">
      <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
        {/* Three-way gated routing (expo-router redirects when a guard flips):
              • no session            → (auth)      sign up / log in
              • session, not onboarded → (onboarding) the wizard
              • session + onboarded    → (tabs)      the app shell            */}
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Protected guard={!!session && onboarded === true}>
            <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
            <Stack.Screen name="modal" options={{ presentation: 'modal', title: 'Modal' }} />
            {/* Discovery detail routes — siblings above the tabs, so Discover stays
                mounted underneath and its filters survive the round trip. */}
            <Stack.Screen name="creator/[id]" options={{ headerShown: false }} />
            <Stack.Screen name="brand/[id]" options={{ headerShown: false }} />
          </Stack.Protected>
          <Stack.Protected guard={!!session && onboarded === false}>
            <Stack.Screen name="(onboarding)" options={{ headerShown: false }} />
          </Stack.Protected>
          <Stack.Protected guard={!session}>
            <Stack.Screen name="(auth)" options={{ headerShown: false }} />
          </Stack.Protected>
        </Stack>
        <StatusBar style="auto" />
      </ThemeProvider>
    </GluestackUIProvider>
  );
}
