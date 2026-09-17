import { useEffect, useRef, useState } from 'react';
import { Alert, Pressable, Text, TextInput, View } from 'react-native';
import * as Crypto from 'expo-crypto';

import { WinSpring } from '@/components/motion/win-spring';
import { Button, ButtonSpinner, ButtonText } from '@/components/ui/button';
import { EditSheet } from '@/components/ui/edit-sheet';

type Result = { ok: true } | { ok: false; message: string };

export function RatingSheet({
  visible,
  dealId,
  accountId,
  onClose,
  onSubmit,
}: {
  visible: boolean;
  dealId: string;
  accountId: string;
  onClose: () => void;
  onSubmit: (score: number, review: string | null, requestId: string) => Promise<Result>;
}) {
  const [score, setScore] = useState(0);
  const [review, setReview] = useState('');
  const [busy, setBusy] = useState(false);
  const [justSubmitted, setJustSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef<string | null>(null);

  useEffect(() => {
    setScore(0);
    setReview('');
    setBusy(false);
    setJustSubmitted(false);
    setError(null);
    requestId.current = null;
  }, [accountId, dealId, visible]);

  const trimmed = review.trim();
  const valid = score >= 1 && score <= 5 && trimmed.length <= 1000;
  const submit = async () => {
    if (busy || !valid) return;
    setBusy(true);
    setError(null);
    requestId.current ??= Crypto.randomUUID();
    const result = await onSubmit(score, trimmed || null, requestId.current);
    if (result.ok) {
      requestId.current = null;
      // Rating is a close-out moment (B2-66/decision 6) — let the win spring
      // play before the sheet dismisses, instead of closing instantly.
      setJustSubmitted(true);
      setTimeout(() => {
        setBusy(false);
        setScore(0);
        setReview('');
        setJustSubmitted(false);
        onClose();
      }, 380);
    } else {
      setBusy(false);
      setError(result.message);
    }
  };
  const confirm = () => {
    if (!valid || busy) return;
    Alert.alert(
      'Submit final rating?',
      'Your score and optional review cannot be edited or deleted after submission.',
      [
        { text: 'Review', style: 'cancel' },
        { text: 'Submit rating', onPress: () => { void submit(); } },
      ],
    );
  };

  return (
    <EditSheet
      visible={visible}
      onClose={() => { if (!busy) onClose(); }}
      title="Leave a final rating"
      subtitle="Choose 1–5 stars. Your side can submit only once."
      footer={(
        <Button action="primary" size="lg" accessibilityLabel="Review and submit final rating" isDisabled={!valid || busy} onPress={confirm}>
          {busy ? <ButtonSpinner /> : <ButtonText>Submit final rating</ButtonText>}
        </Button>
      )}
    >
      <View className="gap-4">
        <View>
          <Text className="mb-2 font-geist-semibold text-[12px] text-ink">Score</Text>
          <WinSpring trigger={justSubmitted}>
            <View className="flex-row gap-2">
              {[1, 2, 3, 4, 5].map((value) => (
                <Pressable key={value} accessibilityRole="button" accessibilityLabel={`${value} star${value === 1 ? '' : 's'}`} accessibilityState={{ selected: score === value }} onPress={() => { setScore(value); setError(null); }} disabled={busy} className={`h-11 w-11 items-center justify-center rounded-full border ${score >= value ? 'border-ink bg-ink' : 'border-hairline bg-surface-card'}`}>
                  <Text className={`font-geist-semibold text-[16px] ${score >= value ? 'text-white' : 'text-ink-2'}`}>★</Text>
                </Pressable>
              ))}
            </View>
          </WinSpring>
        </View>
        <View>
          <Text className="mb-1.5 font-geist-semibold text-[12px] text-ink">Optional review</Text>
          <TextInput value={review} onChangeText={(value) => { setReview(value); setError(null); }} editable={!busy} multiline maxLength={1000} accessibilityLabel="Optional plain-text review, up to 1,000 characters" placeholder="Share a concise review…" placeholderTextColor="#847F78" className="min-h-28 rounded-xl border border-hairline bg-surface-card px-3 py-3 font-geist text-[13px] leading-[19px] text-ink" />
          <Text className="mt-1 text-right font-geist text-[10.5px] text-ink-3">{trimmed.length}/1,000</Text>
        </View>
        <Text className="font-geist text-[10.5px] leading-[15px] text-ink-2">Plain text only. Links and markup are not accepted.</Text>
        {error ? <Text accessibilityRole="alert" className="font-geist-medium text-[11px] leading-[16px] text-status-critical">{error}</Text> : null}
      </View>
    </EditSheet>
  );
}
