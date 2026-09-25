import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RefreshControl, Text, View } from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import Animated from 'react-native-reanimated';

import ApprovalIcon from '@/assets/icons/approval.svg';
import CalendarIcon from '@/assets/icons/calendar.svg';
import ChevronLeftIcon from '@/assets/icons/chevron-left.svg';
import ChevronRightIcon from '@/assets/icons/chevron-right.svg';
import ClockIcon from '@/assets/icons/clock.svg';
import PaymentIcon from '@/assets/icons/payment.svg';
import PostedIcon from '@/assets/icons/posted.svg';
import { PressableScale } from '@/components/motion/pressable-scale';
import { Button, ButtonText } from '@/components/ui/button';
import { DetailHeader, useDetailHeaderScroll } from '@/components/ui/detail-header';
import { EmptyState } from '@/components/ui/empty-state';
import { fetchCampaignCalendar } from '@/lib/campaign-calendar';
import {
  CALENDAR_VIEWS, CampaignCalendarContextFence, calendarDates, calendarItemsForDate,
  calendarRangeHeading, campaignCalendarWindow, shiftCalendarAnchor, utcToday,
  type CalendarView, type CampaignCalendarEvent, type CampaignCalendarSnapshot,
} from '@/lib/campaign-calendar-state';
import { useAuthStore } from '@/store/auth-store';

const KIND_META = {
  scheduled_post: { label: 'Scheduled post', color: '#0095A8', Icon: CalendarIcon },
  actual_post: { label: 'Confirmed post', color: '#4F7A1E', Icon: PostedIcon },
  payment_due: { label: 'Payment due', color: '#C0392B', Icon: PaymentIcon },
  rights_expiry: { label: 'Rights expiry', color: '#5E574E', Icon: ClockIcon },
} as const;

function validParamDate(value: string | undefined): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

function CalendarLegend() {
  return (
    <View accessibilityLabel="Calendar legend. Event meaning uses text and icons; amber shading means blackout." className="flex-row flex-wrap gap-x-4 gap-y-2 rounded-panel bg-surface-recess p-3">
      {Object.entries(KIND_META).map(([kind, meta]) => (
        <View key={kind} className="flex-row items-center gap-1.5">
          <meta.Icon width={15} height={15} color={meta.color} />
          <Text className="font-geist text-micro text-ink-2">{meta.label}</Text>
        </View>
      ))}
      <View className="flex-row items-center gap-1.5"><View className="h-3.5 w-3.5 rounded-sm border border-cane-4 bg-cane-2" /><Text className="font-geist text-micro text-ink-2">Blackout</Text></View>
    </View>
  );
}

function EventCard({ event }: { event: CampaignCalendarEvent }) {
  const meta = KIND_META[event.kind];
  const dateCopy = event.startDate === event.endDate ? event.startDate : `${event.startDate} – ${event.endDate}`;
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={`${meta.label}. ${event.dealName}. ${dateCopy} UTC. Open source deal.`}
      onPress={() => router.push(`/deal/${event.sourceDealId}`)}
      className="rounded-card border border-hairline-card bg-surface-card p-4 shadow-l1"
    >
      <View className="flex-row items-start gap-3">
        <View className="mt-0.5 h-8 w-8 items-center justify-center rounded-full bg-surface-recess"><meta.Icon width={18} height={18} color={meta.color} /></View>
        <View className="min-w-0 flex-1">
          <Text className="font-geist-semibold text-body text-ink">{meta.label}</Text>
          <Text numberOfLines={2} className="mt-0.5 font-geist text-secondary text-ink-2">{event.label}</Text>
          <Text numberOfLines={1} className="mt-1 font-geist text-micro text-ink-3">{event.dealName}</Text>
          {event.creatorLabel ? <Text className="mt-2 self-start rounded-full bg-status-good-tint px-2 py-1 font-geist-semibold text-micro text-status-good-label">Private · {event.creatorLabel}</Text> : null}
          <Text className="mt-2 font-geist text-micro text-ink-3">{dateCopy} UTC · {event.state.replaceAll('_', ' ')}</Text>
          <Text className="mt-2 font-geist-semibold text-micro text-ink">Open source deal ›</Text>
        </View>
      </View>
    </PressableScale>
  );
}

