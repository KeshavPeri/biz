import { compareContractText } from './disclosures-state.ts';

type WhitelistingArrangement = {
  platform: string;
  ad_account: string;
  start_date: string;
  end_date: string;
  budget: { amount: number; currency: string } | null;
};

type WhitelistingTerms = {
  enabled: boolean;
  arrangements: WhitelistingArrangement[];
};

function isArrangement(value: unknown): value is WhitelistingArrangement {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<WhitelistingArrangement>;
  const budget = item.budget;
  return typeof item.platform === 'string'
    && typeof item.ad_account === 'string'
    && typeof item.start_date === 'string'
    && typeof item.end_date === 'string'
    && (budget === null || (
      !!budget
      && typeof budget === 'object'
      && typeof budget.amount === 'number'
      && typeof budget.currency === 'string'
    ));
}

export function isWhitelistingTerms(value: unknown): value is WhitelistingTerms {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<WhitelistingTerms>;
  return typeof candidate.enabled === 'boolean'
    && Array.isArray(candidate.arrangements)
    && candidate.arrangements.every(isArrangement);
}

export function formatWhitelistingTerms(value: WhitelistingTerms): string {
  if (!value.enabled) return 'No';
  const arrangements = [...value.arrangements].sort((left, right) => {
    return compareContractText(left.platform, right.platform)
      || compareContractText(left.ad_account, right.ad_account)
      || left.start_date.localeCompare(right.start_date)
      || left.end_date.localeCompare(right.end_date)
      || JSON.stringify(left.budget).localeCompare(JSON.stringify(right.budget));
  });
  return `Yes — ${arrangements.map((item) => {
    const budget = item.budget === null
      ? ''
      : `; budget ${item.budget.currency} ${item.budget.amount.toLocaleString('en-IN')}`;
    return `${item.platform} — ${item.ad_account}; ${item.start_date} to ${item.end_date} inclusive${budget}`;
  }).join(' | ')}`;
}
