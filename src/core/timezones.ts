// In-game clock support. CSP reports the sim clock as a UTC epoch ("UTC Time" channel), already
// adjusted for the track's time zone. To show the time-of-day a driver would see in game we
// convert it back to the track's local zone. Known circuits are matched by keyword; anything else
// falls back to UTC and can be overridden per track in the session browser.

const TRACK_ZONES: [RegExp, string][] = [
  [/singapore|marina/i, 'Asia/Singapore'],
  [/suzuka|fuji|motegi|okayama|tsukuba/i, 'Asia/Tokyo'],
  [/sepang|malaysia/i, 'Asia/Kuala_Lumpur'],
  [/baku/i, 'Asia/Baku'],
  [/cota|austin|americas|road_america|elkhart/i, 'America/Chicago'],
  [/bahrain|sakhir/i, 'Asia/Bahrain'],
  [/hungaroring|hungary/i, 'Europe/Budapest'],
  [/imola|mugello|monza|vallelunga|misano/i, 'Europe/Rome'],
  [/istanbul/i, 'Europe/Istanbul'],
  [/spa|zolder/i, 'Europe/Brussels'],
  [/silverstone|brands|donington|snetterton|oulton|thruxton|knockhill|goodwood/i, 'Europe/London'],
  [/monaco/i, 'Europe/Monaco'],
  [/barcelona|catalunya|montmelo|jerez|valencia|aragon|navarra|madrid|madring/i, 'Europe/Madrid'],
  [/red_bull_ring|redbullring|spielberg|austria|salzburgring/i, 'Europe/Vienna'],
  [/zandvoort|assen/i, 'Europe/Amsterdam'],
  [/nurburgring|nordschleife|hockenheim|sachsenring|lausitz|oschersleben/i, 'Europe/Berlin'],
  [/paul_ricard|ricard|magny|lemans|le_mans|sarthe|dijon/i, 'Europe/Paris'],
  [/portimao|algarve|estoril/i, 'Europe/Lisbon'],
  [/interlagos|brazil/i, 'America/Sao_Paulo'],
  [/mexico|hermanos/i, 'America/Mexico_City'],
  [/montreal|villeneuve|mosport|canadian_tire/i, 'America/Toronto'],
  [/vegas|laguna|sonoma|willow|thunderhill/i, 'America/Los_Angeles'],
  [/miami|daytona|sebring|homestead/i, 'America/New_York'],
  [/watkins|glen|lime_rock|vir|virginia|mid_ohio|pocono/i, 'America/New_York'],
  [/indianapolis|indy/i, 'America/Indiana/Indianapolis'],
  [/jeddah|saudi/i, 'Asia/Riyadh'],
  [/yas|abu_?dhabi/i, 'Asia/Dubai'],
  [/losail|lusail|qatar/i, 'Asia/Qatar'],
  [/shanghai|zhuhai/i, 'Asia/Shanghai'],
  [/melbourne|albert_park|phillip/i, 'Australia/Melbourne'],
  [/bathurst|panorama|sydney/i, 'Australia/Sydney'],
  [/kyalami/i, 'Africa/Johannesburg'],
  [/sochi/i, 'Europe/Moscow'],
  [/kuwait/i, 'Asia/Kuwait'],
  [/buddh|india/i, 'Asia/Kolkata'],
  [/korea|yeongam/i, 'Asia/Seoul'],
];

export function guessTrackZone(venue: string): string | null {
  for (const [re, tz] of TRACK_ZONES) if (re.test(venue)) return tz;
  return null;
}

export const COMMON_ZONES = [
  'UTC',
  'Europe/London',
  'Europe/Paris',
  'Europe/Berlin',
  'Europe/Rome',
  'Europe/Madrid',
  'Europe/Brussels',
  'Europe/Amsterdam',
  'Europe/Vienna',
  'Europe/Budapest',
  'Europe/Istanbul',
  'Europe/Lisbon',
  'Europe/Monaco',
  'Asia/Baku',
  'Asia/Bahrain',
  'Asia/Qatar',
  'Asia/Riyadh',
  'Asia/Dubai',
  'Asia/Singapore',
  'Asia/Kuala_Lumpur',
  'Asia/Shanghai',
  'Asia/Tokyo',
  'Australia/Melbourne',
  'Australia/Sydney',
  'America/New_York',
  'America/Chicago',
  'America/Los_Angeles',
  'America/Toronto',
  'America/Mexico_City',
  'America/Sao_Paulo',
  'Africa/Johannesburg',
];

/** Resolve the zone used to display the in-game clock for a venue. */
export function zoneForVenue(venue: string, overrides: Record<string, string>, mode: 'track' | 'utc'): string {
  if (mode === 'utc') return 'UTC';
  return overrides[venue] || guessTrackZone(venue) || 'UTC';
}
