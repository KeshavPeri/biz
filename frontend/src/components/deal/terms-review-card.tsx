import { useState } from 'react';
import { ScrollView, Text, TextInput, View } from 'react-native';

import { Button, ButtonText } from '@/components/ui/button';
import type { TermsReviewState } from '@/lib/deals';

type Summary = NonNullable<TermsReviewState['summary']>;

export function TermsReviewCard({
  summary,
  userId,
  readOnly,
  acting,
  error,
  onDecision,
}: {
  summary: Summary;
  userId: string;
  readOnly: boolean;
  acting: boolean;
  error: string | null;
  onDecision: (decision: 'approved' | 'issue_raised', comment?: string) => void;
}) {
  const [requestingChanges, setRequestingChanges] = useState(false);
  const [comment, setComment] = useState('');
  const me = summary.approvers.find((item) => item.profile_id === userId);
  const blocked = summary.unresolved_fields.length > 0;

  return (
    <View className="gap-2.5 rounded-2xl border border-hairline bg-surface-card p-3">
      <View className="flex-row items-start justify-between gap-3">
        <View className="min-w-0 flex-1">
          <Text className="font-geist-semibold text-[14px] text-ink">Terms summary</Text>
          <Text className="mt-0.5 font-geist text-[11px] text-ink-3">
            22 extracted fields · {readOnly ? 'confirmed record' : 'review every field before deciding'}
          </Text>
        </View>
        <Text className={`font-geist-semibold text-[11px] ${summary.status === 'approved' ? 'text-status-good-label' : 'text-ink-3'}`}>
          {summary.status === 'approved' ? 'Approved' : 'Review'}
        </Text>
      </View>

      <ApproverChecklist summary={summary} />

      {!readOnly ? (
        <ScrollView className="max-h-[320px] rounded-xl bg-surface-recess" nestedScrollEnabled>
          <View className="p-3">
            {summary.fields.map((field, index) => (
              <View key={field.key} className={index === 0 ? '' : 'mt-3 border-t border-hairline pt-3'}>
                <View className="flex-row items-start justify-between gap-2">
                  <Text className="min-w-0 flex-1 font-geist-semibold text-[12px] text-ink">{field.label}</Text>
                  <Text className={`font-geist-semibold text-[10px] ${field.blocks_approval ? 'text-status-critical' : field.status === 'found' ? 'text-status-good-label' : 'text-ink-3'}`}>
                    {!field.applicable ? 'Not applicable' : field.status === 'found' ? 'Found' : field.status === 'ambiguous' ? 'Ambiguous' : 'Not discussed'}
                  </Text>
                </View>
                {field.applicable && field.status === 'found' ? (
                  <Text selectable className="mt-1 font-geist text-[12px] leading-[17px] text-ink-2">{displayValue(field.value)}</Text>
                ) : field.blocks_approval ? (
                  <Text className="mt-1 font-geist text-[11px] text-status-critical">Clarify this in chat, then request changes.</Text>
                ) : null}
                {field.evidence.map((item) => (
                  <Text key={`${field.key}:${item.message_id}:${item.quote}`} selectable className="mt-1 font-geist text-[10.5px] italic text-ink-3">
                    “{item.quote}”
                  </Text>
                ))}
              </View>
            ))}
          </View>
        </ScrollView>
      ) : null}

      {!readOnly && blocked ? (
        <View className="rounded-xl bg-status-critical-tint px-3 py-2">
          <Text className="font-geist-medium text-[11px] text-status-critical">
            {summary.unresolved_fields.length} applicable field{summary.unresolved_fields.length === 1 ? '' : 's'} must be clarified before approval.
          </Text>
        </View>
      ) : null}

      {!readOnly && requestingChanges ? (
        <View className="gap-2">
          <TextInput
            value={comment}
            onChangeText={setComment}
            placeholder="What needs to change?"
            placeholderTextColor="#847F78"
            maxLength={1000}
            multiline
            className="min-h-[72px] rounded-xl border border-hairline bg-app px-3 py-2 font-geist text-[13px] text-ink"
          />
          <View className="flex-row gap-2">
            <ActionButton label="Cancel" kind="ghost" disabled={acting} onPress={() => setRequestingChanges(false)} />
            <ActionButton
              label={acting ? 'Sending…' : 'Send request'}
              kind="primary"
              disabled={acting || !comment.trim()}
              onPress={() => onDecision('issue_raised', comment)}
            />
          </View>
        </View>
      ) : !readOnly ? (
        <View className="flex-row gap-2">
          <ActionButton label="Request changes" kind="ghost" disabled={acting} onPress={() => setRequestingChanges(true)} />
          <ActionButton
            label={me?.status === 'approved' ? 'Approved' : acting ? 'Saving…' : 'Approve summary'}
            kind="primary"
            disabled={acting || blocked || me?.status === 'approved'}
            onPress={() => onDecision('approved')}
          />
        </View>
      ) : null}
      {error ? <Text className="font-geist text-[12px] text-status-critical">{error}</Text> : null}
    </View>
  );
}

export function ApproverChecklist({ summary }: { summary: Summary }) {
  return (
    <View className="rounded-xl bg-surface-recess px-3 py-2">
      {summary.approvers.map((approver, index) => (
        <View key={approver.profile_id} className={`flex-row items-start justify-between gap-3 ${index === 0 ? '' : 'mt-2 border-t border-hairline pt-2'}`}>
          <View className="min-w-0 flex-1">
            <Text className="font-geist-semibold text-[11.5px] text-ink" numberOfLines={1}>{approver.display_name}</Text>
            <Text className="font-geist text-[10px] text-ink-3">{roleLabel(approver.role)}</Text>
            {approver.comment ? <Text className="mt-0.5 font-geist text-[10.5px] text-ink-2">{approver.comment}</Text> : null}
          </View>
          <Text className={`font-geist-semibold text-[10.5px] ${approver.status === 'approved' ? 'text-status-good-label' : approver.status === 'changes_requested' ? 'text-status-critical' : 'text-ink-3'}`}>
            {approver.status === 'approved' ? 'Approved' : approver.status === 'changes_requested' ? 'Changes requested' : 'Pending'}
          </Text>
        </View>
      ))}
    </View>
  );
}

function ActionButton({
  label,
  kind,
  disabled,
  onPress,
}: {
  label: string;
  kind: 'primary' | 'ghost';
  disabled: boolean;
  onPress: () => void;
}) {
  return (
    <Button
      action={kind === 'primary' ? 'primary' : 'secondary'}
      onPress={onPress}
      isDisabled={disabled}
      accessibilityLabel={label}
      className="flex-1 px-3"
    >
      <ButtonText>{label}</ButtonText>
    </Button>
  );
}

function displayValue(value: unknown): string {
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  return JSON.stringify(value, null, 2);
}

function roleLabel(role: string): string {
  return role.split('_').map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(' ');
}
