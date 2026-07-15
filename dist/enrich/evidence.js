export function addEvidence(target, field, value, source, confidence, sourceUrl) {
    const normalized = value?.trim();
    if (!normalized)
        return;
    if (target.some(item => item.field === field && item.value.toLowerCase() === normalized.toLowerCase() && item.source === source))
        return;
    target.push({
        field,
        value: normalized,
        source,
        sourceUrl,
        confidence: Math.max(0, Math.min(1, confidence)),
        observedAt: new Date().toISOString(),
    });
}
export function resolveEvidence(field, evidence) {
    const matching = evidence.filter(item => item.field === field);
    if (!matching.length)
        return {};
    const groups = new Map();
    for (const item of matching) {
        const key = normalizeEvidenceValue(field, item.value);
        const existing = groups.get(key) || { value: item.value, sources: new Set(), confidence: 0 };
        existing.sources.add(item.source);
        existing.confidence = Math.max(existing.confidence, item.confidence);
        groups.set(key, existing);
    }
    const ranked = [...groups.values()].sort((a, b) => b.confidence - a.confidence || b.sources.size - a.sources.size);
    const value = ranked[0].value;
    if (ranked.length === 1)
        return { value };
    return {
        value,
        conflict: {
            field,
            values: ranked.map(item => ({ value: item.value, sources: [...item.sources], confidence: item.confidence })),
            resolvedValue: value,
            reason: 'highest_confidence_evidence',
        },
    };
}
function normalizeEvidenceValue(field, value) {
    const normalized = value.trim().toLowerCase();
    if (field === 'website') {
        try {
            return new URL(/^https?:\/\//i.test(normalized) ? normalized : `https://${normalized}`).hostname.replace(/^www\./, '');
        }
        catch {
            return normalized;
        }
    }
    if (field === 'phone')
        return normalized.replace(/[^\d+]/g, '');
    return normalized;
}
//# sourceMappingURL=evidence.js.map