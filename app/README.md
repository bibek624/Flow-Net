# Flare

**Report what you see. Responders see it in seconds. Alerts reach the block, not the county.**

Flare turns every phone into a verified sensor for the people who manage emergencies. A resident sends a photo, a video, a voice note, or a few words. Claude reads it, labels it, and groups it with nearby reports into one incident. Responders watch incidents form on a live map, with a summary, the media, the people asking for help, and a suggested alert zone drawn from where the reports came from and which way the wind blows. A person approves every alert, and only the phones inside the zone receive it.

The same code runs as a city emergency operations center, a seaport operations center, or a military base force-protection desk. Switch the profile and the categories, alert wording, and demo scenario change with it.

## Try it

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/bibek624/Flow-Net/tree/claude/incident-reporting-app-fk0k3w)

One click, a free Render account, and about three minutes. Render builds from this branch and gives you an `https://` link that works on any phone, which is what the camera, microphone, and location need. During setup it asks for `ANTHROPIC_API_KEY`; paste one to turn on Claude triage, or leave it blank to run in keyword mode.

Or run it on a laptop:

```bash
cd app
npm install
ANTHROPIC_API_KEY=sk-ant-... npm start
```

Open http://localhost:3000/responder on the laptop and http://localhost:3000 on a phone on the same Wi-Fi. For the phone's camera and microphone over the network you need HTTPS: `npx localtunnel --port 3000` prints an `https://` link.

Any container host works too (`app/Dockerfile`): Fly.io, Koyeb, Railway, Hugging Face Spaces.

| Page | URL | Who uses it |
|---|---|---|
| Resident app | `/` | Anyone with a phone. No install. Add it to the home screen to get an icon. |
| Responder dashboard | `/responder` | City, port, or base staff. Laptop, tablet, or phone. |

Demo data loads on first start. All names, numbers, and reports in it are made up.

## The demo in five minutes

1. **Dashboard.** Six incidents are live in Los Angeles. The impact strip at the top already makes the case: 46 reports folded into 6 incidents, 86% less for a dispatcher to look at. Three people are waiting for urgent help.
2. **Phone.** Open the resident app. The strip at the top says you are inside the wildfire smoke area, 70 m from it, and the page warms to red. The map shows what is around you.
3. **Report.** Tap Camera, take a photo, send. Within two seconds it is on the dashboard map, labeled, and grouped with the 14 other reports of the same fire. The phone shows every step: sent, located, identified, matched with 14 others, waiting for a person.
4. **Alert.** On the dashboard open the wildfire and click **Send targeted alert**. The zone is drawn from the reports and stretched downwind. It reaches about 8,000 people instead of 10 million. Approve it. The phone inside the zone shows the alert at the top of its screen.
5. **Dual use.** Change the profile from City to Port. The dashboard reloads as the Port of Los Angeles: a container stack fire, a drone over the cruise terminal, a barge adrift. Change it to Base: a drone over the flight line, a cut perimeter fence. Same app, same phones, same 2-second loop.
6. **Replay.** Click **Replay demo** to watch a new incident arrive report by report and assemble itself. **Reset** puts everything back.

## What is different about it

- **Noise becomes signal.** Reports group into incidents by category and distance. Confidence rises with count and media. The dashboard measures its own effect live: duplicates folded, median AI triage time, median human review time.
- **Alerts go to a zone, not a county.** On January 9, 2025, an evacuation alert meant for one fire area reached nearly 10 million phones in LA County. Flare's zone is drawn from where the reports are, padded by hazard type, stretched downwind for fire and smoke, with the resident count shown before anyone presses send.
- **People stay in charge.** Nothing reaches the public automatically. Confirm, dispatch, alert, and marking someone safe each take a click from a responder.
- **It works when the network doesn't.** With no signal, a report and its location are saved on the phone and sent the moment signal returns. The app shell loads offline.
- **Dual use by design.** One profile file describes a deployment: who reports, what they can report, how reports merge, what an alert says, and the demo scenario. City, Port, and Base ship today.
- **No install, no update lag.** It is a website. Fixes reach every phone on the next load.

## How it works

