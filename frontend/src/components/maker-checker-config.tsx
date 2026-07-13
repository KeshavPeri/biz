import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';

import { Toggle } from '@/components/ui/toggle';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/store/auth-store';

// maker_checker_action_type_enum. payment_release is inert in MVP (tracking-only
// payments, rbac.md) — shown for completeness but not configurable.
const ACTIONS: { key: string; label: string; desc: string; inert?: boolean }[] = [
  {
    key: 'contract_signing',
    label: 'Contract signing',
    desc: 'A second person must approve before a contract is signed.',
  },
  {
    key: 'content_approval',
    label: 'Content approval',
    desc: 'A second person must approve content before it’s signed off.',
  },
  {
    key: 'payment_release',
    label: 'Payment release',
    desc: 'Inert for now — payments are tracking-only in this version.',
    inert: true,
  },
];

type Membership = { brandId: string; isAdmin: boolean; memberCount: number };

/**
 * MakerCheckerConfig (task 7.10) — a Brand Admin toggles which actions need a
 * second person's sign-off. Writes maker_checker_config directly under RLS
 * (`maker_checker_config_*_admin` enforces admin-only server-side). Segregation
 * of duties needs two people, so toggles are disabled until the brand has a
 * second member. Renders nothing for creators / non-brand users.
 */
export function MakerCheckerConfig() {
  const session = useAuthStore((s) => s.session);
  const [membership, setMembership] = useState<Membership | null>(null);
  const [config, setConfig] = useState<Record<string, boolean>>({});
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const load = async () => {
      if (!supabase || !session) {
        if (active) setLoaded(true);
        return;
      }
      // Is this user part of a brand, and as what?
      const { data: mine } = await supabase
        .from('brand_members')
        .select('brand_id, brand_role')
        .eq('profile_id', session.user.id)
        .maybeSingle();

      if (!active) return;
      if (!mine) {
        setLoaded(true);
        return;
      }

      const [{ count }, { data: cfg }] = await Promise.all([
        supabase
          .from('brand_members')
          .select('id', { count: 'exact', head: true })
          .eq('brand_id', mine.brand_id),
        supabase
          .from('maker_checker_config')
          .select('action_type, requires_checker')
          .eq('brand_id', mine.brand_id),
      ]);

      if (!active) return;
      setMembership({
        brandId: mine.brand_id,
        isAdmin: mine.brand_role === 'admin',
        memberCount: count ?? 1,
      });
      setConfig(Object.fromEntries((cfg ?? []).map((r) => [r.action_type, r.requires_checker])));
      setLoaded(true);
    };
    void load();
    return () => {
      active = false;
    };
  }, [session]);

  // Nothing to show for non-brand users, or before load.
  if (!loaded || !membership) return null;

  if (!membership.isAdmin) {
    return (
      <View className="mt-8">
        <Text className="mb-2 font-geist-semibold text-subtitle text-ink">Maker-checker</Text>
        <Text className="font-geist text-secondary text-ink-2">
          Only brand admins can configure approval rules.
        </Text>
      </View>
    );
  }

  const soloBrand = membership.memberCount < 2;

  const setRequires = async (action: string, value: boolean) => {
    if (!supabase || !membership) return;
    setError(null);
    setConfig((c) => ({ ...c, [action]: value })); // optimistic
    const { error: upErr } = await supabase.from('maker_checker_config').upsert(
      { brand_id: membership.brandId, action_type: action, requires_checker: value },
      { onConflict: 'brand_id,action_type' },
    );
    if (upErr) {
      setConfig((c) => ({ ...c, [action]: !value })); // revert
      setError('Couldn’t save that change. Please try again.');
    }
  };

  return (
    <View className="mt-8">
      <Text className="mb-1 font-geist-semibold text-subtitle text-ink">Maker-checker</Text>
      <Text className="mb-3 font-geist text-secondary text-ink-2">
        Require a second person to approve sensitive actions.
      </Text>

      {soloBrand ? (
        <View className="mb-3 rounded-panel bg-surface-recess p-3.5 shadow-recessInset">
          <Text className="font-geist text-secondary leading-[18px] text-ink-2">
            Add a second team member to enable maker-checker — approvals need two distinct people.
          </Text>
        </View>
      ) : null}

      {ACTIONS.map((a) => (
        <View
          key={a.key}
          className="mb-3 flex-row items-center gap-3.5 rounded-card border border-hairline-card bg-surface-card p-4 shadow-l1"
        >
          <View className="flex-1">
            <Text className="font-geist-semibold text-body text-ink">{a.label}</Text>
            <Text className="mt-0.5 font-geist text-secondary leading-[18px] text-ink-2">
              {a.desc}
            </Text>
          </View>
          <Toggle
            value={Boolean(config[a.key])}
            onValueChange={(v) => setRequires(a.key, v)}
            disabled={a.inert || soloBrand}
            accessibilityLabel={a.label}
          />
        </View>
      ))}

      {error ? (
        <Text className="font-geist text-secondary text-status-critical">{error}</Text>
      ) : null}
    </View>
  );
}
