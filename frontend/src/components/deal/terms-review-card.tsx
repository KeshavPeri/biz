import { useCallback, useEffect, useRef, useState } from 'react';
import { Text, TextInput, View } from 'react-native';

import CheckIcon from '@/assets/icons/check.svg';
import { Button, ButtonSpinner, ButtonText } from '@/components/ui/button';
import { EditSheet } from '@/components/ui/edit-sheet';
import type { TermsReviewState } from '@/lib/deals';

type Summary = NonNullable<TermsReviewState['summary']>;

/**
 * TermsReviewCard — the compact record inside the action bar. The 22-field review
 * itself opens in its own sheet with a sticky decision bar (B2-50), so the fields
 * are never a nested scroller hiding 20 rows below the fold on the screen where
 * terms bind.
 */
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
  const [reviewOpen, setReviewOpen] = useState(false);
  const me = summary.approvers.find((item) => item.profile_id === userId);
  const approvedByMe = me?.status === 'approved';
  const decided = me?.status === 'approved' || me?.status === 'changes_requested';
  const blocked = summary.unresolved_fields.length > 0;
  const fieldCount = summary.fields.length;

  return (
    <View className="gap-2.5 rounded-2xl border border-hairline bg-surface-card p-3">
      <View className="flex-row items-start justify-between gap-3">
        <View className="min-w-0 flex-1">
          <Text className="font-geist-semibold text-subtitle text-ink">Terms summary</Text>
          <Text className="mt-0.5 font-geist text-micro tabular-nums text-ink-3">
            {fieldCount} extracted fields · {readOnly ? 'confirmed record' : 'review every field before deciding'}
          </Text>
        </View>
        <Text className={`font-geist-semibold text-micro ${summary.status === 'approved' ? 'text-status-good-label' : 'text-ink-3'}`}>
          {summary.status === 'approved' ? 'Approved' : 'Review'}
        </Text>
      </View>

      <ApproverChecklist summary={summary} />

      {!readOnly && blocked ? (
        <View className="flex-row items-start gap-2 rounded-panel bg-surface-recess px-3 py-2">
          <View className="mt-1.5 h-2 w-2 rounded-full bg-status-critical" />
          <Text className="flex-1 font-geist-medium text-micro tabular-nums text-status-critical">
            {summary.unresolved_fields.length} applicable field{summary.unresolved_fields.length === 1 ? '' : 's'} must be clarified before approval.
          </Text>
        </View>
      ) : null}

      <Button
        action={!readOnly && !approvedByMe ? 'primary' : 'secondary'}
        onPress={() => setReviewOpen(true)}
        accessibilityLabel={`Review all ${fieldCount} extracted terms`}
      >
        <ButtonText>{readOnly ? `View ${fieldCount} terms` : `Review ${fieldCount} terms`}</ButtonText>
      </Button>

      {!readOnly && approvedByMe ? (
        <View className="flex-row items-center gap-1.5">
          <CheckIcon width={16} height={16} color="#4F7A1E" />
          <Text className="font-geist-medium text-secondary text-status-good-label">You approved this summary</Text>
        </View>
      ) : null}

      {error ? <Text className="font-geist text-secondary text-status-critical">{error}</Text> : null}

      <TermsReviewSheet
        visible={reviewOpen}
        summary={summary}
        readOnly={readOnly}
        approvedByMe={approvedByMe}
        decided={decided}
        blocked={blocked}
        acting={acting}
        onClose={() => setReviewOpen(false)}
        onDecision={onDecision}
      />
    </View>
  );
}

