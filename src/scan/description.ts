import type { NormalizedCandidate } from '../adapters/types.js';

function humanizeType(value: string): string {
  return value
    .replace(/_/g, ' ')
    .replace(/\b\w/g, char => char.toUpperCase())
    .trim();
}

function pickLocation(candidate: NormalizedCandidate): string | undefined {
  if (candidate.city?.trim()) return candidate.city.trim();
  if (!candidate.address?.trim()) return undefined;
  // Prefer a short locality-like fragment from formatted address
  const parts = candidate.address.split(',').map(part => part.trim()).filter(Boolean);
  if (parts.length >= 2) return parts[parts.length - 2];
  return parts[0];
}

function pickRole(candidate: NormalizedCandidate): string | undefined {
  if (candidate.industry?.trim()) return candidate.industry.trim();

  const raw = candidate.rawData || {};
  const primaryTypeDisplayName =
    typeof raw.primaryTypeDisplayName === 'string' ? raw.primaryTypeDisplayName.trim() : '';
  if (primaryTypeDisplayName) return primaryTypeDisplayName;

  const categories = Array.isArray(raw.categories)
    ? raw.categories.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : [];
  if (categories[0]) return humanizeType(categories[0]);

  const types = Array.isArray(raw.types)
    ? raw.types.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : [];
  const skip = new Set(['point_of_interest', 'establishment', 'geocode', 'political']);
  const useful = types.find(type => !skip.has(type.toLowerCase()));
  if (useful) return humanizeType(useful);

  return undefined;
}

function pickRatingSentence(candidate: NormalizedCandidate): string | undefined {
  const raw = candidate.rawData || {};
  const rating = typeof raw.rating === 'number' ? raw.rating : undefined;
  const reviewCount =
    typeof raw.reviewCount === 'number'
      ? raw.reviewCount
      : typeof raw.userRatingCount === 'number'
        ? raw.userRatingCount
        : undefined;
  if (rating == null) return undefined;
  if (reviewCount != null && reviewCount > 0) {
    return `Rated ${rating} (${reviewCount} reviews).`;
  }
  return `Rated ${rating}.`;
}

/** Build a short English blurb when provider description is missing. */
export function composeDescription(candidate: NormalizedCandidate): string | undefined {
  const role = pickRole(candidate);
  const location = pickLocation(candidate);
  const ratingSentence = pickRatingSentence(candidate);

  const sentences: string[] = [];
  if (role && location) {
    sentences.push(`${role} in ${location}.`);
  } else if (role) {
    sentences.push(`${role}.`);
  } else if (location) {
    sentences.push(`Business in ${location}.`);
  } else if (candidate.address?.trim()) {
    sentences.push(`Located at ${candidate.address.trim()}.`);
  }

  if (ratingSentence) sentences.push(ratingSentence);

  const text = sentences.join(' ').trim();
  return text || undefined;
}

/** Ensure candidate.description is populated when providers omit it. */
export function ensureDescription(candidate: NormalizedCandidate): NormalizedCandidate {
  if (candidate.description?.trim()) return candidate;
  const description = composeDescription(candidate);
  if (!description) return candidate;
  return { ...candidate, description };
}
