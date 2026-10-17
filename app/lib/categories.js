// One place for category rules: labels, how far apart reports can be and still
// describe the same incident, and how much buffer the impact zone gets.

export const CATEGORIES = {
  fire: { label: 'Fire', family: 'fire', mergeM: 1500, bufferM: 400 },
  smoke: { label: 'Smoke', family: 'fire', mergeM: 1500, bufferM: 500 },
  flood: { label: 'Flood', family: 'flood', mergeM: 800, bufferM: 250 },
  power: { label: 'Power out', family: 'power', mergeM: 1200, bufferM: 200 },
  gas: { label: 'Gas smell', family: 'gas', mergeM: 400, bufferM: 300 },
  road: { label: 'Road blocked', family: 'road', mergeM: 300, bufferM: 150 },
  other: { label: 'Other', family: 'other', mergeM: 300, bufferM: 200 },
};

export const CATEGORY_KEYS = Object.keys(CATEGORIES);

// Chips on the resident Text screen map straight to categories.
export const CHIP_TO_CATEGORY = {
  Fire: 'fire',
  Smoke: 'smoke',
  Flood: 'flood',
  'Power out': 'power',
  'Gas smell': 'gas',
  'Road blocked': 'road',
  Other: 'other',
};

// Keyword fallback, used when no Claude API key is set or a call fails.
const KEYWORDS = [
  ['fire', /\b(fire|flames?|burning|blaze|on fire|embers?)\b/i],
  ['smoke', /\b(smoke|smoky|ash|haze|smell(s)? like burning)\b/i],
  ['flood', /\b(flood(ed|ing)?|water (is )?(rising|coming)|water (over|on|across|in) the (road|street)|underwater|overflow(ing)?|submerged)\b/i],
  ['gas', /\b(gas (smell|leak)|smells? (like )?gas|rotten eggs?|natural gas)\b/i],
  ['power', /\b(power (is )?(out|down)|outage|no power|blackout|lights? (went )?out|downed (power )?line)\b/i],
  ['road', /\b(road (is )?(blocked|closed)|tree (is )?down|fallen tree|debris|can'?t get through|lanes? blocked)\b/i],
];

export function keywordCategory(text) {
  for (const [cat, re] of KEYWORDS) if (re.test(text)) return cat;
  return 'other';
}

export function keywordSeverity(text, flags = []) {
  if (flags.includes('trapped') || flags.includes('hurt')) return 5;
  if (/\b(trapped|injur|hurt|can'?t breathe|kids?|children|evacuat|spreading)\b/i.test(text)) return 4;
  if (/\b(flames?|fire|rising|stalled|downed)\b/i.test(text)) return 3;
  return 2;
}
