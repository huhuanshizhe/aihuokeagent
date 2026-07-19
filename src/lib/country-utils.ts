/**
 * Country code utilities — ISO-3166-1 alpha-2 as the canonical key.
 * Accepts ISO, English display names, and common Chinese names (UI input).
 * Does not accept legacy snake_case profile keys (those are migrated client-side).
 */

const COUNTRY_CODES = [
  'US', 'CA', 'MX', 'BR', 'GB', 'DE', 'FR', 'IT', 'ES', 'NL', 'SE', 'CH', 'AT',
  'JP', 'KR', 'AU', 'IN', 'IL', 'SA', 'AE', 'TH', 'VN', 'MY', 'SG', 'ID', 'PH', 'TR',
  'HK', 'TW', 'CN', 'PL', 'CZ', 'HU', 'EG', 'ZA', 'DK', 'FI', 'NO', 'BE', 'PT',
  'RO', 'SK', 'SI', 'IE', 'GR', 'QA', 'KW', 'MA', 'NG', 'KE', 'CL', 'CO', 'AR',
  'NZ', 'PK', 'BD', 'LK', 'KZ', 'UA',
] as const;

const regionDisplay = new Intl.DisplayNames(['en'], { type: 'region' });

export const COUNTRY_NAME_BY_ISO: Record<string, string> = Object.fromEntries(
  COUNTRY_CODES.map(code => [code, regionDisplay.of(code) || code]),
);

/** Explicit English aliases beyond Intl (UI / API free-text). */
const EN_ALIASES: Record<string, string> = {
  usa: 'US',
  america: 'US',
  'united states of america': 'US',
  uk: 'GB',
  britain: 'GB',
  'great britain': 'GB',
  korea: 'KR',
  'republic of korea': 'KR',
  uae: 'AE',
  emirates: 'AE',
  holland: 'NL',
  vietnam: 'VN',
  'viet nam': 'VN',
};

const ZH_COUNTRY_NAMES: Record<string, string> = {
  美国: 'US',
  加拿大: 'CA',
  墨西哥: 'MX',
  巴西: 'BR',
  英国: 'GB',
  德国: 'DE',
  法国: 'FR',
  意大利: 'IT',
  西班牙: 'ES',
  荷兰: 'NL',
  瑞典: 'SE',
  瑞士: 'CH',
  奥地利: 'AT',
  日本: 'JP',
  韩国: 'KR',
  澳大利亚: 'AU',
  印度: 'IN',
  以色列: 'IL',
  沙特: 'SA',
  沙特阿拉伯: 'SA',
  阿联酋: 'AE',
  泰国: 'TH',
  越南: 'VN',
  马来西亚: 'MY',
  新加坡: 'SG',
  印尼: 'ID',
  印度尼西亚: 'ID',
  菲律宾: 'PH',
  土耳其: 'TR',
  中国: 'CN',
  台湾: 'TW',
  香港: 'HK',
  波兰: 'PL',
  捷克: 'CZ',
  匈牙利: 'HU',
  埃及: 'EG',
  南非: 'ZA',
};

const aliasMap = new Map<string, string>();

for (const code of COUNTRY_CODES) {
  aliasMap.set(code.toLowerCase(), code);
  const name = COUNTRY_NAME_BY_ISO[code];
  if (name) aliasMap.set(name.toLowerCase(), code);
}
for (const [alias, iso] of Object.entries(EN_ALIASES)) {
  aliasMap.set(alias.toLowerCase(), iso);
}
for (const [zh, iso] of Object.entries(ZH_COUNTRY_NAMES)) {
  aliasMap.set(zh.toLowerCase(), iso);
}

export function normalizeCountryCode(value?: string | null): string | null {
  if (!value?.trim()) return null;
  const trimmed = value.trim();
  const upper = trimmed.toUpperCase();
  if (upper in COUNTRY_NAME_BY_ISO) return upper;
  return aliasMap.get(trimmed.toLowerCase()) ?? null;
}

export function getCountryDisplayName(value?: string | null): string | null {
  const iso = normalizeCountryCode(value);
  if (!iso) return value?.trim() || null;
  return COUNTRY_NAME_BY_ISO[iso] ?? iso;
}