/** The 22 fields, full height, with the decision bar pinned under them. */
function TermsReviewSheet({
  visible,
  summary,
  readOnly,
  approvedByMe,
  decided,
  blocked,
  acting,
  onClose,
  onDecision,
}: {
  visible: boolean;
  summary: Summary;
  readOnly: boolean;
  approvedByMe: boolean;
  decided: boolean;
  blocked: boolean;
  acting: boolean;
  onClose: () => void;
  onDecision: (decision: 'approved' | 'issue_raised', comment?: string) => void;
}) {
  const [requestingChanges, setRequestingChanges] = useState(false);
  const [comment, setComment] = useState('');

  const dismiss = useCallback(() => {
    setRequestingChanges(false);
    setComment('');
    onClose();
  }, [onClose]);

  const close = () => {
    if (acting) return;
    dismiss();
  };

  // My decision landed on the server: hand the room back instead of leaving the
  // field list open on a decision that is already made.
  const decidedAtOpen = useRef<boolean | null>(null);
  useEffect(() => {
    if (!visible) {
      decidedAtOpen.current = null;
      return;
    }
    if (decidedAtOpen.current === null) {
      decidedAtOpen.current = decided;
      return;
    }
    if (decided && !decidedAtOpen.current) dismiss();
  }, [decided, dismiss, visible]);

  return (
    <EditSheet
      visible={visible}
      onClose={close}
      title="Terms summary"
      subtitle={
        readOnly
          ? `${summary.fields.length} fields, as confirmed by both sides.`
          : `Check all ${summary.fields.length} fields. These terms bind once both sides approve.`
      }
      footer={
        readOnly ? (
          <Button action="secondary" size="lg" onPress={close} accessibilityLabel="Close the terms summary">
            <ButtonText>Done</ButtonText>
          </Button>
        ) : requestingChanges ? (
          <View className="gap-2">
            <TextInput
              value={comment}
              onChangeText={setComment}
              placeholder="What needs to change?"
              placeholderTextColor="#847F78"
              maxLength={1000}
              multiline
              className="min-h-[72px] rounded-input border border-hairline bg-app px-3 py-2 font-geist text-body text-ink"
            />
            <View className="flex-row gap-2">
              <Button
                action="secondary"
                onPress={() => setRequestingChanges(false)}
                isDisabled={acting}
                className="flex-1 px-3"
                accessibilityLabel="Cancel the change request"
              >
                <ButtonText>Cancel</ButtonText>
              </Button>
              <Button
                action="primary"
                onPress={() => onDecision('issue_raised', comment)}
                isDisabled={acting || !comment.trim()}
                className="flex-1 px-3"
                accessibilityLabel="Send the change request"
              >
                {acting ? <ButtonSpinner size="small" /> : null}
                <ButtonText>Send request</ButtonText>
              </Button>
            </View>
          </View>
        ) : approvedByMe ? (
          <View className="flex-row items-center gap-1.5">
            <CheckIcon width={16} height={16} color="#4F7A1E" />
            <Text className="font-geist-medium text-secondary text-status-good-label">You approved this summary</Text>
          </View>
        ) : (
          <View className="flex-row gap-2">
            <Button
              action="secondary"
              onPress={() => setRequestingChanges(true)}
              isDisabled={acting}
              className="flex-1 px-3"
              accessibilityLabel="Request changes to these terms"
            >
              <ButtonText>Request changes</ButtonText>
            </Button>
            <Button
              action="primary"
              onPress={() => onDecision('approved')}
              isDisabled={acting || blocked}
              className="flex-1 px-3"
              accessibilityLabel="Approve this terms summary"
            >
              {acting ? <ButtonSpinner size="small" /> : null}
              <ButtonText>Approve summary</ButtonText>
            </Button>
          </View>
        )
      }
    >
      <View className="gap-2.5">
        {!readOnly && blocked ? (
          <View className="flex-row items-start gap-2 rounded-panel bg-surface-recess px-3 py-2">
            <View className="mt-1.5 h-2 w-2 rounded-full bg-status-critical" />
            <Text className="flex-1 font-geist-medium text-secondary tabular-nums text-status-critical">
              {summary.unresolved_fields.length} applicable field{summary.unresolved_fields.length === 1 ? '' : 's'} must be clarified in chat before you can approve.
            </Text>
          </View>
        ) : null}
        <View className="rounded-panel bg-surface-recess p-3">
          {summary.fields.map((field, index) => (
            <View key={field.key} className={index === 0 ? '' : 'mt-3 border-t border-hairline pt-3'}>
              <View className="flex-row items-start justify-between gap-2">
                <Text className="min-w-0 flex-1 font-geist-semibold text-secondary text-ink">{field.label}</Text>
                <Text className={`font-geist-semibold text-micro ${field.blocks_approval ? 'text-status-critical' : field.status === 'found' ? 'text-status-good-label' : 'text-ink-3'}`}>
                  {!field.applicable ? 'Not applicable' : field.status === 'found' ? 'Found' : field.status === 'ambiguous' ? 'Ambiguous' : 'Not discussed'}
                </Text>
              </View>
              {field.applicable && field.status === 'found' ? (
                <Text selectable className="mt-1 font-geist text-secondary text-ink-2">{displayValue(field.value)}</Text>
              ) : field.blocks_approval ? (
                <Text className="mt-1 font-geist text-micro text-status-critical">Clarify this in chat, then request changes.</Text>
              ) : null}
              {field.evidence.map((item) => (
                <Text key={`${field.key}:${item.message_id}:${item.quote}`} selectable className="mt-1 font-geist text-micro italic text-ink-3">
                  “{item.quote}”
                </Text>
              ))}
            </View>
          ))}
        </View>
        <ApproverChecklist summary={summary} />
      </View>
    </EditSheet>
  );
}

