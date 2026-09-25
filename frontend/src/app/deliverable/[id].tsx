import { useCallback, useEffect, useRef, useState } from 'react';
import { Linking, RefreshControl, Text, View } from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import Animated from 'react-native-reanimated';

import { Button, ButtonText } from '@/components/ui/button';
import { DetailHeader, useDetailHeaderScroll } from '@/components/ui/detail-header';
import { EmptyState } from '@/components/ui/empty-state';
import { getContentDraftDownload } from '@/lib/deals';
import { fetchDeliverableDetail } from '@/lib/deliverable-detail';
import { DeliverableDetailContextFence, type DeliverableDetail } from '@/lib/deliverable-detail-state';
import { useAuthStore } from '@/store/auth-store';

const LABELS: Record<string, string> = { reel: 'Reel', static_post: 'Static post', story: 'Story', carousel: 'Carousel', yt_video: 'YouTube video', yt_short: 'YouTube Short', blog: 'Blog post', ugc_photo: 'UGC photo', podcast_read: 'Podcast read', x_thread: 'X/Twitter thread', linkedin_post: 'LinkedIn post', pinterest_pin: 'Pinterest Pin', instagram: 'Instagram', tiktok: 'TikTok', youtube: 'YouTube', linkedin: 'LinkedIn', x: 'X/Twitter', pinterest: 'Pinterest', threads: 'Threads', podcast: 'Podcast platform' };

export default function DeliverableDetailScreen() {
  const { id, dealId: queryDealId } = useLocalSearchParams<{ id: string; dealId: string }>();
  const userId = useAuthStore((state) => state.session?.user.id ?? null);
  const dealId = typeof queryDealId === 'string' ? queryDealId : '';
  const deliverableId = typeof id === 'string' ? id : '';
  const fence = useRef(new DeliverableDetailContextFence()).current;
  const { onScroll, scrolled } = useDetailHeaderScroll();
  const [detail, setDetail] = useState<DeliverableDetail | null>(null);
  const [owner, setOwner] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [opening, setOpening] = useState<string | null>(null);
  const context = `${userId ?? 'signed-out'}:${dealId}:${deliverableId}`;
  fence.switchContext(context);
  const visible = owner === context ? detail : null;

  useEffect(() => { setDetail(null); setOwner(''); setError(null); setLoading(Boolean(userId && dealId && deliverableId)); }, [context, dealId, deliverableId, userId]);
  useEffect(() => () => fence.invalidate(), [fence]);

  const load = useCallback(async () => {
    if (!userId || !dealId || !deliverableId) { setLoading(false); return; }
    const ticket = fence.begin(context); setLoading(true);
    const result = await fetchDeliverableDetail(dealId, deliverableId);
    if (!fence.isCurrent(ticket)) return;
    if (result.ok && result.data.dealId === dealId && result.data.deliverable.id === deliverableId) {
      setDetail(result.data); setOwner(context); setError(null);
    } else { setDetail(null); setOwner(''); setError(result.ok ? 'This deliverable did not match the requested deal.' : result.message); }
    setLoading(false);
  }, [context, dealId, deliverableId, fence, userId]);

  useFocusEffect(useCallback(() => { void load(); return () => fence.invalidate(); }, [fence, load]));
  const refresh = useCallback(async () => { setRefreshing(true); await load(); setRefreshing(false); }, [load]);
  const openDraft = useCallback(async (revisionId: string) => {
    if (!visible || opening || !userId) return;
    const ticket = fence.begin(context); setOpening(revisionId);
    const result = await getContentDraftDownload(dealId, deliverableId, revisionId);
    if (!fence.isCurrent(ticket)) return;
    if (result.ok) {
      try { await Linking.openURL(result.url); } catch { if (fence.isCurrent(ticket)) setError('The secure draft could not be opened. Please try again.'); }
    } else setError(result.message);
    if (fence.isCurrent(ticket)) setOpening(null);
  }, [context, dealId, deliverableId, fence, opening, userId, visible]);
  const openProof = useCallback(async (url: string) => { const ticket = fence.begin(context); try { await Linking.openURL(url); } catch { if (fence.isCurrent(ticket)) setError('The verified post could not be opened.'); } }, [context, fence]);

  return <SafeAreaView className="flex-1 bg-transparent" edges={['top']}>
    <DetailHeader title="Deliverable details" scrolled={scrolled} onBack={() => router.back()} />
    <Animated.ScrollView className="flex-1" onScroll={onScroll} scrollEventThrottle={16} contentContainerClassName="gap-4 px-4 pb-10" refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor="#847F78" />}>
      {visible ? <DetailBody detail={visible} opening={opening} onOpenDraft={openDraft} onOpenProof={openProof} /> : loading ? <View className="gap-2 pt-4"><Text className="font-geist-semibold text-title text-ink">Loading deliverable details…</Text><Text className="font-geist text-secondary text-ink-3">Checking the executed agreement and current evidence.</Text></View> : <EmptyState title="Deliverable unavailable" description={error ?? 'Return to the deal and try again.'} actionLabel="Try again" onAction={() => void load()} />}
    </Animated.ScrollView>
  </SafeAreaView>;
}

