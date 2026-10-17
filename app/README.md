# Beacon: incident reporting for residents and responders

Working name. Change it with the `APP_NAME` setting.

Residents report what they see with a photo, a video, a voice note, or a few words. Claude reads each report, labels it, and groups it with nearby reports into one incident. Responders see every incident on a live map, with a summary, the media, and a suggested alert zone. A person approves every alert before it goes out, and residents inside the zone see it on their phones.

Two pages, one server:

| Page | URL | Who uses it |
|---|---|---|
| Resident app | `/` | Anyone with a phone. No install. Add it to the home screen to get an app icon. |
| Responder dashboard | `/responder` | City or emergency staff. Works on a laptop, a tablet, or a phone. |

## Run it

Needs Node 22.13 or newer.

```bash
cd app
npm install
ANTHROPIC_API_KEY=sk-ant-... npm start
```

Open http://localhost:3000/responder and http://localhost:3000.

Without an API key the app still runs. It sorts reports with keyword rules instead of Claude, and the dashboard shows "AI off".

On first start it loads six demo incidents around Los Angeles. All names, phone numbers and reports in the demo are made up.

### Test on your iPhone

iPhones only allow camera, microphone, and location on HTTPS pages. Two options:

1. Deploy it (below) and open the HTTPS link.
2. Run it on your laptop and open a tunnel: `npx localtunnel --port 3000`, then open the HTTPS link it prints on your phone.

## Demo script

1. Open the dashboard. Six incidents are already active, with three people waiting for urgent help.
2. Click **Replay live demo**. A new brush fire near Baldwin Hills comes in, one report every four seconds. Watch the reports group into one incident and the summary update.
3. On a phone, open the resident app and send a report. It shows up on the map within a second or two. The phone shows each step: sent, location attached, identified as, how many others reported it nearby.
4. In the dashboard, open the wildfire, click **Send targeted alert**, adjust the zone, and approve. A resident phone inside the zone shows the alert on its home screen.
5. Click **Confirm** on an incident. The resident's status screen changes to "A responder has seen this".
6. **Reset** puts the demo back to the start.

## How it works

```
phone ──► POST /api/reports ──► save ──► street name (OpenStreetMap)
                                   └──► Claude triage: category, severity, title, one-line summary
                                          └──► join the nearest matching incident, or start one
                                                 └──► incident summary (Claude) + impact zone (wind from Open-Meteo)
dashboard ◄── live updates (Server-Sent Events) ◄──┘
```

- **Grouping.** A report joins an active incident when it is the same kind of event and close enough: 1.5 km for fire and smoke, 800 m for flooding, 400 m for gas, 300 m for a blocked road. Fire and smoke group together. A help request joins whatever incident is closest to the person.
- **Confidence.** Unconfirmed with one or two reports. Likely with three or more, or two with a photo or video. Confirmed only when a responder clicks Confirm.
- **Alert zone.** The outline of every report location, padded by a buffer for that kind of event. For fire and smoke, the zone stretches downwind using live wind data. The resident count is the zone's area times average population density (3,200 per km² for LA, set with `POP_DENSITY_PER_KM2`). It is an estimate, and the dashboard labels it that way.
- **People stay in charge.** Nothing goes to the public automatically. Alerts, dispatch, and marking someone safe all need a click from a responder.

## Settings

| Variable | Default | What it does |
|---|---|---|
| `ANTHROPIC_API_KEY` | none | Turns on Claude triage and summaries |
| `CLAUDE_MODEL` | `claude-opus-5-5` | Model for triage and summaries |
| `PORT` | `3000` | Server port |
| `APP_NAME` | `Beacon` | Name shown in both pages |
| `SEED_ON_START` | `true` | Load demo incidents when the database is empty |
| `REPLAY_INTERVAL_MS` | `4000` | Gap between replayed demo reports |
| `POP_DENSITY_PER_KM2` | `3200` | Used for the residents-reached estimate |
| `DATA_DIR`, `UPLOAD_DIR` | `./data`, `./uploads` | Where the database and media files live |
| `TZ_DISPLAY` | `America/Los_Angeles` | Time zone used in written summaries |
| `GEOCODE_CONTACT` | none | Contact email sent to OpenStreetMap's street-name service |

## Deploy

Any host that runs Node and keeps files on disk works. On Render: create a Web Service from this repo, set the root directory to `app`, build command `npm install`, start command `npm start`, add a disk mounted at `/data`, and set `DATA_DIR=/data/db`, `UPLOAD_DIR=/data/uploads`, and `ANTHROPIC_API_KEY`.

## Files

```
app/
  server.js            routes, uploads, live updates
  lib/pipeline.js      what happens to a report after it arrives
  lib/triage.js        Claude calls, with keyword fallback
  lib/zone.js          alert zone and resident estimate
  lib/categories.js    per-category distances and buffers
  lib/geo.js           distance, outline, area math
  lib/external.js      wind and street-name lookups
  lib/db.js            SQLite tables (built into Node)
  scripts/scenario.js  demo incidents and the live replay
  public/              resident app and responder dashboard (plain HTML, CSS, JS)
```

## Known limits

- Camera uses the phone's own camera app (photo or video) instead of an in-page viewfinder. It is more reliable on iPhone.
- Live voice transcription uses the browser's speech recognition. Safari and Chrome support it; the recording is still sent where it isn't.
- "Text back" and "Connect me to a person" put the person on the responder's map and queue. Two-way chat and live calls are not built yet.
- No login on the dashboard yet. Do not put real reports on a public URL without adding one.