export function ApproverChecklist({ summary }: { summary: Summary }) {
  return (
    <View className="rounded-xl bg-surface-recess px-3 py-2">
      {summary.approvers.map((approver, index) => (
        <View key={approver.profile_id} className={`flex-row items-start justify-between gap-3 ${index === 0 ? '' : 'mt-2 border-t border-hairline pt-2'}`}>
          <View className="min-w-0 flex-1">
            <Text className="font-geist-semibold text-secondary text-ink" numberOfLines={1}>{approver.display_name}</Text>
            <Text className="font-geist text-micro text-ink-3">{roleLabel(approver.role)}</Text>
            {approver.comment ? <Text className="mt-0.5 font-geist text-micro text-ink-2">{approver.comment}</Text> : null}
          </View>
          <Text className={`font-geist-semibold text-micro ${approver.status === 'approved' ? 'text-status-good-label' : approver.status === 'changes_requested' ? 'text-status-critical' : 'text-ink-3'}`}>
            {approver.status === 'approved' ? 'Approved' : approver.status === 'changes_requested' ? 'Changes requested' : 'Pending'}
          </Text>
        </View>
      ))}
    </View>
  );
}

function displayValue(value: unknown): string {
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  if (isDisclosureValue(value)) {
    const rules = [...value.platform_rules]
      .sort((left, right) => left.platform.localeCompare(right.platform) || left.rule.localeCompare(right.rule))
      .map((item) => `${item.platform} — ${item.rule}`)
      .join(', ');
    return `Required: ${value.required ? 'Yes' : 'No'}${rules ? ` · ${rules}` : ''}`;
  }
  return JSON.stringify(value, null, 2);
}

function isDisclosureValue(value: unknown): value is {
  required: boolean;
  platform_rules: { platform: string; rule: string }[];
} {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as { required?: unknown; platform_rules?: unknown };
  return typeof candidate.required === 'boolean'
    && Array.isArray(candidate.platform_rules)
    && candidate.platform_rules.every((item) => (
      !!item
      && typeof item === 'object'
      && typeof (item as { platform?: unknown }).platform === 'string'
      && typeof (item as { rule?: unknown }).rule === 'string'
    ));
}

function roleLabel(role: string): string {
  return role.split('_').map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(' ');
}