function DetailBody({ detail, opening, onOpenDraft, onOpenProof }: { detail: DeliverableDetail; opening: string | null; onOpenDraft: (id: string) => void; onOpenProof: (url: string) => void }) {
  const item = detail.deliverable; const rights = detail.usageRights;
  const schedule = item.postingDate ? item.postingDate : `${item.postingWindowStart} to ${item.postingWindowEnd} (inclusive)`;
  return <>
    <View className="gap-1 pt-1"><Text className="font-geist-bold text-display text-ink">{item.displayName}</Text><Text className="font-geist text-secondary text-ink-3">As of {new Date(detail.asOf).toLocaleString()} · UTC rights status</Text></View>
    <Section title="Agreement"><Fact label="Content" value={LABELS[item.contentFormat] ?? item.contentFormat} /><Fact label="Platform" value={LABELS[item.platform] ?? item.platform} /><Fact label="Location" value={item.location ?? 'No location agreed'} /><Fact label="Posting schedule" value={schedule} /></Section>
    <Section title="Revision and approval"><Fact label="Revision progress" value={`${item.revisionCurrent} of ${item.revisionMax}`} /><Fact label="Deliverable status" value={item.status.replace('_', ' ')} />{item.operationalAttention ? <Text accessibilityRole="alert" className="font-geist text-secondary text-status-critical">Operational attention is required before another revision.</Text> : null}{item.approval ? <Fact label="Approval" value={`${item.approval.status} · maker ${item.approval.makerName} · checker ${item.approval.checkerName}`} /> : <Fact label="Approval" value="No current approval" />}</Section>
    <Section title="Usage rights"><Fact label="Rights status" value={rights.status} />{rights.hasUsageRights ? <><Fact label="Channels" value={rights.channels.join(', ')} /><Fact label="Start" value={rights.startDate ?? 'Unavailable'} /><Fact label="End" value={rights.isPerpetual ? 'Perpetual' : rights.endDate ?? 'Unavailable'} /></> : <Text className="font-geist text-secondary text-ink-3">No usage rights were agreed in the executed contract.</Text>}</Section>
    <Section title="Live proof">{item.liveProof ? <><Fact label="Verification" value={item.liveProof.verificationStatus} /><Fact label="Host" value={item.liveProof.host} />{item.liveProof.title ? <Fact label="Title" value={item.liveProof.title} /> : null}<Button action="secondary" accessibilityRole="link" onPress={() => void onOpenProof(item.liveProof!.finalUrl)}><ButtonText>Open verified post</ButtonText></Button></> : <Text className="font-geist text-secondary text-ink-3">No live proof is currently available.</Text>}</Section>
    <Section title="Draft submissions">{item.submissionHistory.length ? item.submissionHistory.map((submission) => <View key={submission.id} className="gap-1 rounded-lg bg-surface-recess p-3"><Text className="font-geist-semibold text-secondary text-ink">Round {submission.roundNumber} · {submission.originalFilename}</Text><Text className="font-geist text-micro text-ink-3">{submission.lifecycle.replace('_', ' ')} · {submission.mimeType}</Text><Button action="secondary" onPress={() => void onOpenDraft(submission.id)} isDisabled={opening !== null}><ButtonText>{opening === submission.id ? 'Opening secure draft…' : 'Open draft'}</ButtonText></Button></View>) : <Text className="font-geist text-secondary text-ink-3">No draft has been submitted.</Text>}{item.historyTruncated ? <Text className="font-geist text-micro text-ink-3">Earlier draft history is truncated.</Text> : null}</Section>
  </>;
}
function Section({ title, children }: { title: string; children: React.ReactNode }) { return <View className="gap-2 rounded-2xl border border-hairline bg-surface-card p-3"><Text className="font-geist-semibold text-subtitle text-ink">{title}</Text>{children}</View>; }
function Fact({ label, value }: { label: string; value: string }) { return <View className="gap-0.5"><Text className="font-geist text-micro text-ink-3">{label}</Text><Text className="font-geist-medium text-secondary text-ink">{value}</Text></View>; }
