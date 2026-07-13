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

  const [fontsLoaded] = useFonts({
    Geist_400Regular,
    Geist_500Medium,
    Geist_600SemiBold,
    Geist_700Bold,
    GeistMono_400Regular,
  });

  // Hold the splash until BOTH fonts and the session are ready — no font-flash,
  // and no flash of the wrong (auth vs app) screen.
  const ready = fontsLoaded && !authLoading;
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
        {/* Auth-gated routing: logged-in users reach the app shell; logged-out
            users reach the (auth) world. expo-router redirects when the guard
            flips (e.g. right after OTP verify or logout). */}
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Protected guard={!!session}>
            <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
            <Stack.Screen name="modal" options={{ presentation: 'modal', title: 'Modal' }} />
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
