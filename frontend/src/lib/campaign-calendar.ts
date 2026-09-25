import { supabase } from './supabase';
import {
  parseCampaignCalendarSnapshot, type CalendarWindow, type CampaignCalendarSnapshot,
} from './campaign-calendar-state';

export type CampaignCalendarResult =
  | { ok: true; data: CampaignCalendarSnapshot }
  | { ok: false; message: string };

export async function fetchCampaignCalendar(window: CalendarWindow): Promise<CampaignCalendarResult> {
  if (!supabase) return { ok: false, message: 'Calendar is not configured on this device.' };
  try {
    const { data, error } = await supabase.rpc('get_campaign_calendar', {
      p_start: window.startDate, p_end: window.endDate,
    });
    if (error) return { ok: false, message: 'Could not load the campaign calendar. Please try again.' };
    return { ok: true, data: parseCampaignCalendarSnapshot(data, window) };
  } catch {
    return { ok: false, message: 'Could not load the campaign calendar. Please try again.' };
  }
}
