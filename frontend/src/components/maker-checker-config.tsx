import { useCallback, useEffect, useState } from 'react';
import { Platform, Pressable, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';

import { Skeleton } from '@/components/motion/skeleton';
import { Toggle } from '@/components/ui/toggle';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/store/auth-store';

// maker_checker_action_type_enum. payment_release is inert in MVP (tracking-only
// payments, rbac.md) — not shown (B5-69): a dead switch next to developer copy
// reads as broken.
const ACTIONS: { key: string; label: string; desc: string }[] = [
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
  const [loadError, setLoadError] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retryToken, setRetryToken] = useState(0);

  useEffect(() => {
    let active = true;
    const load = async () => {
      setLoadError(false);
      if (!supabase || !session) {
        if (active) setLoaded(true);
        return;
      }
      try {
        // Is this user part of a brand, and as what?
        const { data: mine, error: mineErr } = await supabase
          .from('brand_members')
          .select('brand_id, brand_role')
          .eq('profile_id', session.user.id)
          .maybeSingle();
        if (mineErr) throw mineErr;

        if (!active) return;
        if (!mine) {
          setLoaded(true);
          return;
        }

        const [{ count, error: countErr }, { data: cfg, error: cfgErr }] = await Promise.all([
          supabase
            .from('brand_members')
            .select('id', { count: 'exact', head: true })
            .eq('brand_id', mine.brand_id),
          supabase
            .from('maker_checker_config')
            .select('action_type, requires_checker')
            .eq('brand_id', mine.brand_id),
        ]);
        if (countErr) throw countErr;
        if (cfgErr) throw cfgErr;

        if (!active) return;
        setMembership({
          brandId: mine.brand_id,
          isAdmin: mine.brand_role === 'admin',
          memberCount: count ?? 1,
        });
        setConfig(Object.fromEntries((cfg ?? []).map((r) => [r.action_type, r.requires_checker])));
        setLoaded(true);
      } catch {
        // Load errors used to be swallowed (B5-70): an admin would just see
        // nothing, with no way to tell "not a brand" from "the query failed".
        if (active) {
          setLoadError(true);
          setLoaded(true);
        }
      }
    };
    void load();
    return () => {
      active = false;
    };
  }, [session, retryToken]);

  const retry = useCallback(() => {
    setLoaded(false);
    setRetryToken((n) => n + 1);
  }, []);

  // Three-row skeleton while the two round-trips are in flight (B5-70) —
  // no more popping in and shifting the settings screen.
  if (!loaded) {
    return (
      <View className="mt-8">
        <Skeleton.Block width={120} height={18} className="mb-3" radius="pill" />
        <View className="overflow-hidden rounded-card border border-hairline-card bg-surface-card">
          {[0, 1].map((i) => (
            <View key={i} className={`flex-row items-center gap-3.5 p-4 ${i > 0 ? 'border-t border-hairline-card' : ''}`}>
              <View className="flex-1 gap-2">
                <Skeleton.Block width="55%" height={14} radius="pill" />
                <Skeleton.Block width="85%" height={12} radius="pill" />
              </View>
              <Skeleton.Block width={48} height={29} radius="pill" />
            </View>
          ))}
        </View>
      </View>
    );
  }

  if (loadError) {
    return (
      <View className="mt-8">
        <Text className="mb-2 font-geist-semibold text-subtitle text-ink">Approval rules</Text>
        <Text className="mb-2 font-geist text-secondary text-ink-2">
          Couldn’t load approval rules right now.
        </Text>
        <Pressable onPress={retry} hitSlop={8} accessibilityRole="button" className="self-start">
          <Text className="font-geist-semibold text-secondary text-ink">Retry</Text>
        </Pressable>
      </View>
    );
  }

  // Nothing to show for non-brand users.
  if (!membership) return null;

  if (!membership.isAdmin) {
    return (
      <View className="mt-8">
        <Text className="mb-2 font-geist-semibold text-subtitle text-ink">Approval rules</Text>
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
    if (Platform.OS !== 'web') Haptics.selectionAsync();
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
      <Text className="mb-1 font-geist-semibold text-subtitle text-ink">Approval rules</Text>
      <Text className="mb-3 font-geist text-secondary text-ink-2">
        Require a second teammate to approve sensitive actions.
      </Text>

      {soloBrand ? (
        <View className="mb-3 rounded-panel bg-surface-recess p-3.5 shadow-recessInset">
          <Text className="font-geist text-secondary leading-[18px] text-ink-2">
            Add a second team member to enable maker-checker — approvals need two distinct people.
          </Text>
        </View>
      ) : null}

      {/* Grouped L0 list (B5-72) — one hairline-bordered card, no per-row shadow. */}
      <View className="overflow-hidden rounded-card border border-hairline-card bg-surface-card">
        {ACTIONS.map((a, i) => (
          <View
            key={a.key}
            className={`flex-row items-center gap-3.5 p-4 ${i > 0 ? 'border-t border-hairline-card' : ''}`}
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
              disabled={soloBrand}
              accessibilityLabel={a.label}
            />
          </View>
        ))}
      </View>

      {/* Routine settings error, not a payment/contract failure — ink-2, no red (decision 11). */}
      {error ? <Text className="mt-3 font-geist text-secondary text-ink-2">{error}</Text> : null}
    </View>
  );
}
