// Deployment profiles. The same app serves a city, a seaport, or a military
// base; only this file changes. Each profile sets what people can report, how
// close two reports must be to count as one incident, what an alert says, and
// the demo scenario. All names, numbers and reports in scenarios are made up.

// Grouping distance (m) and alert buffer (m) by kind of event.
const FAMILY = {
  fire: { mergeM: 1500, bufferM: 400 },
  smoke: { mergeM: 1500, bufferM: 500 },
  flood: { mergeM: 800, bufferM: 250 },
  power: { mergeM: 1200, bufferM: 200 },
  gas: { mergeM: 400, bufferM: 300 },
  road: { mergeM: 300, bufferM: 150 },
  security: { mergeM: 600, bufferM: 200 },
  vessel: { mergeM: 1000, bufferM: 300 },
  medical: { mergeM: 150, bufferM: 100 },
  other: { mergeM: 300, bufferM: 200 },
};

// Fire and smoke describe the same event; everything else groups only with itself.
export const SAME_EVENT = { fire: 'fire', smoke: 'fire' };

const cat = (key, label, family, color, icon, keywords, extra = {}) => ({ key, label, family, color, icon, keywords, ...FAMILY[family], ...extra });

const K = {
  fire: /\b(fire|flames?|burning|blaze|on fire|embers?)\b/i,
  smoke: /\b(smoke|smoky|ash|haze|smell(s)? like burning)\b/i,
  flood: /\b(flood(ed|ing)?|water (is )?(rising|coming)|water (over|on|across|in) the (road|street|dock|wharf)|underwater|overflow(ing)?|submerged|surge)\b/i,
  gas: /\b(gas (smell|leak)|smells? (like )?gas|rotten eggs?|natural gas)\b/i,
  hazmat: /\b(chemical|fumes|hazmat|leak(ing)?|spill(ed|ing)?|fuel|diesel|ammonia|chlorine|placard)\b/i,
  power: /\b(power (is )?(out|down)|outage|no power|blackout|lights? (went )?out|downed (power )?line)\b/i,
  road: /\b(road (is )?(blocked|closed)|tree (is )?down|fallen tree|debris|can'?t get through|lanes? blocked)\b/i,
  drone: /\b(drones?|uav|quadcopter|unmanned|flying (object|thing))\b/i,
  security: /\b(suspicious|breach|fence (cut|down)|intruder|unauthori[sz]ed|trespass|shots? fired|gunshots?|break(ing)? in)\b/i,
  vessel: /\b(vessel|ship|boat|barge|tug|adrift|collision|capsiz|man overboard|hull)\b/i,
  crane: /\b(crane|gantry|container(s)? (fell|falling|down)|stack (collapsed|fell)|equipment (failure|damage))\b/i,
  medical: /\b(injur|hurt|unconscious|not breathing|heart|bleeding|collapsed|medic)\b/i,
};

const HELP_FLAGS = [
  ['trapped', "I'm trapped"],
  ['hurt', 'Someone is hurt'],
  ['silent', "I can't speak safely"],
];

// Alert wording by event family. {where} is filled in from the incident.
const TEMPLATES = {
  fire: [
    ['Advisory', 'Smoke advisory', 'Smoke has been reported {where}. Keep windows closed and stay ready for updates. Call 911 only if you need help now.'],
    ['Prepare to leave', 'Fire alert: Prepare to leave', 'Fire crews are responding to smoke and flames {where}. If you are in this area, get ready to leave: pack essentials, charge your phone, and watch for updates. Call 911 only if you need help now.'],
    ['Evacuate now', 'Evacuate now', 'Leave now. A fire is spreading {where}. Follow directions from officials and avoid the fire area. Call 911 only if you need help now.'],
  ],
  flood: [
    ['Advisory', 'Flooding advisory', 'Flooding has been reported {where}. Do not drive or walk through water. Call 911 only if you need help now.'],
    ['Avoid area', 'Flooding: Avoid the area', 'Roads are flooded {where}. Stay off the roads and move valuables off the floor. Call 911 only if you need help now.'],
    ['Move to higher ground', 'Move to higher ground now', 'Water is rising {where}. Move to higher ground now. Do not enter flood water. Call 911 only if you need help now.'],
  ],
  gas: [
    ['Advisory', 'Hazard reported', 'A gas or chemical smell has been reported {where}. Crews are checking. Avoid open flames. Call 911 only if you need help now.'],
    ['Avoid area', 'Hazard: Avoid the area', 'Avoid the area {where}. Do not use lighters or switches if you smell gas. Call 911 only if you need help now.'],
    ['Evacuate now', 'Evacuate now', 'Leave the area {where} now and move upwind. Call 911 only if you need help now.'],
  ],
  security: [
    ['Advisory', 'Security notice', 'A security concern has been reported {where}. Stay alert and report anything unusual. Call 911 only if you need help now.'],
    ['Shelter in place', 'Shelter in place', 'Stay indoors {where}. Lock doors and stay away from windows until further notice. Call 911 only if you need help now.'],
    ['Avoid area', 'Avoid the area', 'Avoid the area {where} while officers respond. Call 911 only if you need help now.'],
  ],
  vessel: [
    ['Advisory', 'Marine incident', 'A vessel incident has been reported {where}. Keep clear of the water and follow crew instructions.'],
    ['Avoid area', 'Marine incident: Keep clear', 'Keep clear of the waterfront {where} while crews respond.'],
    ['Evacuate now', 'Evacuate the waterfront', 'Leave the waterfront {where} now and move inland.'],
  ],
  default: [
    ['Advisory', '{label} advisory', '{label} reported {where}. Stay alert for updates. Call 911 only if you need help now.'],
    ['Avoid area', '{label}: Avoid the area', 'Please avoid the area {where} while crews respond. Call 911 only if you need help now.'],
    ['Shelter in place', 'Stay where you are', 'Stay indoors {where} until further notice. Call 911 only if you need help now.'],
  ],
};

// ---------------------------------------------------------------------------

export const PROFILES = {
  city: {
    key: 'city',
    name: 'City',
    org: 'Los Angeles · Emergency Operations',
    audience: 'residents',
    reporterNoun: 'resident',
    emergencyNumber: '911',
    center: [34.06, -118.3],
    zoom: 11,
    popDensityPerKm2: 3200,
    population: 10_000_000,
    populationLabel: 'LA County',
    categories: [
      cat('fire', 'Fire', 'fire', 'fire', 'fire', K.fire),
      cat('smoke', 'Smoke', 'smoke', 'smoke', 'smoke', K.smoke),
      cat('flood', 'Flood', 'flood', 'flood', 'flood', K.flood),
      cat('power', 'Power out', 'power', 'power', 'power', K.power),
      cat('gas', 'Gas smell', 'gas', 'gas', 'gas', K.gas),
      cat('road', 'Road blocked', 'road', 'road', 'road', K.road),
      cat('other', 'Other', 'other', 'other', 'other', null),
    ],
    helpFlags: HELP_FLAGS,
    scenario: {
      baseline: [
        {
          category: 'smoke', center: [34.1185, -118.29], spreadM: 550, place: 'Los Feliz hills, near Vermont Canyon Rd', title: 'Wildfire smoke', confirmed: false,
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
          category: 'fire', center: [34.044, -118.2565], spreadM: 120, place: 'Downtown, Broadway & 9th St', title: 'Structure fire', confirmed: true, reviewedMin: 4,
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
          category: 'flood', center: [34.096, -118.247], spreadM: 300, place: 'Elysian Valley, Riverside Dr underpass', title: 'Street flooding', confirmed: false,
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
          category: 'power', center: [34.0255, -118.2915], spreadM: 450, place: 'University Park, Vermont Ave & Jefferson Blvd', title: 'Power out', confirmed: true, reviewedMin: 6,
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
          category: 'gas', center: [34.079, -118.258], spreadM: 90, place: 'Echo Park, Echo Park Ave & Morton Ave', title: 'Gas smell', confirmed: false,
          summary: '3 residents report a strong gas smell within one block of Echo Park Ave and Morton Ave since 12 minutes ago. No photos yet.',
          reports: [
            [12, 'text', 'gas', 3, 'Smells like gas on my street.'],
            [9, 'voice', 'gas', 3, 'Really strong gas smell outside, like rotten eggs, near the corner.'],
            [2, 'voice', 'gas', 4, 'The smell is getting stronger by the side of my house.'],
          ],
        },
        {
          category: 'road', center: [34.129, -118.377], spreadM: 60, place: 'Mulholland Dr near Laurel Canyon Blvd', title: 'Road blocked', confirmed: false,
          summary: '2 drivers report a fallen tree blocking both lanes of Mulholland Dr near Laurel Canyon Blvd since 8 minutes ago.',
          reports: [
            [8, 'text', 'road', 2, "Big tree down on Mulholland, can't get through."],
            [5, 'text', 'road', 2, 'Tree across both lanes near Laurel Canyon.'],
          ],
        },
      ],
      replay: {
        label: 'a brush fire near Baldwin Hills',
        center: [34.0085, -118.3505],
        place: 'Baldwin Hills, near the scenic overlook',
        helper: ['D. Nguyen', '(323) 555-0182'],
        reports: [
          ['text', 'Smoke coming off the hills near the scenic overlook.'],
          ['voice', 'I can smell smoke really strong by the park entrance, looks like it is coming from the hillside.'],
          ['text', 'Seeing flames on the brush above the oil field road.'],
          ['text', 'Fire is moving up the hill, it is getting bigger fast.'],
          ['voice', 'There are flames near the trail and the wind is blowing the smoke toward the houses on the north side.'],
          ['text', 'Ash falling on cars in the parking lot.'],
          ['help', "My mom can't walk and the smoke is getting in the house.", ['hurt']],
          ['text', 'Flames close to the homes at the top of the street now.'],
        ],
      },
    },
  },

  port: {
    key: 'port',
    name: 'Port',
    org: 'Port of Los Angeles · Operations Center',
    audience: 'workers and nearby residents',
    reporterNoun: 'worker',
    emergencyNumber: '911',
    center: [33.74, -118.265],
    zoom: 13,
    popDensityPerKm2: 1800,
    population: 190_000,
    populationLabel: 'San Pedro and Wilmington',
    categories: [
      cat('fire', 'Fire', 'fire', 'fire', 'fire', K.fire),
      cat('smoke', 'Smoke', 'smoke', 'smoke', 'smoke', K.smoke),
      cat('hazmat', 'Chemical / fuel', 'gas', 'gas', 'hazmat', new RegExp(`${K.gas.source}|${K.hazmat.source}`, 'i')),
      cat('vessel', 'Vessel incident', 'vessel', 'vessel', 'vessel', K.vessel),
      cat('drone', 'Drone sighting', 'security', 'security', 'drone', K.drone),
      cat('security', 'Suspicious activity', 'security', 'security', 'security', K.security),
      cat('crane', 'Equipment damage', 'road', 'road', 'crane', K.crane),
      cat('flood', 'Flooding / surge', 'flood', 'flood', 'flood', K.flood),
      cat('power', 'Power out', 'power', 'power', 'power', K.power),
      cat('other', 'Other', 'other', 'other', 'other', null),
    ],
    helpFlags: HELP_FLAGS,
    scenario: {
      baseline: [
        {
          category: 'fire', center: [33.7295, -118.2495], spreadM: 220, place: 'Pier 300, container yard', title: 'Container stack fire', confirmed: true, reviewedMin: 3,
          summary: '9 workers report a fire in a container stack at Pier 300 since 24 minutes ago. Two reports describe a chemical smell near the stack. Port police confirmed the fire on scene. One worker is trapped between stacks.',
          reports: [
            [24, 'text', 'smoke', 3, 'Black smoke coming from the stacks on the east side of the yard.'],
            [22, 'text', 'fire', 4, 'Flames at the base of a container stack, row 14.'],
            [20, 'voice', 'fire', 4, 'There is a container on fire near the rail spur, it is spreading to the next one.'],
            [18, 'text', 'fire', 4, 'Strong chemical smell near the burning stack, placard says corrosive.'],
            [15, 'text', 'fire', 4, 'Fire is now in three containers.'],
            [12, 'voice', 'smoke', 3, 'Smoke is blowing across the truck gate, drivers cannot see.'],
            [9, 'text', 'fire', 3, 'Fire boat moving in from the channel.'],
            [4, 'text', 'smoke', 3, 'Smoke still heavy over the yard.'],
          ],
          help: [6, 'R. Castillo', '(310) 555-0133', ['trapped'], 'Pinned between two stacks by a fallen container, leg is stuck. Smoke getting closer.'],
        },
        {
          category: 'drone', center: [33.7515, -118.2585], spreadM: 350, place: 'Berth 100, near the cruise terminal', title: 'Drone over terminal', confirmed: false,
          summary: '4 people report a drone flying low over Berth 100 and the cruise terminal since 15 minutes ago. One video shows it hovering above a moored vessel.',
          reports: [
            [15, 'text', 'drone', 2, 'Drone flying low over the cruise terminal parking.'],
            [12, 'video', 'drone', 3, 'Drone hovering over the ship at Berth 100.'],
            [8, 'text', 'drone', 3, 'Same drone now over the fuel dock.'],
            [3, 'text', 'drone', 3, 'Drone circling back toward the terminal roof.'],
          ],
        },
        {
          category: 'flood', center: [33.7625, -118.2735], spreadM: 260, place: 'Wilmington waterfront, Berth 150 to 155', title: 'Storm surge flooding', confirmed: false,
          summary: '7 reports of water over the wharf along Berths 150 to 155 during the high tide. One forklift is stalled in the water and the access road is flooded.',
          reports: [
            [55, 'text', 'flood', 2, 'Water coming over the edge of the wharf at Berth 152.'],
            [48, 'text', 'flood', 3, 'Access road to Berth 150 is under water.'],
            [40, 'voice', 'flood', 3, 'The whole apron is flooded, we moved the pallets but the forklift is stuck.'],
            [33, 'text', 'flood', 3, 'Water is up to the loading dock at 155.'],
            [20, 'text', 'flood', 2, 'Still rising with the tide.'],
            [12, 'text', 'flood', 3, 'Cars in the lot have water to the doors.'],
            [5, 'text', 'flood', 2, 'Water starting to drop a little.'],
          ],
          help: [7, 'Caller 2C91', '', ['hurt'], 'Slipped on the flooded apron, think my wrist is broken. Cannot drive out.'],
        },
        {
          category: 'vessel', center: [33.7205, -118.2715], spreadM: 180, place: 'Main Channel, off Berth 46', title: 'Vessel adrift', confirmed: false,
          summary: '3 reports of a barge drifting in the Main Channel near Berth 46 after breaking a line. No injuries reported.',
          reports: [
            [11, 'text', 'vessel', 3, 'Barge broke loose from its mooring and is drifting toward the channel.'],
            [8, 'voice', 'vessel', 3, 'The barge is swinging across the channel, tug is not here yet.'],
            [2, 'text', 'vessel', 3, 'Barge is close to the pilings now.'],
          ],
        },
        {
          category: 'crane', center: [33.7405, -118.2345], spreadM: 90, place: 'Pier 400, crane 7', title: 'Crane fault', confirmed: false,
          summary: '2 workers report a gantry crane stopped mid-lift with a container suspended over the lane at Pier 400.',
          reports: [
            [9, 'text', 'crane', 3, 'Crane 7 stopped with a box hanging over the truck lane.'],
            [4, 'text', 'crane', 3, 'Lane under crane 7 is closed, box still up there.'],
          ],
        },
      ],
      replay: {
        label: 'a chemical leak at a tank farm',
        center: [33.7705, -118.2525],
        place: 'Wilmington tank farm, near Anaheim St',
        helper: ['M. Reyes', '(310) 555-0171'],
        reports: [
          ['text', 'Strong fumes near the tank farm fence line, smells like rotten eggs.'],
          ['voice', 'There is a hissing sound from one of the tanks and a white cloud near the ground.'],
          ['text', 'Chemical smell is getting worse along Anaheim Street.'],
          ['text', 'Workers leaving the yard next door, several coughing.'],
          ['voice', 'The cloud is drifting toward the houses on the north side of the street.'],
          ['help', 'My coworker collapsed near the gate and is not responding.', ['hurt']],
          ['text', 'Fire department staging at the corner now.'],
        ],
      },
    },
  },

  base: {
    key: 'base',
    name: 'Base',
    org: 'Joint Forces Training Base Los Alamitos · Force Protection',
    audience: 'personnel and families',
    reporterNoun: 'service member',
    emergencyNumber: '911',
    center: [33.79, -118.05],
    zoom: 14,
    popDensityPerKm2: 900,
    population: 6_000,
    populationLabel: 'people on base',
    categories: [
      cat('security', 'Perimeter / intruder', 'security', 'security', 'security', K.security),
      cat('drone', 'Drone sighting', 'security', 'security', 'drone', K.drone),
      cat('fire', 'Fire', 'fire', 'fire', 'fire', K.fire),
      cat('smoke', 'Smoke', 'smoke', 'smoke', 'smoke', K.smoke),
      cat('hazmat', 'Fuel / hazmat spill', 'gas', 'gas', 'hazmat', new RegExp(`${K.gas.source}|${K.hazmat.source}`, 'i')),
      cat('medical', 'Medical', 'medical', 'medical', 'medical', K.medical),
      cat('power', 'Power out', 'power', 'power', 'power', K.power),
      cat('road', 'Road blocked', 'road', 'road', 'road', K.road),
      cat('other', 'Other', 'other', 'other', 'other', null),
    ],
    helpFlags: [
      ['trapped', "I'm trapped"],
      ['hurt', 'Someone is hurt'],
      ['silent', "I can't speak safely"],
    ],
    scenario: {
      baseline: [
        {
          category: 'drone', center: [33.7945, -118.0535], spreadM: 300, place: 'Flight line, north apron', title: 'Drone over flight line', confirmed: false,
          summary: '5 personnel report a small drone over the north apron since 18 minutes ago. One photo shows it above parked aircraft. Security forces are responding.',
          reports: [
            [18, 'text', 'drone', 3, 'Small drone hovering over the north apron.'],
            [15, 'photo', 'drone', 3, 'Drone above the parked helicopters.'],
            [12, 'text', 'drone', 3, 'Drone moved toward the fuel pits.'],
            [7, 'voice', 'drone', 3, 'It is still up there, maybe two hundred feet, heading back toward the fence.'],
            [2, 'text', 'drone', 3, 'Lost sight of it over the housing area.'],
          ],
        },
        {
          category: 'security', center: [33.7835, -118.0405], spreadM: 120, place: 'East perimeter, near Gate 3', title: 'Perimeter breach', confirmed: true, reviewedMin: 2,
          summary: '3 reports of a cut in the east perimeter fence near Gate 3 and a person seen walking inside the fence line. Security forces confirmed the cut fence.',
          reports: [
            [26, 'text', 'security', 4, 'Fence is cut near the east perimeter road, about a car length wide.'],
            [23, 'text', 'security', 4, 'Person in dark clothing walking inside the fence toward the motor pool.'],
            [10, 'text', 'security', 3, 'Security forces vehicle at the fence now.'],
          ],
          help: [5, 'SSG Patel', 'Radio ch. 2', ['silent'], 'Unknown person in the motor pool bay. Can see them. Cannot talk.'],
        },
        {
          category: 'hazmat', center: [33.7875, -118.0585], spreadM: 80, place: 'Motor pool, fuel point', title: 'Fuel spill', confirmed: false,
          summary: '4 reports of a diesel spill at the motor pool fuel point spreading toward the storm drain since 14 minutes ago.',
          reports: [
            [14, 'text', 'hazmat', 3, 'Diesel spilling from the fuel point, pump will not shut off.'],
            [11, 'text', 'hazmat', 3, 'Fuel running toward the storm drain.'],
            [8, 'voice', 'hazmat', 3, 'We got the pump off but there is a big puddle heading for the drain.'],
            [3, 'text', 'hazmat', 2, 'Spill kit is down, waiting on more absorbent.'],
          ],
        },
        {
          category: 'fire', center: [33.7985, -118.0375], spreadM: 350, place: 'Training range, east side', title: 'Brush fire', confirmed: false,
          summary: '6 reports of a brush fire on the east side of the training range since 30 minutes ago. Wind is pushing smoke toward family housing.',
          reports: [
            [30, 'text', 'smoke', 2, 'Smoke rising from the east side of the range.'],
            [26, 'text', 'fire', 3, 'Flames in the brush past the berm.'],
            [21, 'voice', 'fire', 3, 'Fire is moving with the wind along the fence line.'],
            [16, 'text', 'smoke', 3, 'Smoke drifting over the housing area.'],
            [9, 'text', 'fire', 3, 'Fire crew on scene, laying hose.'],
            [3, 'text', 'smoke', 2, 'Still smoky near housing.'],
          ],
          help: [4, 'A. Brooks', '(562) 555-0149', ['hurt'], 'My son has asthma and cannot catch his breath from the smoke. We are in housing building 12.'],
        },
        {
          category: 'power', center: [33.7845, -118.0625], spreadM: 200, place: 'Family housing, west side', title: 'Power out', confirmed: false,
          summary: '3 families report no power in west side housing since 40 minutes ago.',
          reports: [
            [40, 'text', 'power', 2, 'Power out in building 4.'],
            [35, 'text', 'power', 2, 'No power on our street in housing.'],
            [12, 'text', 'power', 2, 'Still out, generators have not kicked in.'],
          ],
        },
      ],
      replay: {
        label: 'a suspicious package at the main gate',
        center: [33.7905, -118.0695],
        place: 'Main gate, visitor center',
        helper: ['SPC Lee', 'Radio ch. 1'],
        reports: [
          ['text', 'Unattended backpack by the visitor center bench.'],
          ['photo', 'Backpack left at the main gate.'],
          ['text', 'Nobody has come back for the bag in ten minutes.'],
          ['voice', 'Gate guard is moving people back from the visitor center.'],
          ['text', 'Traffic backing up on the approach road.'],
          ['help', 'A visitor fainted in the heat while we were moving everyone back.', ['hurt']],
          ['text', 'EOD vehicle arriving.'],
        ],
      },
    },
  },
};

export const PROFILE_KEYS = Object.keys(PROFILES);

export function templatesFor(profile, category, where) {
  const c = profile.categories.find((x) => x.key === category);
  const fam = c ? (c.family === 'smoke' ? 'fire' : c.family) : 'other';
  const set = TEMPLATES[fam] || TEMPLATES.default;
  const label = c?.label || 'Incident';
  return set.map(([level, title, msg]) => [level, title.replace('{label}', label), msg.replace('{label}', label).replace('{where}', where)]);
}

// What the browser needs to know about a profile. Regexes stay server-side.
export function publicProfile(p) {
  return {
    key: p.key, name: p.name, org: p.org, audience: p.audience, reporterNoun: p.reporterNoun, emergencyNumber: p.emergencyNumber,
    center: p.center, zoom: p.zoom, popDensityPerKm2: p.popDensityPerKm2, population: p.population, populationLabel: p.populationLabel,
    categories: p.categories.map(({ key, label, family, color, icon }) => ({ key, label, family, color, icon })),
    helpFlags: p.helpFlags,
    replayLabel: p.scenario.replay.label,
  };
}
