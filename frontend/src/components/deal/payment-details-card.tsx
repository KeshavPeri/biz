import { useEffect, useState, type ReactNode } from 'react';
import { Text, TextInput, View } from 'react-native';

import { Button, ButtonText } from '@/components/ui/button';
import type {
  BrandPaymentDetailsInput,
  CreatorPaymentDetailsInput,
  PaymentDetailsState,
} from '@/lib/deals';

type Result = { ok: true } | { ok: false; message: string };

export function PaymentDetailsCard({
  state,
  saving,
  error,
  onSaveCreator,
  onSaveBrand,
}: {
  state: PaymentDetailsState;
  saving: boolean;
  error: string | null;
  onSaveCreator: (expectedVersion: number, input: CreatorPaymentDetailsInput) => Promise<Result>;
  onSaveBrand: (expectedVersion: number, input: BrandPaymentDetailsInput) => Promise<Result>;
}) {
  const [editing, setEditing] = useState<'creator' | 'brand' | null>(null);
  const [draftError, setDraftError] = useState<string | null>(null);

  useEffect(() => {
    if (state.stage !== 'posted') setEditing(null);
  }, [state.stage]);

  return (
    <View className="gap-3 rounded-2xl border border-hairline bg-surface-card p-3">
      <View>
        <Text className="font-geist-semibold text-[14px] text-ink">Off-platform payment information</Text>
        <Text className="mt-0.5 font-geist text-[11px] leading-[16px] text-ink-3">
          A shared deal record for billing and payment instructions. Inflo does not transfer or verify funds.
        </Text>
      </View>

      <CompletionRow label="Creator information" complete={state.creator_complete} updatedAt={state.creator_updated_at} />
      {editing === 'creator' ? (
        <CreatorEditor
          state={state}
          saving={saving}
          error={draftError}
          onCancel={() => { setEditing(null); setDraftError(null); }}
          onSave={async (input) => {
            setDraftError(null);
            const result = await onSaveCreator(state.creator_version, input);
            if (result.ok) setEditing(null);
            else setDraftError(result.message);
            return result;
          }}
        />
      ) : (
        <View className="gap-1 rounded-xl bg-surface-recess p-3">
          <Detail label="Legal name" value={state.creator_legal_name} />
          <Detail label="Bank / UPI instruction" value={state.creator_bank_or_upi} />
          <Detail label="Tax identifier (optional)" value={state.creator_tax_id} />
          {state.allowed_actions.can_edit_creator ? (
            <EditButton label={state.creator_complete ? 'Edit creator information' : 'Add creator information'} onPress={() => setEditing('creator')} />
          ) : null}
        </View>
      )}

      <CompletionRow label="Brand billing information" complete={state.brand_complete} updatedAt={state.brand_updated_at} />
      {editing === 'brand' ? (
        <BrandEditor
          state={state}
          saving={saving}
          error={draftError}
          onCancel={() => { setEditing(null); setDraftError(null); }}
          onSave={async (input) => {
            setDraftError(null);
            const result = await onSaveBrand(state.brand_version, input);
            if (result.ok) setEditing(null);
            else setDraftError(result.message);
            return result;
          }}
        />
      ) : (
        <View className="gap-1 rounded-xl bg-surface-recess p-3">
          <Detail label="Billing name" value={state.brand_billing_name} />
          <Detail label="Billing address" value={state.brand_billing_address} />
          <Detail label="GST (optional)" value={state.brand_gst} />
          {state.allowed_actions.can_edit_brand ? (
            <EditButton label={state.brand_complete ? 'Edit brand billing information' : 'Add brand billing information'} onPress={() => setEditing('brand')} />
          ) : null}
        </View>
      )}
      {error && !draftError ? <Text className="font-geist-medium text-[12px] text-status-critical">{error}</Text> : null}
      {state.stage !== 'posted' ? (
        <Text className="font-geist text-[11px] text-ink-3">This record is read-only after post confirmation.</Text>
      ) : null}
    </View>
  );
}

function CreatorEditor({ state, saving, error, onCancel, onSave }: {
  state: PaymentDetailsState;
  saving: boolean;
  error: string | null;
  onCancel: () => void;
  onSave: (input: CreatorPaymentDetailsInput) => Promise<Result>;
}) {
  const [legalName, setLegalName] = useState(state.creator_legal_name ?? '');
  const [instruction, setInstruction] = useState(state.creator_bank_or_upi ?? '');
  const [taxId, setTaxId] = useState(state.creator_tax_id ?? '');
  const invalid = !legalName.trim() || !instruction.trim();
  return (
    <Editor title={`Creator payment information · v${state.creator_version}`} error={error} saving={saving} invalid={invalid} onCancel={onCancel} onSave={() => onSave({
      creator_legal_name: legalName.trim(), creator_bank_or_upi: instruction.trim(), creator_tax_id: taxId.trim() || null,
    })}>
      <Field label="Creator legal name *" value={legalName} onChangeText={setLegalName} maxLength={200} />
      <Field label="Bank account or UPI instruction *" value={instruction} onChangeText={setInstruction} maxLength={500} multiline />
      <Field label="Creator tax identifier (optional)" value={taxId} onChangeText={setTaxId} maxLength={64} />
    </Editor>
  );
}

