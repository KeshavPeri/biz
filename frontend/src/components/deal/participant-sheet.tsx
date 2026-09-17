import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import * as Crypto from 'expo-crypto';

import { Button, ButtonSpinner, ButtonText } from '@/components/ui/button';
import { EditSheet } from '@/components/ui/edit-sheet';
import { Skeleton } from '@/components/motion/skeleton';
import {
  createParticipantRequest,
  decideParticipantRequest,
  fetchParticipantManagement,
  type ParticipantCandidate,
  type ParticipantManagementState,
  type ParticipantRole,
} from '@/lib/deals';

type BrandRole = Exclude<ParticipantRole, 'creator'>;
const roleLabels: Record<BrandRole, string> = {
  brand_admin: 'Brand admin',
  brand_maker: 'Brand maker',
  brand_checker: 'Brand checker',
};

export function ParticipantSheet({
  visible,
  dealId,
  accountId,
  refreshToken,
  onClose,
  onChanged,
}: {
  visible: boolean;
  dealId: string;
  accountId: string;
  refreshToken: number;
  onClose: () => void;
  onChanged: () => Promise<void>;
}) {
  const context = `${accountId}:${dealId}`;
  const generation = useRef(0);
  const currentContext = useRef(context);
  const [stateEnvelope, setStateEnvelope] = useState<{ context: string; data: ParticipantManagementState } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [candidate, setCandidate] = useState<ParticipantCandidate | null>(null);
  const [role, setRole] = useState<BrandRole | null>(null);
  const [reason, setReason] = useState('');
  const requestId = useRef<string | null>(null);
  const state = stateEnvelope?.context === context ? stateEnvelope.data : null;

  useEffect(() => {
    if (currentContext.current !== context) {
      currentContext.current = context;
      generation.current += 1;
    }
    setStateEnvelope(null);
    setError(null);
    setNotice(null);
    setBusy(false);
    setCandidate(null);
    setRole(null);
    setReason('');
    requestId.current = null;
  }, [context]);

  useEffect(() => {
    if (!visible) setNotice(null);
  }, [visible]);

  const load = useCallback(async () => {
    const ticket = { context, generation: generation.current };
    setLoading(true);
    setError(null);
    const result = await fetchParticipantManagement(dealId);
    if (currentContext.current !== ticket.context || generation.current !== ticket.generation) return;
    setLoading(false);
    if (result.ok) setStateEnvelope({ context: ticket.context, data: result.data });
    else setError(result.message);
  }, [context, dealId]);

  useEffect(() => {
    if (visible) void load();
  }, [visible, refreshToken, load]);

  const selectCandidate = (next: ParticipantCandidate) => {
    setCandidate(next);
    setRole(next.eligible_roles[0] ?? null);
    setError(null);
    setNotice(null);
    requestId.current = null;
  };

  const submit = async () => {
    if (!candidate || !role || !reason.trim() || busy) return;
    const ticket = { context, generation: generation.current };
    setBusy(true);
    setError(null);
    setNotice(null);
    requestId.current ??= Crypto.randomUUID();
    const result = await createParticipantRequest(dealId, {
      request_id: requestId.current,
      proposed_profile_id: candidate.id,
      proposed_role: role,
      reason: reason.trim(),
    });
    if (currentContext.current !== ticket.context || generation.current !== ticket.generation) return;
    setBusy(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setStateEnvelope({ context: ticket.context, data: result.data });
    setCandidate(null);
    setRole(null);
    setReason('');
    requestId.current = null;
    setNotice('Request sent for approval.');
    await onChanged();
  };

  const decide = async (decision: 'approved' | 'rejected') => {
    if (!state?.pending_request?.can_decide || busy) return;
    const ticket = { context, generation: generation.current };
    setBusy(true);
    setError(null);
    setNotice(null);
    const result = await decideParticipantRequest(dealId, state.pending_request.id, decision);
    if (currentContext.current !== ticket.context || generation.current !== ticket.generation) return;
    setBusy(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setStateEnvelope({ context: ticket.context, data: result.data });
    setNotice(
      decision === 'rejected'
        ? 'Request rejected.'
        : result.data.pending_request
          ? 'Approval recorded.'
          : 'Teammate added to the deal.',
    );
    await onChanged();
  };

  return (
    <EditSheet visible={visible} onClose={() => { if (!busy) onClose(); }} title="People in this deal" subtitle="Adding a teammate requires approval from everyone already here.">
      <ScrollView className="max-h-[68vh]" contentContainerClassName="gap-4 pb-4">
        {loading && !state ? (
          <View accessibilityLabel="Loading participants" className="gap-3">
            <Skeleton.Block width="60%" height={14} radius="pill" />
            <Skeleton.Block width="45%" height={12} radius="pill" />
            <Skeleton.Block width="55%" height={14} radius="pill" />
            <Skeleton.Block width="40%" height={12} radius="pill" />
          </View>
        ) : null}
        {notice ? <Text accessibilityLiveRegion="polite" className="font-geist-medium text-[12px] text-status-success">{notice}</Text> : null}
        {error ? (
          <View className="gap-2">
            <Text accessibilityRole="alert" className="font-geist text-[12px] text-status-critical">{error}</Text>
            {!state ? <Button action="secondary" onPress={() => { void load(); }} className="self-start"><ButtonText>Try again</ButtonText></Button> : null}
          </View>
        ) : null}

        {state?.participants.map((person, index) => (
          <View key={`${person.display_name}:${person.role}:${index}`} className="border-b border-hairline pb-3">
            <Text className="font-geist-semibold text-[13px] text-ink">{person.display_name}</Text>
            <Text className="mt-0.5 font-geist text-[11px] text-ink-2">{person.role_label}</Text>
          </View>
        ))}
        {state && state.participants.length === 0 ? <Text className="font-geist text-[12px] text-ink-2">No participants are available.</Text> : null}

        {state?.pending_request ? (
          <View className="gap-3 rounded-2xl border border-hairline bg-surface-card p-3">
            <View>
              <Text className="font-geist-semibold text-[13px] text-ink">Add {state.pending_request.proposed.display_name}</Text>
              <Text className="font-geist text-[11px] text-ink-2">{state.pending_request.proposed_role_label}</Text>
            </View>
            <Text className="font-geist text-[12px] leading-[18px] text-ink">{state.pending_request.reason}</Text>
            {state.pending_request.approvals.map((approval, index) => (
              <View key={`${approval.display_name}:${index}`} className="flex-row justify-between gap-3">
                <Text className="font-geist text-[11px] text-ink-2">{approval.display_name}</Text>
                <Text className="font-geist-medium text-[11px] capitalize text-ink">{approval.status}</Text>
              </View>
            ))}
            {state.pending_request.can_decide ? (
              <View className="flex-row gap-2 pt-1">
                <Button action="secondary" accessibilityLabel="Reject participant request" isDisabled={busy} onPress={() => { void decide('rejected'); }} className="flex-1"><ButtonText>Reject</ButtonText></Button>
                <Button action="primary" accessibilityLabel="Approve participant request" isDisabled={busy} onPress={() => { void decide('approved'); }} className="flex-1">{busy ? <ButtonSpinner /> : <ButtonText>Approve</ButtonText>}</Button>
              </View>
            ) : <Text className="font-geist text-[11px] text-ink-3">Waiting for the remaining participants.</Text>}
          </View>
        ) : null}

        {state?.available_actions.can_request ? (
          <View className="gap-3 rounded-2xl border border-hairline p-3">
            <Text className="font-geist-semibold text-[13px] text-ink">Request a teammate</Text>
            <View className="gap-2">
              {state.candidates.map((item) => (
                <Pressable key={item.id} accessibilityRole="button" accessibilityState={{ selected: candidate?.id === item.id }} onPress={() => selectCandidate(item)} className={`rounded-xl border px-3 py-2.5 ${candidate?.id === item.id ? 'border-ink bg-[#F3EFE7]' : 'border-hairline'}`}><Text className="font-geist-medium text-[12px] text-ink">{item.display_name}</Text></Pressable>
              ))}
            </View>
            {candidate ? (
              <>
                <View className="flex-row flex-wrap gap-2">
                  {candidate.eligible_roles.map((itemRole) => (
                    <Pressable key={itemRole} accessibilityRole="button" accessibilityState={{ selected: role === itemRole }} onPress={() => { setRole(itemRole); setError(null); requestId.current = null; }} className={`rounded-full border px-3 py-2 ${role === itemRole ? 'border-ink bg-ink' : 'border-hairline'}`}><Text className={`font-geist-medium text-[11px] ${role === itemRole ? 'text-white' : 'text-ink'}`}>{roleLabels[itemRole]}</Text></Pressable>
                  ))}
                </View>
                <TextInput value={reason} onChangeText={(value) => { setReason(value); setError(null); requestId.current = null; }} maxLength={500} multiline editable={!busy} accessibilityLabel="Reason for adding teammate" placeholder="Why should they join this deal?" placeholderTextColor="#847F78" className="min-h-24 rounded-xl border border-hairline px-3 py-2.5 font-geist text-[13px] text-ink" />
                <Button action="primary" accessibilityLabel="Send participant request" isDisabled={!reason.trim() || !role || busy} onPress={() => { void submit(); }}>{busy ? <ButtonSpinner /> : <ButtonText>Send request</ButtonText>}</Button>
              </>
            ) : null}
          </View>
        ) : state && !state.pending_request && state.stage === 'chatting' ? (
          <Text className="font-geist text-[11px] leading-[16px] text-ink-2">No eligible same-brand teammates are available, or terms are already locked.</Text>
        ) : null}
      </ScrollView>
    </EditSheet>
  );
}
