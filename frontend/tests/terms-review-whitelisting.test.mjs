import assert from 'node:assert/strict';
import test from 'node:test';

import { formatWhitelistingTerms, isWhitelistingTerms } from '../src/lib/terms-display.ts';

const arrangement = (overrides = {}) => ({
  platform: 'Instagram',
  ad_account: 'Fictional Brand Ads',
  start_date: '2027-01-01',
  end_date: '2027-01-31',
  budget: null,
  ...overrides,
});

test('renders disabled and enabled whitelisting without raw JSON', () => {
  assert.equal(formatWhitelistingTerms({ enabled: false, arrangements: [] }), 'No');
  const rendered = formatWhitelistingTerms({
    enabled: true,
    arrangements: [arrangement({ budget: { amount: 0, currency: 'INR' } })],
  });
  assert.equal(rendered, 'Yes — Instagram — Fictional Brand Ads; 2027-01-01 to 2027-01-31 inclusive; budget INR 0');
  assert.equal(rendered.includes('{'), false);
});

test('sorts multiple arrangements by normalized identity', () => {
  const value = {
    enabled: true,
    arrangements: [
      arrangement({ platform: 'YouTube', ad_account: 'Zeta Account' }),
      arrangement({ ad_account: '  Alpha   Account  ', start_date: '2027-02-01', end_date: '2027-02-28' }),
    ],
  };
  const rendered = formatWhitelistingTerms(value);
  assert.ok(rendered.indexOf('Alpha') < rendered.indexOf('Zeta'));
  assert.equal(isWhitelistingTerms(value), true);
  assert.equal(isWhitelistingTerms({ enabled: true, arrangements: [{ platform: 'Instagram' }] }), false);
});

test('uses the shared Unicode full-casefold ordering', () => {
  const rendered = formatWhitelistingTerms({
    enabled: true,
    arrangements: [arrangement({ ad_account: 'ssz ads' }), arrangement({ ad_account: 'ßa ads', start_date: '2027-02-01', end_date: '2027-02-28' })],
  });
  assert.ok(rendered.indexOf('ßa ads') < rendered.indexOf('ssz ads'));
});
