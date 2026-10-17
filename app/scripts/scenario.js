// Demo data for Los Angeles. Baseline: six incidents already in progress.
// Replay: a new brush fire comes in live, one report every few seconds, through
// the same pipeline real reports use (including Claude triage when a key is set).
// All names, numbers, and reports here are made up for the demo.

import { insert, update, logEvent, all } from '../lib/db.js';
import { cluster, ingest, newId, bus, refreshIncidentStats } from '../lib/pipeline.js';
import { computeZone } from '../lib/zone.js';
import { offset } from '../lib/geo.js';

function rng(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// [minutes ago, kind, category, severity, text]
const BASELINE = [
  {
    category: 'smoke', center: [34.1185, -118.29], spreadM: 550, place: 'Los Feliz hills, near Vermont Canyon Rd',
    title: 'Wildfire smoke', confirmed: false,
    summary: '14 residents report smoke in the hills above Los Feliz since 38 minutes ago. Several describe visible flames behind houses near Vermont Canyon Rd. Neighbors on one street are loading their cars. One resident is trapped and asked for help.',
    reports: [
      [38, 'text', 'smoke', 2, 'Strong smoke smell near Vermont Canyon Rd.'],
      [36, 'text', 'smoke', 2, 'Ash falling on my street, really thick smoke.'],
      [33, 'voice', 'smoke', 3, "There's a lot of smoke coming down the hill, I can see orange through the trees."],
      [30, 'text', 'smoke', 2, 'Smoke over the park, visibility is bad.'],
      [27, 'text', 'fire', 3, 'Orange glow over the ridge behind the observatory road.'],
      [24, 'voice', 'smoke', 2, 'Smells like burning wood, there is ash all over my car.'],
      [21, 'text', 'smoke', 3, 'Smoke drifting over the houses, wind is pushing it downhill.'],
      [18, 'text', 'fire', 4, 'Flames visible behind the houses at the top of my street.'],
      [15, 'text', 'fire', 4, 'Embers landing in my backyard.'],
      [12, 'text', 'fire', 4, 'Can see flames from my window, behind the yellow house.'],
      [9, 'voice', 'fire', 4, "Fire's right behind the houses now, my neighbors are loading their cars."],
      [6, 'text', 'fire', 4, 'Flames along the fence line at the end of the cul-de-sac.'],
      [3, 'text', 'smoke', 3, 'Smoke column getting bigger, coming from the park.'],
    ],
    help: [5, 'Maria L.', '(323) 555-0147', ['trapped'], 'Smoke in the hallway, the back door is blocked. Two kids with me.'],
  },
  {
    category: 'fire', center: [34.044, -118.2565], spreadM: 120, place: 'Downtown, Broadway & 9th St',
    title: 'Structure fire', confirmed: true,
    summary: '6 reports of a fire in a two-story building near Broadway and 9th St since 22 minutes ago. Fire crews confirmed the fire on scene. One resident says people may still be in the upstairs units.',
    reports: [
      [22, 'text', 'fire', 4, 'Building on fire at Broadway and 9th, smoke everywhere.'],
      [20, 'text', 'fire', 4, 'Flames coming out of a second floor window.'],
      [18, 'voice', 'fire', 5, "I think my neighbors upstairs are still in there, I've been knocking."],
      [17, 'text', 'fire', 3, 'Smoke pouring from the roofline.'],
      [11, 'text', 'fire', 3, 'Fire trucks arriving now.'],
      [3, 'text', 'fire', 3, 'Residents standing on the sidewalk across the street.'],
    ],
  },
  {
    category: 'flood', center: [34.096, -118.247], spreadM: 300, place: 'Elysian Valley, Riverside Dr underpass',
    title: 'Street flooding', confirmed: false,
    summary: '8 residents report water across Riverside Dr at the underpass for over an hour. One car is reported stalled in the water and water is entering garages nearby. One person fell and is injured.',
    reports: [
      [70, 'text', 'flood', 3, 'Riverside Dr underpass flooded.'],
      [62, 'text', 'flood', 3, 'Water under the bridge is getting deep.'],
      [51, 'voice', 'flood', 3, 'Riverside Drive is a river right now, do not drive through.'],
      [40, 'text', 'flood', 4, 'A car is stalled in the underpass.'],
      [39, 'voice', 'flood', 4, "There's a car stuck in the underpass, the driver got out, water is rising."],
      [22, 'text', 'flood', 3, 'Water coming into garages on my block.'],
      [15, 'text', 'flood', 2, 'Storm drain overflowing at the corner.'],
      [6, 'text', 'flood', 3, 'Water up to car bumpers now.'],
    ],
    help: [4, 'Caller A7F2', '', ['hurt'], "Fell on the wet stairs, can't stand up. Water is coming in."],
  },
  {
    category: 'power', center: [34.0255, -118.2915], spreadM: 450, place: 'University Park, Vermont Ave & Jefferson Blvd',
    title: 'Power out', confirmed: true,
    summary: '12 residents report no power across several blocks around Vermont Ave and Jefferson Blvd for close to two hours. The utility confirmed the outage. One resident reports a downed line, and one uses home oxygen on a backup battery.',
    reports: [
      [105, 'text', 'power', 2, 'Power out on my street.'],
      [101, 'text', 'power', 3, 'Heard a pop and everything went dark.'],
      [99, 'text', 'power', 3, 'Downed power line on the sidewalk.'],
      [95, 'text', 'power', 2, 'No power, traffic light at the corner is out too.'],
      [90, 'text', 'power', 2, 'Whole block is dark.'],
      [85, 'voice', 'power', 4, 'My dad uses an oxygen machine and the backup battery has about four hours left.'],
      [80, 'text', 'power', 2, 'Still no power here.'],
      [70, 'text', 'power', 2, 'Power out in our apartment building.'],
      [60, 'text', 'power', 2, 'No lights on my street.'],
      [45, 'text', 'power', 2, 'Power still out.'],
      [30, 'text', 'power', 2, 'Our fridge has been off for over an hour.'],
    ],
    help: [2, 'J. Okafor', 'Text only', ['silent', 'hurt'], "Someone is trying to get in. Can't talk. Please send someone."],
  },
  {
    category: 'gas', center: [34.079, -118.258], spreadM: 90, place: 'Echo Park, Echo Park Ave & Morton Ave',
    title: 'Gas smell', confirmed: false,
    summary: '3 residents report a strong gas smell within one block of Echo Park Ave and Morton Ave since 12 minutes ago. No photos yet.',
    reports: [
      [12, 'text', 'gas', 3, 'Smells like gas on my street.'],
      [9, 'voice', 'gas', 3, 'Really strong gas smell outside, like rotten eggs, near the corner.'],
      [2, 'voice', 'gas', 4, 'The smell is getting stronger by the side of my house.'],
    ],
  },
  {
    category: 'road', center: [34.129, -118.377], spreadM: 60, place: 'Mulholland Dr near Laurel Canyon Blvd',
    title: 'Road blocked', confirmed: false,
    summary: '2 drivers report a fallen tree blocking both lanes of Mulholland Dr near Laurel Canyon Blvd since 8 minutes ago.',
    reports: [
      [8, 'text', 'road', 2, "Big tree down on Mulholland, can't get through."],
      [5, 'text', 'road', 2, 'Tree across both lanes near Laurel Canyon.'],
    ],
  },
];

export async function loadBaseline() {
  const R = rng(7);
  const now = Date.now();
  const at = (minAgo) => now - minAgo * 60000;
  const scatter = (center, spreadM) => offset(center, spreadM * Math.sqrt(R()), R() * 360);

  for (const scene of BASELINE) {
    let incId = null;
    const add = (r, place) => {
      insert('reports', r);
      const inc = cluster(r, { place });
      incId = inc.id;
      logEvent(inc.id, `${r.urgent ? 'Help request' : r.kind === 'voice' ? 'Voice note' : 'Text report'}: ${r.title}`, r.created_at);
    };
    for (const [minAgo, kind, category, severity, text] of scene.reports) {
      const [lat, lng] = scatter(scene.center, scene.spreadM);
      add({
        id: newId('rep'), created_at: at(minAgo), kind, category, severity,
        text: kind === 'text' ? text : '', transcript: kind === 'voice' ? text : '',
        title: text.split(' ').slice(0, 6).join(' ').replace(/[.,]$/, ''), ai_summary: text,
        lat, lng, accuracy_m: 10, address: scene.place, status: 'triaged', triage_source: 'seed', source: 'seed',
        media_duration_s: kind === 'voice' ? 8 + Math.round(R() * 25) : null,
      }, scene.place);
    }
    if (scene.help) {
      const [minAgo, name, contact, flags, text] = scene.help;
      const [lat, lng] = scatter(scene.center, scene.spreadM * 0.6);
      add({
        id: newId('rep'), created_at: at(minAgo), kind: 'help', category: scene.category, severity: 5,
        text, title: text.split(' ').slice(0, 6).join(' ').replace(/[.,]$/, ''), ai_summary: text,
        flags, lat, lng, accuracy_m: 8, address: scene.place, status: 'triaged', triage_source: 'seed', source: 'seed',
        urgent: 1, help_status: 'waiting', contact_name: name, contact_info: contact,
      }, scene.place);
    }
    refreshIncidentStats(incId);
    update('incidents', incId, { title: scene.title, summary: scene.summary, summary_source: 'seed', confirmed: scene.confirmed ? 1 : 0, place: scene.place });
  }

  // Zones need wind data, so fill them in without holding up startup.
  for (const inc of all("SELECT * FROM incidents WHERE status = 'active'")) {
    const reports = all('SELECT * FROM reports WHERE incident_id = ?', inc.id);
    computeZone(inc, reports).then((zone) => {
      update('incidents', inc.id, { zone });
      bus.emit('change', { type: 'incident', id: inc.id });
    });
  }
}

// A brush fire near Baldwin Hills, arriving live.
const REPLAY_CENTER = [34.0085, -118.3505];
const REPLAY = [
  ['text', 'Smoke coming off the hills near the scenic overlook.'],
  ['voice', 'I can smell smoke really strong by the park entrance, looks like it is coming from the hillside.'],
  ['text', 'Seeing flames on the brush above the oil field road.'],
  ['text', 'Fire is moving up the hill, it is getting bigger fast.'],
  ['voice', 'There are flames near the trail and the wind is blowing the smoke toward the houses on the north side.'],
  ['text', 'Ash falling on cars in the parking lot.'],
  ['help', "My mom can't walk and the smoke is getting in the house.", ['hurt']],
  ['text', 'Flames close to the homes at the top of the street now.'],
];

let replayTimer = null;
export const replayRunning = () => Boolean(replayTimer);

export function stopReplay() {
  clearInterval(replayTimer);
  replayTimer = null;
}

export function startReplay(intervalMs = Number(process.env.REPLAY_INTERVAL_MS || 4000)) {
  stopReplay();
  const R = rng(Date.now() & 0xffff);
  let i = 0;
  const next = () => {
    if (i >= REPLAY.length) return stopReplay();
    const [kind, text, flags] = REPLAY[i++];
    const [lat, lng] = offset(REPLAY_CENTER, 450 * Math.sqrt(R()), R() * 360);
    ingest(
      {
        id: newId('rep'), created_at: Date.now(), kind,
        text: kind === 'voice' ? '' : text, transcript: kind === 'voice' ? text : '',
        flags: flags || [], lat, lng, accuracy_m: 12, address: 'Baldwin Hills, near the scenic overlook',
        urgent: kind === 'help' ? 1 : 0, help_status: kind === 'help' ? 'waiting' : null,
        contact_name: kind === 'help' ? 'D. Nguyen' : null, contact_info: kind === 'help' ? '(323) 555-0182' : null,
        media_duration_s: kind === 'voice' ? 14 : null, source: 'seed',
      },
      { skipGeocode: true },
    ).catch((e) => console.error('[replay]', e));
  };
  next();
  replayTimer = setInterval(next, intervalMs);
}