```
phone ──► POST /api/reports ──► save ──► street name (OpenStreetMap)
                                   └──► Claude triage: category, severity, title, one-line summary
                                          └──► join the nearest matching incident, or start one
                                                 └──► incident summary (Claude) + alert zone (wind from Open-Meteo)
dashboard ◄── live updates (Server-Sent Events) ◄──┘
resident  ◄── nearby incidents, zones, alerts, NWS warnings for their location
```

- **Grouping.** A report joins an active incident when it is the same kind of event and close enough: 1.5 km for fire and smoke, 800 m for flooding, 400 m for gas, 300 m for a blocked road (per-profile in `lib/profiles.js`). Fire and smoke group together. A help request joins whatever is closest to the person.
- **Confidence.** Unconfirmed with one or two reports. Likely with three or more, or two with a photo or video. Confirmed only when a responder clicks Confirm.
- **Alert zone.** The outline of every report location, padded by a buffer for that kind of event. For fire, smoke, and gas, stretched downwind using live wind. The people count is the zone's area times the profile's population density, and the dashboard labels it as an estimate.
- **Outside data.** Wind from Open-Meteo, street names from OpenStreetMap Nominatim, active warnings (Red Flag, High Wind, Flood) from the National Weather Service. All free, all optional; the app runs without them.
- **AI.** Claude Opus 5.5 with structured output for triage and summaries. Anthropic's server-side fallback is on, so a report Claude declines is retried on another Claude model. With no API key, keyword rules do the sorting and the dashboard says so.

## Tests

125 browser tests click through every screen in both themes: every report flow, help and silent help, offline saving, responder actions, live updates, alerts, profile switching, impact numbers, layout from 320 to 1600 pixels, text contrast, speed budgets, and zero console errors.

```bash
cd app
npm test                 # about 2.5 minutes
npm run test:report      # opens the results in a browser
```

Screenshots of every screen in both themes land in `test-results/visual/`.

## Settings

| Variable | Default | What it does |
|---|---|---|
| `ANTHROPIC_API_KEY` | none | Turns on Claude triage and summaries |
| `CLAUDE_MODEL` | `claude-opus-5-5` | Model for triage and summaries |
| `PROFILE` | `city` | Starting deployment profile: `city`, `port`, or `base` |
| `APP_NAME` | `Flare` | Name shown on both pages |
| `PORT` | `3000` | Server port |
| `SEED_ON_START` | `true` | Load demo incidents when the database is empty |
| `REPLAY_INTERVAL_MS` | `4000` | Gap between replayed demo reports |
| `POP_DENSITY_PER_KM2` | per profile | Overrides the people-reached estimate |
| `DATA_DIR`, `UPLOAD_DIR` | `./data`, `./uploads` | Where the database and media live |
| `TZ_DISPLAY` | `America/Los_Angeles` | Time zone used in written summaries |
| `GEOCODE_CONTACT` | none | Contact email sent to OpenStreetMap's street-name service |

## Files

```
app/
  server.js            routes, uploads, live updates, impact numbers
  lib/profiles.js      City, Port, Base: categories, merge distances, alert wording, scenarios
  lib/categories.js    the active profile
  lib/pipeline.js      what happens to a report after it arrives
  lib/triage.js        Claude calls, with keyword fallback
  lib/zone.js          alert zone and people estimate
  lib/external.js      wind, street names, NWS warnings
  lib/geo.js           distance, outline, area math
  lib/db.js            SQLite tables (built into Node)
  scripts/scenario.js  demo incidents and the live replay
  scripts/build-icons.mjs  builds public/icons.js from Phosphor Icons
  public/              resident app and responder dashboard (plain HTML, CSS, JS)
  tests/               Playwright browser tests
```

## Known limits

- The camera uses the phone's own camera app instead of an in-page viewfinder. It is more reliable on iPhone.
- Live voice transcription uses the browser's speech recognition. Safari and Chrome support it; the recording is still sent where it isn't.
- "Text back" and "Connect me to a person" put the person on the responder map and queue. Two-way chat and live calls are not built yet.
- No login on the dashboard. Add one before putting real reports on a public URL.
- Render's free plan has no persistent disk, so uploads and reports reset when the service restarts. Fine for a demo; add a disk or a hosted database for real use.
