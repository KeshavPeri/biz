import { Stack } from 'expo-router';

// Sign-up is the default entry to the unauthenticated world; login is one tap away.
export const unstable_settings = {
  initialRouteName: 'sign-up',
};

// The unauthenticated world (Phase 7): sign-up, OTP verify, login. Each screen
// draws its own chrome via AuthShell, so the stack itself is headerless.
export default function AuthLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