export default function CampaignCalendarScreen() {
  const params = useLocalSearchParams<{ view?: string; date?: string }>();
  const userId = useAuthStore((state) => state.session?.user.id ?? null);
  const initialView = CALENDAR_VIEWS.includes(params.view as CalendarView) ? params.view as CalendarView : 'month';
  const initialDate = validParamDate(params.date) ? params.date : utcToday();
  const fence = useRef(new CampaignCalendarContextFence()).current;
  const { onScroll, scrolled } = useDetailHeaderScroll();
  const [view, setView] = useState<CalendarView>(initialView);
  const [anchorDate, setAnchorDate] = useState(initialDate);
  const [selectedDate, setSelectedDate] = useState(initialDate);
  const [snapshot, setSnapshot] = useState<CampaignCalendarSnapshot | null>(null);
  const [ownerId, setOwnerId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const window = useMemo(() => campaignCalendarWindow(view, anchorDate), [anchorDate, view]);
  const context = `${userId ?? ''}:${view}:${window.startDate}:${window.endDate}`;
  fence.switchContext(context);
  const visible = ownerId === userId && snapshot?.startDate === window.startDate && snapshot.endDate === window.endDate ? snapshot : null;

  useEffect(() => {
    setSnapshot(null); setOwnerId(null); setError(null); setLoading(Boolean(userId));
  }, [userId]);

  const load = useCallback(async () => {
    if (!userId) { setLoading(false); return; }
    const requestedContext = `${userId}:${view}:${window.startDate}:${window.endDate}`;
    const ticket = fence.begin(requestedContext);
    setLoading(true);
    const result = await fetchCampaignCalendar(window);
    if (!fence.isCurrent(ticket)) return;
    if (result.ok) {
      setSnapshot(result.data); setOwnerId(userId); setError(null);
    } else {
      setSnapshot(null); setOwnerId(null); setError(result.message);
    }
    setLoading(false);
  }, [fence, userId, view, window]);

  useFocusEffect(useCallback(() => {
    void load();
    return () => fence.invalidate();
  }, [fence, load]));

  const updateContext = useCallback((nextView: CalendarView, nextDate: string) => {
    setView(nextView); setAnchorDate(nextDate); setSelectedDate(nextDate);
    setSnapshot(null); setOwnerId(null); setError(null);
    router.setParams({ view: nextView, date: nextDate });
  }, []);

  const refresh = useCallback(async () => {
    setRefreshing(true); await load(); setRefreshing(false);
  }, [load]);
  const dates = useMemo(() => calendarDates(window), [window]);
  const selected = visible ? calendarItemsForDate(visible, selectedDate) : { events: [], ranges: [] };
  const columns = view === 'day' ? 1 : 7;

  return (
    <SafeAreaView className="flex-1 bg-transparent" edges={['top']}>
      <DetailHeader title="Campaign calendar" scrolled={scrolled} onBack={() => router.back()} />
      <Animated.ScrollView
        className="flex-1" onScroll={onScroll} scrollEventThrottle={16}
        contentContainerClassName="gap-4 px-4 pb-10"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor="#847F78" />}
      >
        <View className="gap-1 pt-1">
          <Text className="font-geist-bold text-display text-ink">Campaign calendar</Text>
          <Text className="font-geist text-secondary text-ink-3">All dates stay in UTC, exactly as agreed.</Text>
        </View>
        <View accessibilityRole="tablist" className="flex-row rounded-button bg-surface-recess p-1">
          {CALENDAR_VIEWS.map((item) => (
            <PressableScale key={item} accessibilityRole="tab" accessibilityState={{ selected: view === item }} onPress={() => updateContext(item, selectedDate)} className={`h-10 flex-1 items-center justify-center rounded-button ${view === item ? 'bg-surface-card' : ''}`}>
              <Text className={`font-geist-semibold text-secondary capitalize ${view === item ? 'text-ink' : 'text-ink-3'}`}>{item}</Text>
            </PressableScale>
          ))}
        </View>
        <View className="flex-row items-center gap-2">
          <PressableScale accessibilityRole="button" accessibilityLabel={`Previous ${view}`} onPress={() => updateContext(view, shiftCalendarAnchor(view, anchorDate, -1))} className="h-11 w-11 items-center justify-center rounded-full bg-surface-recess"><ChevronLeftIcon width={20} height={20} color="#1C1B18" /></PressableScale>
          <View className="min-w-0 flex-1 items-center"><Text numberOfLines={1} className="font-geist-semibold text-title text-ink">{calendarRangeHeading(view, anchorDate, window)}</Text></View>
          <PressableScale accessibilityRole="button" accessibilityLabel={`Next ${view}`} onPress={() => updateContext(view, shiftCalendarAnchor(view, anchorDate, 1))} className="h-11 w-11 items-center justify-center rounded-full bg-surface-recess"><ChevronRightIcon width={20} height={20} color="#1C1B18" /></PressableScale>
        </View>
        <Button action="secondary" onPress={() => updateContext(view, utcToday())}><ButtonText>Today</ButtonText></Button>
        <CalendarLegend />
        {error ? (
          <View accessibilityRole="alert" className="flex-row items-center gap-3 rounded-panel bg-status-critical-tint px-3 py-2.5"><Text className="min-w-0 flex-1 font-geist text-micro text-status-critical">{error}</Text><Button action="secondary" onPress={() => void load()}><ButtonText>Retry</ButtonText></Button></View>
        ) : null}
        {visible ? (
          <View className="overflow-hidden rounded-panel border border-hairline-card bg-surface-card">
            {view !== 'day' ? <View className="flex-row">{(view === 'week' ? ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] : ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']).map((day) => <Text key={day} style={{ width: `${100 / 7}%` }} className="py-2 text-center font-geist-semibold text-micro text-ink-3">{day}</Text>)}</View> : null}
            <View className="flex-row flex-wrap">
              {dates.map((date) => {
                const items = calendarItemsForDate(visible, date);
                const blackout = items.ranges.length > 0;
                const selectedDay = date === selectedDate;
                return (
                  <PressableScale
                    key={date} accessibilityRole="button"
                    accessibilityLabel={`${date} UTC. ${items.events.length} events.${blackout ? ' Blackout period.' : ''}`}
                    accessibilityState={{ selected: selectedDay }} onPress={() => setSelectedDate(date)}
                    style={{ width: `${100 / columns}%`, minHeight: view === 'month' ? 76 : view === 'week' ? 104 : 92 }}
                    className={`border-l border-t border-hairline p-2 ${blackout ? 'bg-cane-2' : 'bg-surface-card'} ${selectedDay ? 'border-2 border-ink' : ''}`}
                  >
                    <Text className="font-geist-semibold text-secondary text-ink">{Number(date.slice(8))}</Text>
                    {blackout ? <Text numberOfLines={1} className="mt-1 font-geist-semibold text-micro text-ink-2">Blackout</Text> : null}
                    <View className="mt-1 flex-row flex-wrap gap-1">{items.events.slice(0, 3).map((event) => <View key={event.id} style={{ backgroundColor: KIND_META[event.kind].color }} className="h-2 w-2 rounded-full" />)}</View>
                    {items.events.length > 3 ? <Text className="mt-1 font-geist text-micro text-ink-3">+{items.events.length - 3} more</Text> : null}
                  </PressableScale>
                );
              })}
            </View>
          </View>
        ) : loading ? (
          <View className="gap-2 rounded-panel bg-surface-recess p-5"><Text className="font-geist-semibold text-title text-ink">Loading calendar…</Text><Text className="font-geist text-secondary text-ink-3">Checking current participation and canonical dates.</Text></View>
        ) : !error ? <EmptyState title="Calendar couldn’t load" description="Please try again." actionLabel="Try again" onAction={() => void load()} /> : null}
        {visible ? (
          <View className="gap-3">
            <Text className="font-geist-semibold text-title text-ink">{selectedDate} UTC</Text>
            {selected.ranges.length > 0 ? <View accessibilityRole="alert" className="flex-row items-center gap-2 rounded-panel border border-cane-4 bg-cane-2 p-3"><ApprovalIcon width={18} height={18} color="#5E574E" /><Text className="font-geist-semibold text-secondary text-ink-2">Contractual blackout period</Text></View> : null}
            {selected.events.map((event) => <EventCard key={event.id} event={event} />)}
            {selected.events.length === 0 && selected.ranges.length === 0 ? <EmptyState title="Nothing scheduled this day" description="Choose another UTC date or calendar view." /> : null}
          </View>
        ) : null}
        {visible && (visible.unscheduled.paymentDueCount > 0 || visible.unscheduled.integrityIssueCount > 0) ? (
          <View className="rounded-panel bg-surface-recess p-3">
            {visible.unscheduled.paymentDueCount > 0 ? <Text className="font-geist text-micro text-ink-2">{visible.unscheduled.paymentDueCount} payment {visible.unscheduled.paymentDueCount === 1 ? 'obligation has' : 'obligations have'} no due date and is not placed on the calendar.</Text> : null}
            {visible.unscheduled.integrityIssueCount > 0 ? <Text accessibilityRole="alert" className="mt-1 font-geist text-micro text-status-critical">Some contract dates could not be verified. Refresh or contact support.</Text> : null}
          </View>
        ) : null}
        {visible && visible.events.length === 0 && visible.ranges.length === 0 && visible.unscheduled.integrityIssueCount === 0 ? <EmptyState title="No calendar dates in this range" description="Navigate to another UTC range to see scheduled activity." /> : null}
      </Animated.ScrollView>
    </SafeAreaView>
  );
}
