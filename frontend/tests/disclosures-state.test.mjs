import assert from 'node:assert/strict';
import test from 'node:test';
import { DisclosureContextFence, parseDisclosureSnapshot } from '../src/lib/disclosures-state.ts';

const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const group = (platform = 'instagram', rules = ['Use #FictionalPartner']) => ({ platform, rules });
const row = (n = 1, overrides = {}) => ({
  deal_id: id(n), deal_name: `Fictional Deal ${n}`, counterparty_name: `Fictional Counterparty ${n}`,
  direction: 'inbound', stage: 'creating', presence: 'required', platforms: [group()],
  deal_path: `/deal/${id(n)}`, ...overrides,
});
const payload = (overrides = {}) => ({ version: 1, as_of: '2028-02-29T12:00:00Z', deals: [row()], ...overrides });

test('strict parser accepts empty, required multi-platform/rule, not-required, unavailable, and mixed deals', () => {
  assert.deepEqual(parseDisclosureSnapshot(payload({ deals: [] })).deals, []);
  const required = row(1, { platforms: [group('instagram', ['Use #FictionalPartner', 'Use paid partnership label']), group('youtube', ['State fictional sponsorship'])] });
  const none = row(2, { presence: 'not_required', platforms: [group('instagram', []), group('youtube', [])] });
  const unavailable = row(3, { presence: 'unavailable', platforms: [] });
  const parsed = parseDisclosureSnapshot(payload({ deals: [required, none, unavailable] }));
  assert.deepEqual(parsed.deals.map((deal) => deal.presence), ['required', 'not_required', 'unavailable']);
  assert.equal(parsed.deals[0].platforms[0].rules.length, 2);
  const canonicalMixedCase = ['alpha rule', 'Beta rule', 'Ｆoo rule', 'ßa disclosure', 'ssz disclosure', 'Zoo rule'];
  assert.deepEqual(
    parseDisclosureSnapshot(payload({ deals: [row(1, { platforms: [group('instagram', canonicalMixedCase)] })] })).deals[0].platforms[0].rules,
    canonicalMixedCase,
  );
});

test('strict parser rejects unknown keys, unsafe paths/text, unknown or duplicate platforms/rules, bad shapes, order, and overflow', () => {
  assert.throws(() => parseDisclosureSnapshot({ ...payload(), source_id: id(9) }));
  assert.throws(() => parseDisclosureSnapshot(payload({ deals: [row(1, { deal_path: 'https://unsafe.example' })] })));
  assert.throws(() => parseDisclosureSnapshot(payload({ deals: [row(1, { deal_name: 'bad\nname' })] })));
  assert.throws(() => parseDisclosureSnapshot(payload({ deals: [row(1, { platforms: [group('unknown')] })] })));
  assert.throws(() => parseDisclosureSnapshot(payload({ deals: [row(1, { platforms: [group(), group()] })] })));
  assert.throws(() => parseDisclosureSnapshot(payload({ deals: [row(1, { platforms: [group('instagram', ['Same rule', 'Same   rule'])] })] })));
  assert.throws(() => parseDisclosureSnapshot(payload({ deals: [row(1, { presence: 'not_required' })] })));
  assert.throws(() => parseDisclosureSnapshot(payload({ deals: [row(1, { presence: 'unavailable' })] })));
  assert.throws(() => parseDisclosureSnapshot(payload({ deals: [row(1, { platforms: [group('youtube'), group('instagram')] })] })));
  assert.throws(() => parseDisclosureSnapshot(payload({ deals: [row(1, { platforms: [group('instagram', ['Use paid partnership label', 'Use #FictionalPartner'])] })] })));
  assert.throws(() => parseDisclosureSnapshot(payload({ deals: [row(1, { platforms: [group('instagram', ['ssz disclosure', 'ßa disclosure'])] })] })));
  assert.throws(() => parseDisclosureSnapshot(payload({ deals: [row(2), row(1)] })));
  assert.throws(() => parseDisclosureSnapshot(payload({ deals: Array.from({ length: 101 }, (_, index) => row(index + 1)) })));
});

test('context fence rejects stale account, superseded request, and unmounted result', () => {
  const fence = new DisclosureContextFence(); const first = fence.begin('one'); const next = fence.begin('one');
  assert.equal(fence.isCurrent(first), false); assert.equal(fence.isCurrent(next), true);
  fence.switchContext('two'); assert.equal(fence.isCurrent(next), false);
  const current = fence.begin('two'); fence.invalidate(); assert.equal(fence.isCurrent(current), false);
});
