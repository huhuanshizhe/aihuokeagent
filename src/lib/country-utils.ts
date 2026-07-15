/**
 * 国家代码工具 - 精简版
 * 从 src/lib/radar/country-utils.ts 提取
 */

const COUNTRY_CODES = [
  'US','DE','GB','FR','HK','JP','KR','IT','ES','NL','SE','CH','AT','AU','CA',
  'BR','MX','IN','TH','VN','MY','SG','ID','PH','TR','PL','CZ','HU','SA','AE',
  'EG','ZA','DK','FI','NO','BE','PT','RO','SK','SI','IE','GR','IL','QA','KW',
  'MA','NG','KE','CL','CO','AR','NZ','TW','CN','PK','BD','LK','KZ','UA',
] as const;

const regionDisplay = new Intl.DisplayNames(['en'], { type: 'region' });

export const COUNTRY_NAME_BY_ISO: Record<string, string> = Object.fromEntries(
  COUNTRY_CODES.map(code => [code, regionDisplay.of(code) || code])
);

const ZH_COUNTRY_NAMES: Record<string, string> = {
  美国:'US',加拿大:'CA',德国:'DE',英国:'GB',法国:'FR',
  意大利:'IT',西班牙:'ES',荷兰:'NL',瑞典:'SE',瑞士:'CH',
  澳大利亚:'AU',巴西:'BR',墨西哥:'MX',印度:'IN',
  泰国:'TH',越南:'VN',马来西亚:'MY',新加坡:'SG',印尼:'ID',
  菲律宾:'PH',土耳其:'TR',波兰:'PL',捷克:'CZ',匈牙利:'HU',
  沙特:'SA',阿联酋:'AE',埃及:'EG',南非:'ZA',
  日本:'JP',韩国:'KR',中国:'CN',台湾:'TW',香港:'HK',
};

const aliasMap = new Map<string, string>();

for (const code of COUNTRY_CODES) {
  aliasMap.set(code.toLowerCase(), code);
  const name = COUNTRY_NAME_BY_ISO[code];
  if (name) aliasMap.set(name.toLowerCase(), code);
}
for (const [zh, iso] of Object.entries(ZH_COUNTRY_NAMES)) {
  aliasMap.set(zh.toLowerCase(), iso);
}

export function normalizeCountryCode(value?: string | null): string | null {
  if (!value?.trim()) return null;
  const upper = value.trim().toUpperCase();
  if (upper in COUNTRY_NAME_BY_ISO) return upper;
  return aliasMap.get(value.trim().toLowerCase()) ?? null;
}

export function getCountryDisplayName(value?: string | null): string | null {
  const iso = normalizeCountryCode(value);
  if (!iso) return value?.trim() || null;
  return COUNTRY_NAME_BY_ISO[iso] ?? iso;
}
