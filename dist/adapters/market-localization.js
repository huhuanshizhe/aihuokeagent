import { normalizeCountryCode } from '../lib/country-utils.js';
import { resourceRegistry } from '../resources/registry.js';
export function getMarketProfile(country) {
    const code = normalizeCountryCode(country) || resourceRegistry.findMarket(country)?.countryCode;
    const pack = code ? resourceRegistry.getMarket(code) : undefined;
    if (!pack || pack.status !== 'active')
        return undefined;
    const primaryLanguage = [...pack.languages].sort((a, b) => a.priority - b.priority)[0]?.code || 'en';
    return {
        code: pack.countryCode,
        countryName: pack.countryName,
        languageCode: primaryLanguage,
        uiLanguage: primaryLanguage === 'en' ? 'en-US' : `${primaryLanguage}-${pack.countryCode}`,
        viewport: pack.viewport,
        clusters: pack.clusters.map(cluster => ({ name: cluster.name, localName: cluster.localName, viewport: cluster.viewport })),
    };
}
export function localizeIndustrialKeyword(keyword, country) {
    const code = normalizeCountryCode(country) || resourceRegistry.findMarket(country)?.countryCode;
    const pack = code ? resourceRegistry.getMarket(code) : undefined;
    if (!pack)
        return undefined;
    for (const phrase of pack.localization.phrases) {
        try {
            if (new RegExp(phrase.pattern, 'i').test(keyword))
                return phrase.value;
        }
        catch {
            // Invalid resource expressions are ignored; registry validation can surface them later.
        }
    }
    return undefined;
}
export function isSoutheastAsiaFocus(country) {
    const code = normalizeCountryCode(country) || resourceRegistry.findMarket(country)?.countryCode;
    return Boolean(code && resourceRegistry.getMarket(code)?.region === 'southeast_asia');
}
//# sourceMappingURL=market-localization.js.map