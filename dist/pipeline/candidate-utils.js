export function normalizeDomain(value) {
    if (!value)
        return undefined;
    try {
        const url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
        return url.hostname.toLowerCase().replace(/^www\./, '').replace(/\.$/, '') || undefined;
    }
    catch {
        return undefined;
    }
}
function normalizeCompanyName(value) {
    return value
        .normalize('NFKD')
        .toLowerCase()
        .replace(/&/g, ' and ')
        .replace(/\b(incorporated|inc|limited|ltd|llc|gmbh|sarl|sa|spa|bv|plc|corp|corporation|company|co)\b/g, ' ')
        .replace(/[^a-z0-9\p{L}]+/gu, ' ')
        .trim()
        .replace(/\s+/g, '-');
}
/** Stable cross-provider identity used for conservative company deduplication. */
export function buildCandidateIdentity(candidate) {
    if (candidate.candidateType !== 'COMPANY')
        return undefined;
    const domain = normalizeDomain(candidate.website);
    if (domain)
        return `domain:${domain}`;
    const name = normalizeCompanyName(candidate.displayName);
    const country = candidate.country?.trim().toLowerCase();
    if (name && country)
        return `name-country:${name}:${country}`;
    return undefined;
}
export function rankCandidateForEnrichment(candidate) {
    const reasons = [];
    let score = Math.max(0, Math.min(1, candidate.matchScore ?? 0.35)) * 0.55;
    if (candidate.website) {
        score += 0.16;
        reasons.push('has_website');
    }
    if (candidate.email) {
        score += 0.08;
        reasons.push('has_email');
    }
    if (candidate.phone) {
        score += 0.06;
        reasons.push('has_phone');
    }
    if (candidate.description) {
        score += 0.05;
        reasons.push('has_description');
    }
    if (candidate.country) {
        score += 0.04;
        reasons.push('has_country');
    }
    if (candidate.industry) {
        score += 0.03;
        reasons.push('has_industry');
    }
    if (candidate.isTargetCustomer) {
        score += 0.12;
        reasons.push('target_match');
    }
    if (candidate.candidateType !== 'COMPANY') {
        score -= 0.5;
        reasons.push('not_company');
    }
    return {
        candidate,
        score: Math.round(Math.max(0, Math.min(1, score)) * 100) / 100,
        reasons,
    };
}
export function selectCandidatesForEnrichment(candidates, limit) {
    const ranked = candidates.map(rankCandidateForEnrichment);
    const eligible = ranked
        .filter(item => item.candidate.candidateType === 'COMPANY' && item.candidate.id)
        .sort((a, b) => b.score - a.score || a.candidate.displayName.localeCompare(b.candidate.displayName));
    return {
        selected: eligible.slice(0, limit),
        skipped: {
            nonCompany: ranked.filter(item => item.candidate.candidateType !== 'COMPANY').length,
            missingId: ranked.filter(item => item.candidate.candidateType === 'COMPANY' && !item.candidate.id).length,
            belowLimit: Math.max(0, eligible.length - limit),
        },
    };
}
//# sourceMappingURL=candidate-utils.js.map