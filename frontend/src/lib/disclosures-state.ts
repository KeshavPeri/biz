export const DISCLOSURE_PLATFORMS = ['instagram', 'linkedin', 'pinterest', 'podcast', 'threads', 'tiktok', 'x', 'youtube'] as const;
export type DisclosurePlatform = (typeof DISCLOSURE_PLATFORMS)[number];
export type DisclosurePresence = 'required' | 'not_required' | 'unavailable';
export type DisclosurePlatformGroup = { platform: DisclosurePlatform; rules: string[] };
export type DisclosureDeal = {
  dealId: string; dealName: string; counterpartyName: string; direction: 'inbound' | 'outbound';
  stage: 'creating' | 'posted' | 'payment' | 'closed'; presence: DisclosurePresence;
  platforms: DisclosurePlatformGroup[]; dealPath: string;
};
export type DisclosureSnapshot = { version: 1; asOf: string; deals: DisclosureDeal[] };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
const STAGES = ['creating', 'posted', 'payment', 'closed'] as const;
const PYTHON_WHITESPACE = /[\u0009-\u000d\u001c-\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+/gu;
// Python 3.14 / Unicode 16 full-casefold overrides where casefold differs from
// per-code-point ECMAScript lowercase. Self-maps pin Unicode 16 behavior when
// the client runtime contains newer case mappings.
const CASEFOLD_OVERRIDES: Readonly<Record<string, string>> = {"µ":"μ","ß":"ss","ŉ":"ʼn","ſ":"s","ǰ":"ǰ","ͅ":"ι","ΐ":"ΐ","ΰ":"ΰ","ς":"σ","ϐ":"β","ϑ":"θ","ϕ":"φ","ϖ":"π","ϰ":"κ","ϱ":"ρ","ϵ":"ε","և":"եւ","Ꭰ":"Ꭰ","Ꭱ":"Ꭱ","Ꭲ":"Ꭲ","Ꭳ":"Ꭳ","Ꭴ":"Ꭴ","Ꭵ":"Ꭵ","Ꭶ":"Ꭶ","Ꭷ":"Ꭷ","Ꭸ":"Ꭸ","Ꭹ":"Ꭹ","Ꭺ":"Ꭺ","Ꭻ":"Ꭻ","Ꭼ":"Ꭼ","Ꭽ":"Ꭽ","Ꭾ":"Ꭾ","Ꭿ":"Ꭿ","Ꮀ":"Ꮀ","Ꮁ":"Ꮁ","Ꮂ":"Ꮂ","Ꮃ":"Ꮃ","Ꮄ":"Ꮄ","Ꮅ":"Ꮅ","Ꮆ":"Ꮆ","Ꮇ":"Ꮇ","Ꮈ":"Ꮈ","Ꮉ":"Ꮉ","Ꮊ":"Ꮊ","Ꮋ":"Ꮋ","Ꮌ":"Ꮌ","Ꮍ":"Ꮍ","Ꮎ":"Ꮎ","Ꮏ":"Ꮏ","Ꮐ":"Ꮐ","Ꮑ":"Ꮑ","Ꮒ":"Ꮒ","Ꮓ":"Ꮓ","Ꮔ":"Ꮔ","Ꮕ":"Ꮕ","Ꮖ":"Ꮖ","Ꮗ":"Ꮗ","Ꮘ":"Ꮘ","Ꮙ":"Ꮙ","Ꮚ":"Ꮚ","Ꮛ":"Ꮛ","Ꮜ":"Ꮜ","Ꮝ":"Ꮝ","Ꮞ":"Ꮞ","Ꮟ":"Ꮟ","Ꮠ":"Ꮠ","Ꮡ":"Ꮡ","Ꮢ":"Ꮢ","Ꮣ":"Ꮣ","Ꮤ":"Ꮤ","Ꮥ":"Ꮥ","Ꮦ":"Ꮦ","Ꮧ":"Ꮧ","Ꮨ":"Ꮨ","Ꮩ":"Ꮩ","Ꮪ":"Ꮪ","Ꮫ":"Ꮫ","Ꮬ":"Ꮬ","Ꮭ":"Ꮭ","Ꮮ":"Ꮮ","Ꮯ":"Ꮯ","Ꮰ":"Ꮰ","Ꮱ":"Ꮱ","Ꮲ":"Ꮲ","Ꮳ":"Ꮳ","Ꮴ":"Ꮴ","Ꮵ":"Ꮵ","Ꮶ":"Ꮶ","Ꮷ":"Ꮷ","Ꮸ":"Ꮸ","Ꮹ":"Ꮹ","Ꮺ":"Ꮺ","Ꮻ":"Ꮻ","Ꮼ":"Ꮼ","Ꮽ":"Ꮽ","Ꮾ":"Ꮾ","Ꮿ":"Ꮿ","Ᏸ":"Ᏸ","Ᏹ":"Ᏹ","Ᏺ":"Ᏺ","Ᏻ":"Ᏻ","Ᏼ":"Ᏼ","Ᏽ":"Ᏽ","ᏸ":"Ᏸ","ᏹ":"Ᏹ","ᏺ":"Ᏺ","ᏻ":"Ᏻ","ᏼ":"Ᏼ","ᏽ":"Ᏽ","ᲀ":"в","ᲁ":"д","ᲂ":"о","ᲃ":"с","ᲄ":"т","ᲅ":"т","ᲆ":"ъ","ᲇ":"ѣ","ᲈ":"ꙋ","ẖ":"ẖ","ẗ":"ẗ","ẘ":"ẘ","ẙ":"ẙ","ẚ":"aʾ","ẛ":"ṡ","ẞ":"ss","ὐ":"ὐ","ὒ":"ὒ","ὔ":"ὔ","ὖ":"ὖ","ᾀ":"ἀι","ᾁ":"ἁι","ᾂ":"ἂι","ᾃ":"ἃι","ᾄ":"ἄι","ᾅ":"ἅι","ᾆ":"ἆι","ᾇ":"ἇι","ᾈ":"ἀι","ᾉ":"ἁι","ᾊ":"ἂι","ᾋ":"ἃι","ᾌ":"ἄι","ᾍ":"ἅι","ᾎ":"ἆι","ᾏ":"ἇι","ᾐ":"ἠι","ᾑ":"ἡι","ᾒ":"ἢι","ᾓ":"ἣι","ᾔ":"ἤι","ᾕ":"ἥι","ᾖ":"ἦι","ᾗ":"ἧι","ᾘ":"ἠι","ᾙ":"ἡι","ᾚ":"ἢι","ᾛ":"ἣι","ᾜ":"ἤι","ᾝ":"ἥι","ᾞ":"ἦι","ᾟ":"ἧι","ᾠ":"ὠι","ᾡ":"ὡι","ᾢ":"ὢι","ᾣ":"ὣι","ᾤ":"ὤι","ᾥ":"ὥι","ᾦ":"ὦι","ᾧ":"ὧι","ᾨ":"ὠι","ᾩ":"ὡι","ᾪ":"ὢι","ᾫ":"ὣι","ᾬ":"ὤι","ᾭ":"ὥι","ᾮ":"ὦι","ᾯ":"ὧι","ᾲ":"ὰι","ᾳ":"αι","ᾴ":"άι","ᾶ":"ᾶ","ᾷ":"ᾶι","ᾼ":"αι","ι":"ι","ῂ":"ὴι","ῃ":"ηι","ῄ":"ήι","ῆ":"ῆ","ῇ":"ῆι","ῌ":"ηι","ῒ":"ῒ","ΐ":"ΐ","ῖ":"ῖ","ῗ":"ῗ","ῢ":"ῢ","ΰ":"ΰ","ῤ":"ῤ","ῦ":"ῦ","ῧ":"ῧ","ῲ":"ὼι","ῳ":"ωι","ῴ":"ώι","ῶ":"ῶ","ῷ":"ῶι","ῼ":"ωι","꟎":"꟎","꟒":"꟒","꟔":"꟔","ꭰ":"Ꭰ","ꭱ":"Ꭱ","ꭲ":"Ꭲ","ꭳ":"Ꭳ","ꭴ":"Ꭴ","ꭵ":"Ꭵ","ꭶ":"Ꭶ","ꭷ":"Ꭷ","ꭸ":"Ꭸ","ꭹ":"Ꭹ","ꭺ":"Ꭺ","ꭻ":"Ꭻ","ꭼ":"Ꭼ","ꭽ":"Ꭽ","ꭾ":"Ꭾ","ꭿ":"Ꭿ","ꮀ":"Ꮀ","ꮁ":"Ꮁ","ꮂ":"Ꮂ","ꮃ":"Ꮃ","ꮄ":"Ꮄ","ꮅ":"Ꮅ","ꮆ":"Ꮆ","ꮇ":"Ꮇ","ꮈ":"Ꮈ","ꮉ":"Ꮉ","ꮊ":"Ꮊ","ꮋ":"Ꮋ","ꮌ":"Ꮌ","ꮍ":"Ꮍ","ꮎ":"Ꮎ","ꮏ":"Ꮏ","ꮐ":"Ꮐ","ꮑ":"Ꮑ","ꮒ":"Ꮒ","ꮓ":"Ꮓ","ꮔ":"Ꮔ","ꮕ":"Ꮕ","ꮖ":"Ꮖ","ꮗ":"Ꮗ","ꮘ":"Ꮘ","ꮙ":"Ꮙ","ꮚ":"Ꮚ","ꮛ":"Ꮛ","ꮜ":"Ꮜ","ꮝ":"Ꮝ","ꮞ":"Ꮞ","ꮟ":"Ꮟ","ꮠ":"Ꮠ","ꮡ":"Ꮡ","ꮢ":"Ꮢ","ꮣ":"Ꮣ","ꮤ":"Ꮤ","ꮥ":"Ꮥ","ꮦ":"Ꮦ","ꮧ":"Ꮧ","ꮨ":"Ꮨ","ꮩ":"Ꮩ","ꮪ":"Ꮪ","ꮫ":"Ꮫ","ꮬ":"Ꮬ","ꮭ":"Ꮭ","ꮮ":"Ꮮ","ꮯ":"Ꮯ","ꮰ":"Ꮰ","ꮱ":"Ꮱ","ꮲ":"Ꮲ","ꮳ":"Ꮳ","ꮴ":"Ꮴ","ꮵ":"Ꮵ","ꮶ":"Ꮶ","ꮷ":"Ꮷ","ꮸ":"Ꮸ","ꮹ":"Ꮹ","ꮺ":"Ꮺ","ꮻ":"Ꮻ","ꮼ":"Ꮼ","ꮽ":"Ꮽ","ꮾ":"Ꮾ","ꮿ":"Ꮿ","ﬀ":"ff","ﬁ":"fi","ﬂ":"fl","ﬃ":"ffi","ﬄ":"ffl","ﬅ":"st","ﬆ":"st","ﬓ":"մն","ﬔ":"մե","ﬕ":"մի","ﬖ":"վն","ﬗ":"մխ","𖺠":"𖺠","𖺡":"𖺡","𖺢":"𖺢","𖺣":"𖺣","𖺤":"𖺤","𖺥":"𖺥","𖺦":"𖺦","𖺧":"𖺧","𖺨":"𖺨","𖺩":"𖺩","𖺪":"𖺪","𖺫":"𖺫","𖺬":"𖺬","𖺭":"𖺭","𖺮":"𖺮","𖺯":"𖺯","𖺰":"𖺰","𖺱":"𖺱","𖺲":"𖺲","𖺳":"𖺳","𖺴":"𖺴","𖺵":"𖺵","𖺶":"𖺶","𖺷":"𖺷","𖺸":"𖺸"};

function invalid(): never { throw new Error('invalid disclosure response'); }
function record(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid();
  const found = Object.keys(value as object).sort(); const expected = [...keys].sort();
  if (found.length !== expected.length || found.some((key, index) => key !== expected[index])) invalid();
  return value as Record<string, unknown>;
}
function text(value: unknown, maximum: number, trimmed = false): string {
  if (typeof value !== 'string' || !value || value.length > maximum || /[\u0000-\u001f\u007f]/.test(value) || (trimmed && value !== value.trim())) invalid();
  return value;
}
function uuid(value: unknown): string { if (typeof value !== 'string' || !UUID.test(value)) invalid(); return value; }
function instant(value: unknown): string {
  if (typeof value !== 'string' || !INSTANT.test(value) || !Number.isFinite(Date.parse(value))) invalid();
  return value;
}
function oneOf<T extends string>(value: unknown, values: readonly T[]): T {
  if (typeof value !== 'string' || !values.includes(value as T)) invalid(); return value as T;
}
export function normaliseContractText(value: string): string {
  const collapsed = value.normalize('NFKC').replace(PYTHON_WHITESPACE, ' ').replace(/^ | $/g, '');
  return Array.from(collapsed, (character) => CASEFOLD_OVERRIDES[character] ?? character.toLowerCase()).join('');
}
function compareCodePoints(left: string, right: string): number {
  const a = Array.from(left, (character) => character.codePointAt(0) as number);
  const b = Array.from(right, (character) => character.codePointAt(0) as number);
  const length = Math.min(a.length, b.length);
  for (let index = 0; index < length; index += 1) if (a[index] !== b[index]) return a[index] - b[index];
  return a.length - b.length;
}
function compareRules(left: string, right: string): number {
  return compareContractText(left, right);
}
export function compareContractText(left: string, right: string): number {
  return compareCodePoints(normaliseContractText(left), normaliseContractText(right)) || compareCodePoints(left, right);
}
function group(value: unknown): DisclosurePlatformGroup {
  const row = record(value, ['platform', 'rules']);
  const platform = oneOf(row.platform, DISCLOSURE_PLATFORMS);
  if (!Array.isArray(row.rules) || row.rules.length > 50) invalid();
  const rules = row.rules.map((rule) => text(rule, 500, true));
  if (new Set(rules.map(normaliseContractText)).size !== rules.length) invalid();
  for (let index = 1; index < rules.length; index += 1) if (compareRules(rules[index - 1], rules[index]) >= 0) invalid();
  return { platform, rules };
}
function deal(value: unknown): DisclosureDeal {
  const row = record(value, ['deal_id', 'deal_name', 'counterparty_name', 'direction', 'stage', 'presence', 'platforms', 'deal_path']);
  const dealId = uuid(row.deal_id); const presence = oneOf(row.presence, ['required', 'not_required', 'unavailable'] as const);
  if (!Array.isArray(row.platforms) || row.platforms.length > DISCLOSURE_PLATFORMS.length) invalid();
  const platforms = row.platforms.map(group);
  if (new Set(platforms.map((item) => item.platform)).size !== platforms.length) invalid();
  for (let index = 1; index < platforms.length; index += 1) if (platforms[index - 1].platform >= platforms[index].platform) invalid();
  const ruleCount = platforms.reduce((total, item) => total + item.rules.length, 0);
  if (presence === 'required' && (!platforms.length || !platforms.every((item) => item.rules.length > 0) || ruleCount > 50)) invalid();
  if (presence === 'not_required' && (!platforms.length || ruleCount !== 0)) invalid();
  if (presence === 'unavailable' && platforms.length !== 0) invalid();
  if (row.deal_path !== `/deal/${dealId}`) invalid();
  return {
    dealId, dealName: text(row.deal_name, 160), counterpartyName: text(row.counterparty_name, 160),
    direction: oneOf(row.direction, ['inbound', 'outbound'] as const), stage: oneOf(row.stage, STAGES),
    presence, platforms, dealPath: row.deal_path as string,
  };
}

export function parseDisclosureSnapshot(value: unknown): DisclosureSnapshot {
  const root = record(value, ['version', 'as_of', 'deals']);
  if (root.version !== 1 || !Array.isArray(root.deals) || root.deals.length > 100) invalid();
  const deals = root.deals.map(deal);
  if (new Set(deals.map((item) => item.dealId)).size !== deals.length) invalid();
  for (let index = 1; index < deals.length; index += 1) if (deals[index - 1].dealId >= deals[index].dealId) invalid();
  return { version: 1, asOf: instant(root.as_of), deals };
}

export class DisclosureContextFence {
  private context = ''; private generation = 0;
  switchContext(context: string) { if (this.context !== context) { this.context = context; this.generation += 1; } }
  begin(context: string) { this.switchContext(context); this.generation += 1; return { context, generation: this.generation }; }
  invalidate() { this.generation += 1; }
  isCurrent(ticket: { context: string; generation: number }) { return ticket.context === this.context && ticket.generation === this.generation; }
}
