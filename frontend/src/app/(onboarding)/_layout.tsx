import { Stack } from 'expo-router';

// The onboarding wizard (Phase 7 Cluster B) — shown after a session exists but
// before the profile is complete. Role fork is the entry; each step draws its own
// chrome via AuthShell, so the stack is headerless.
export const unstable_settings = {
  initialRouteName: 'role',
};

export default function OnboardingLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