function BrandEditor({ state, saving, error, onCancel, onSave }: {
  state: PaymentDetailsState;
  saving: boolean;
  error: string | null;
  onCancel: () => void;
  onSave: (input: BrandPaymentDetailsInput) => Promise<Result>;
}) {
  const [billingName, setBillingName] = useState(state.brand_billing_name ?? '');
  const [billingAddress, setBillingAddress] = useState(state.brand_billing_address ?? '');
  const [gst, setGst] = useState(state.brand_gst ?? '');
  const invalid = !billingName.trim() || !billingAddress.trim();
  return (
    <Editor title={`Brand billing information · v${state.brand_version}`} error={error} saving={saving} invalid={invalid} onCancel={onCancel} onSave={() => onSave({
      brand_billing_name: billingName.trim(), brand_billing_address: billingAddress.trim(), brand_gst: gst.trim() || null,
    })}>
      <Field label="Brand billing name *" value={billingName} onChangeText={setBillingName} maxLength={200} />
      <Field label="Brand billing address *" value={billingAddress} onChangeText={setBillingAddress} maxLength={1000} multiline />
      <Field label="Brand GST (optional)" value={gst} onChangeText={setGst} maxLength={64} />
    </Editor>
  );
}

function Editor({ title, error, saving, invalid, onCancel, onSave, children }: {
  title: string; error: string | null; saving: boolean; invalid: boolean;
  onCancel: () => void; onSave: () => void; children: ReactNode;
}) {
  return (
    <View className="gap-2 rounded-xl border border-hairline bg-app p-3">
      <Text className="font-geist-semibold text-[12px] text-ink">{title}</Text>
      {children}
      {error ? <Text className="font-geist-medium text-[11px] text-status-critical">{error}</Text> : null}
      <View className="flex-row gap-2">
        <SmallButton className="flex-1" label="Cancel" secondary disabled={saving} onPress={onCancel} />
        <SmallButton className="flex-1" label={saving ? 'Saving…' : 'Save'} disabled={saving || invalid} onPress={onSave} />
      </View>
    </View>
  );
}

function Field({ label, value, onChangeText, maxLength, multiline = false }: {
  label: string; value: string; onChangeText: (value: string) => void; maxLength: number; multiline?: boolean;
}) {
  return (
    <View className="gap-1">
      <Text className="font-geist-medium text-[10.5px] text-ink-3">{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        maxLength={maxLength}
        multiline={multiline}
        autoCorrect={false}
        placeholderTextColor="#847F78"
        className={`rounded-xl border border-hairline bg-surface-card px-3 py-2 font-geist text-[12px] text-ink ${multiline ? 'min-h-16' : ''}`}
      />
    </View>
  );
}

function CompletionRow({ label, complete, updatedAt }: { label: string; complete: boolean; updatedAt: string | null }) {
  return (
    <View className="flex-row items-start justify-between gap-3 border-t border-hairline pt-2">
      <View className="min-w-0 flex-1">
        <Text className="font-geist-semibold text-[12px] text-ink">{label}</Text>
        <Text className="font-geist text-[10.5px] text-ink-3">{updatedAt ? `Updated ${formatDate(updatedAt)}` : 'Not added yet'}</Text>
      </View>
      <Text className={`font-geist-semibold text-[10.5px] ${complete ? 'text-status-good-label' : 'text-status-critical'}`}>
        {complete ? 'Complete' : 'Missing'}
      </Text>
    </View>
  );
}

function Detail({ label, value }: { label: string; value: string | null }) {
  return (
    <View className="border-t border-hairline py-1.5 first:border-t-0">
      <Text className="font-geist-medium text-[10px] uppercase tracking-wide text-ink-3">{label}</Text>
      <Text selectable className="mt-0.5 font-geist text-[11.5px] text-ink-2">{value || 'Not provided'}</Text>
    </View>
  );
}

function EditButton({ label, onPress }: { label: string; onPress: () => void }) {
  return <SmallButton label={label} onPress={onPress} disabled={false} />;
}

function SmallButton({ label, disabled, onPress, secondary = false, className }: {
  label: string; disabled: boolean; onPress: () => void; secondary?: boolean; className?: string;
}) {
  return (
    <Button
      action={secondary ? 'secondary' : 'primary'}
      accessibilityLabel={label}
      isDisabled={disabled}
      onPress={onPress}
      className={className}
    >
      <ButtonText>{label}</ButtonText>
    </Button>
  );
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat(undefined, {
    day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit',
  }).format(date);
}
