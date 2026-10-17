// The active deployment profile and its categories. Everything that needs to
// know "what can be reported here" asks this module, never profiles.js directly.

import { PROFILES, SAME_EVENT } from './profiles.js';
import { getSetting, setSetting } from './db.js';

let active = null;

export function activeProfile() {
  if (!active) {
    const key = getSetting('profile') || process.env.PROFILE || 'city';
    active = PROFILES[key] || PROFILES.city;
  }
  return active;
}

export function setActiveProfile(key) {
  if (!PROFILES[key]) throw new Error(`Unknown profile: ${key}`);
  setSetting('profile', key);
  active = PROFILES[key];
  return active;
}

export const getCategories = () => activeProfile().categories;
export const categoryKeys = () => getCategories().map((c) => c.key);

export function category(key) {
  const cats = getCategories();
  return cats.find((c) => c.key === key) || cats.find((c) => c.key === 'other') || cats.at(-1);
}

// Two categories describe the same kind of event when their reports should
// merge into one incident: fire with smoke, otherwise only with themselves.
export function sameEvent(a, b) {
  return (SAME_EVENT[a] || a) === (SAME_EVENT[b] || b);
}

export function chipToCategory(label) {
  return getCategories().find((c) => c.label === label)?.key ?? null;
}

// Keyword fallback, used when no Claude API key is set or a call fails.
export function keywordCategory(text) {
  for (const c of getCategories()) if (c.keywords && c.keywords.test(text)) return c.key;
  return category('other').key;
}

export function keywordSeverity(text, flags = []) {
  if (flags.includes('trapped') || flags.includes('hurt')) return 5;
  if (/\b(trapped|injur|hurt|can'?t breathe|kids?|children|evacuat|spreading|collapsed|not responding)\b/i.test(text)) return 4;
  if (/\b(flames?|fire|rising|stalled|downed|breach|intruder|leak)\b/i.test(text)) return 3;
  return 2;
}
