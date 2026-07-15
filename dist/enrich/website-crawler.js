import { normalizeDomain } from '../pipeline/candidate-utils.js';
import { lookup } from 'node:dns/promises';
const CONTACT_PATH = /\b(contact|about|company|impressum|ติดต่อ|เกี่ยวกับ|hubungi|tentang)\b/i;
export async function crawlCompanyWebsite(input, companyName) {
    const website = normalizeWebsiteUrl(input);
    if (!website)
        throw new Error('Unsafe or invalid company website URL');
    const home = new URL(website);
    const pages = [home.href];
    const first = await fetchHtml(home.href);
    for (const href of extractLinks(first, home)) {
        if (pages.length >= 3)
            break;
        if (CONTACT_PATH.test(href))
            pages.push(href);
    }
    const documents = await Promise.all(pages.map(async (url) => ({ url, html: url === home.href ? first : await fetchHtml(url) })));
    const combined = documents.map(item => item.html).join('\n');
    const visible = stripHtml(combined);
    const emails = unique([
        ...matchAll(combined, /mailto:([^?"'\s>]+)/gi),
        ...matchAll(visible, /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g),
    ]).filter(isUsableEmail).slice(0, 10);
    const phones = unique([
        ...matchAll(combined, /tel:([^?"'>]+)/gi).map(value => decodeURIComponent(value).trim()),
        ...extractVisiblePhones(visible),
    ]).slice(0, 10);
    const linkedInUrl = extractLinks(combined, home).find(url => /linkedin\.com\/(company|in)\//i.test(url));
    const description = extractMeta(combined, 'description') || visible.slice(0, 400).trim() || undefined;
    const identityConfidence = calculateIdentityConfidence(companyName, home.hostname, visible);
    return {
        website: home.origin,
        identityMatched: identityConfidence >= 0.65,
        identityConfidence,
        emails,
        phones,
        linkedInUrl,
        description,
        pagesVisited: documents.map(item => item.url),
    };
}
export function normalizeWebsiteUrl(input) {
    const raw = input.trim();
    if (!raw)
        return undefined;
    try {
        const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
        if (!['http:', 'https:'].includes(url.protocol) || isPrivateHost(url.hostname))
            return undefined;
        url.hash = '';
        return url.href;
    }
    catch {
        return undefined;
    }
}
export function extractContactEvidence(html, baseUrl) {
    const base = new URL(baseUrl);
    const visible = stripHtml(html);
    return {
        emails: unique([...matchAll(html, /mailto:([^?"'\s>]+)/gi), ...matchAll(visible, /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g)]).filter(isUsableEmail),
        phones: unique([
            ...matchAll(html, /tel:([^?"'>]+)/gi).map(value => decodeURIComponent(value).trim()),
            ...extractVisiblePhones(visible),
        ]),
        linkedInUrl: extractLinks(html, base).find(url => /linkedin\.com\/(company|in)\//i.test(url)),
    };
}
async function fetchHtml(url) {
    let current = new URL(url);
    let response;
    for (let redirectCount = 0; redirectCount <= 3; redirectCount++) {
        await assertPublicHost(current.hostname);
        response = await fetch(current, { headers: { 'User-Agent': 'VertaX-Lead-Enrichment/1.0' }, redirect: 'manual', signal: AbortSignal.timeout(12000) });
        if (response.status < 300 || response.status >= 400)
            break;
        const location = response.headers.get('location');
        if (!location)
            break;
        current = new URL(location, current);
    }
    if (!response)
        throw new Error('Website request failed');
    if (!response.ok)
        throw new Error(`Website returned HTTP ${response.status}`);
    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('text/html') && !contentType.includes('application/xhtml'))
        throw new Error('Website did not return HTML');
    return (await response.text()).slice(0, 1_000_000);
}
function extractLinks(html, base) {
    const links = [];
    for (const value of matchAll(html, /href=["']([^"']+)["']/gi)) {
        try {
            const url = new URL(value, base);
            if (url.protocol.startsWith('http') && (url.hostname === base.hostname || /linkedin\.com$/i.test(url.hostname)))
                links.push(url.href.split('#')[0]);
        }
        catch { /* ignore malformed links */ }
    }
    return unique(links);
}
function calculateIdentityConfidence(companyName, hostname, text) {
    const domain = normalizeDomain(hostname) || hostname;
    const tokens = companyName.toLowerCase().replace(/\b(ltd|limited|co|company|inc|corp|corporation|sdn|bhd|plc)\b/g, ' ').match(/[\p{L}\p{N}]{3,}/gu) || [];
    if (!tokens.length)
        return 0.6;
    const haystack = `${domain} ${text.slice(0, 5000)}`.toLowerCase();
    const matches = tokens.filter(token => haystack.includes(token)).length;
    return Math.round(Math.min(0.95, 0.45 + (matches / tokens.length) * 0.5) * 100) / 100;
}
function extractMeta(html, name) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return html.match(new RegExp(`<meta[^>]+name=["']${escaped}["'][^>]+content=["']([^"']+)["']`, 'i'))?.[1]
        || html.match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+name=["']${escaped}["']`, 'i'))?.[1];
}
function matchAll(text, regex) { return [...text.matchAll(regex)].map(match => (match[1] || match[0]).trim()); }
function unique(values) { return [...new Map(values.filter(Boolean).map(value => [value.toLowerCase(), value])).values()]; }
function stripHtml(html) { return html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;|&#160;/gi, ' ').replace(/\s+/g, ' '); }
function isUsableEmail(value) { return !/\.(png|jpg|jpeg|gif|svg|webp)$/i.test(value) && !/example\.(com|org)$/i.test(value); }
function extractVisiblePhones(text) {
    return matchAll(text, /(?:\+\d{1,3}[\s().-]*)?(?:\d[\s().-]*){7,14}\d/g)
        .map(value => value.trim())
        .filter(value => {
        const digits = value.replace(/\D/g, '');
        return digits.length >= 8 && digits.length <= 15 && !/^\d{4}[\s.-]?\d{2}[\s.-]?\d{2}$/.test(value);
    });
}
function isPrivateHost(host) { return /^(localhost|127\.|0\.|10\.|192\.168\.|169\.254\.|::1$)/i.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host); }
async function assertPublicHost(host) {
    if (isPrivateHost(host))
        throw new Error('Private network targets are not allowed');
    const addresses = await lookup(host, { all: true });
    if (!addresses.length || addresses.some(item => isPrivateAddress(item.address))) {
        throw new Error('Website resolves to a private or unavailable network target');
    }
}
function isPrivateAddress(address) {
    const normalized = address.toLowerCase();
    return isPrivateHost(normalized)
        || normalized === '::1'
        || normalized.startsWith('fc')
        || normalized.startsWith('fd')
        || normalized.startsWith('fe80:')
        || normalized.startsWith('::ffff:10.')
        || normalized.startsWith('::ffff:127.')
        || normalized.startsWith('::ffff:192.168.')
        || /^::ffff:172\.(1[6-9]|2\d|3[01])\./.test(normalized);
}
//# sourceMappingURL=website-crawler.js.map