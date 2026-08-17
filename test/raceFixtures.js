'use strict';
/* RACE PROVIDER FIXTURES — SYNTHETIC, AND SAYING SO.
 *
 * There is no live provider. Section 27 of the brief is explicit that a race
 * catalogue must not be fabricated, so nothing here pretends to be real
 * inventory: the events are recognisable UK place names with invented dates,
 * ids and coordinates, and they exist to exercise the normaliser, the deduper
 * and the filters rather than to be searched.
 *
 * TWO PROVIDERS ON PURPOSE, with deliberately different vocabularies — one
 * snake_case with metres and an ISO datetime, one camelCase with miles and a
 * nested venue. That is the whole point of the abstraction: if a test can only
 * be written against one shape, the shape has leaked.
 */

/* Provider A: snake_case, distance in metres, status words of its own. */
const PROVIDER_A = {
  provider: 'fixture-a',
  map: {
    providerId: 'event_id', name: 'event_name', date: 'event_date',
    km: 'distance_km', location: 'town', country: 'country_code',
    lat: 'latitude', lon: 'longitude', terrain: 'surface',
    elevationM: 'ascent_m', organiser: 'organiser_name',
    officialUrl: 'website', status: 'event_status', sourceUpdatedAt: 'updated'
  }
};

/* Provider B: camelCase, a different id space, no elevation at all. */
const PROVIDER_B = {
  provider: 'fixture-b',
  map: {
    providerId: 'id', name: 'title', date: 'startDate',
    km: 'distanceKm', location: 'city', country: 'iso2',
    lat: 'lat', lon: 'lng', terrain: 'courseType',
    organiser: 'promoter', officialUrl: 'url', status: 'state',
    sourceUpdatedAt: 'lastSeen'
  }
};

const RAW_A = [
  { event_id: 'A-1001', event_name: 'Cambridge Half Marathon', event_date: '2026-11-08',
    distance_km: 21.1, town: 'Cambridge', country_code: 'gb', latitude: 52.2053, longitude: 0.1218,
    surface: 'road', ascent_m: 45, organiser_name: 'Cambridge Events',
    website: 'https://example-cambridgehalf.test/', event_status: 'scheduled', updated: '2026-08-10' },

  { event_id: 'A-1002', event_name: 'Peak District Trail Marathon', event_date: '2026-10-17',
    distance_km: 42.2, town: 'Bakewell', country_code: 'gb', latitude: 53.2129, longitude: -1.6754,
    surface: 'trail', ascent_m: 1180, organiser_name: 'Peak Trails',
    website: 'https://example-peaktrail.test/marathon', event_status: 'scheduled', updated: '2026-08-01' },

  // no coordinates and no elevation: must stay searchable, must say so
  { event_id: 'A-1003', event_name: 'Riverside 10K', event_date: '2026-09-27',
    distance_km: 10, town: 'Chester', country_code: 'gb',
    surface: null, organiser_name: null, website: null, event_status: null, updated: '2026-07-30' },

  // cancelled: must never be offered
  { event_id: 'A-1004', event_name: 'Coastal Half', event_date: '2026-10-04',
    distance_km: 21.1, town: 'Whitby', country_code: 'gb', latitude: 54.4863, longitude: -0.6133,
    surface: 'road', event_status: 'cancelled', updated: '2026-08-12' },

  // postponed: selectable, but the caveat must be stated
  { event_id: 'A-1005', event_name: 'Fenland Marathon', event_date: '2026-12-06',
    distance_km: 42.2, town: 'Ely', country_code: 'gb', latitude: 52.3990, longitude: 0.2620,
    surface: 'road', ascent_m: 20, event_status: 'postponed', updated: '2026-08-14' },

  // an unmappable distance: real race, searchable, never a goal
  { event_id: 'A-1006', event_name: 'Malvern 15K', event_date: '2026-11-15',
    distance_km: 15, town: 'Malvern', country_code: 'gb', latitude: 52.1109, longitude: -2.3260,
    surface: 'trail', ascent_m: 520, event_status: 'scheduled', updated: '2026-08-05' },

  // too soon to prepare for
  { event_id: 'A-1007', event_name: 'Autumn Marathon', event_date: '2026-09-06',
    distance_km: 42.2, town: 'Nottingham', country_code: 'gb', latitude: 52.9548, longitude: -1.1581,
    surface: 'road', ascent_m: 60, event_status: 'scheduled', updated: '2026-08-11' },

  // stale: nothing has confirmed this in a long time
  { event_id: 'A-1008', event_name: 'Border Ultra', event_date: '2026-11-22',
    distance_km: 50, town: 'Hexham', country_code: 'gb', latitude: 54.9710, longitude: -2.1010,
    surface: 'trail', ascent_m: 1600, event_status: 'scheduled', updated: '2025-02-01' },

  // rubbish that must not become a race
  { event_id: 'A-9001', event_name: '', event_date: '2026-11-01', distance_km: 10 },
  { event_id: 'A-9002', event_name: 'No Date 10K', event_date: 'soon', distance_km: 10 },
  { event_id: 'A-9003', event_name: 'Impossible Date 10K', event_date: '2026-02-31', distance_km: 10 },
  { event_id: 'A-9004', event_name: 'No Distance Race', event_date: '2026-11-01', distance_km: null },
  { event_id: null,     event_name: 'No Id Race',      event_date: '2026-11-01', distance_km: 10 },
  { event_id: 'A-9005', event_name: 'Absurd Distance', event_date: '2026-11-01', distance_km: 99999 }
];

const RAW_B = [
  /* THE DUPLICATE. Same event as A-1001 under a sponsor name, from a different
     feed, with an id from another space and no elevation. Must collapse to one
     row and keep both sources. */
  { id: 'B-77', title: 'Saucony Cambridge Half Marathon 2026', startDate: '2026-11-08T09:00:00Z',
    distanceKm: 21.1, city: 'Cambridge', iso2: 'GB', lat: 52.2050, lng: 0.1220,
    courseType: 'road', promoter: 'Cambridge Events Ltd',
    url: 'https://example-cambridgehalf.test/', state: 'scheduled', lastSeen: '2026-08-15' },

  /* SAME NAME, DIFFERENT RACE. A second "Riverside 10K" on another day in
     another town. Must never merge with A-1003. */
  { id: 'B-78', title: 'Riverside 10K', startDate: '2026-10-11',
    distanceKm: 10, city: 'Durham', iso2: 'GB', lat: 54.7761, lng: -1.5733,
    courseType: 'road', state: 'scheduled', lastSeen: '2026-08-13' },

  /* SAME DAY, SAME DISTANCE, SAME TOWN, GENUINELY DIFFERENT EVENT. The hardest
     dedupe case, and the one where merging would be wrong. */
  { id: 'B-79', title: 'Cambridge Chariots Charity Half', startDate: '2026-11-08',
    distanceKm: 21.1, city: 'Cambridge', iso2: 'GB', lat: 52.2100, lng: 0.1150,
    courseType: 'road', state: 'scheduled', lastSeen: '2026-08-15' },

  // sold out
  { id: 'B-80', title: 'Thames Path Half', startDate: '2026-11-29',
    distanceKm: 21.1, city: 'Henley', iso2: 'GB', lat: 51.5390, lng: -0.9040,
    courseType: 'road', state: 'sold out', lastSeen: '2026-08-16' },

  // hostile payload: script in the name, javascript: URL, terrain it invented
  { id: 'B-666', title: '<img src=x onerror=alert(1)>Evil 10K', startDate: '2026-11-01',
    distanceKm: 10, city: '"><script>alert(1)</script>', iso2: 'GB', lat: 51.5, lng: -0.1,
    courseType: 'lava', promoter: 'javascript:alert(1)',
    url: 'javascript:alert(document.cookie)', state: 'definitely_on', lastSeen: '2026-08-16' },

  // hostile payload: protocol-relative URL and a data: URL
  { id: 'B-667', title: 'Redirect 10K', startDate: '2026-11-02',
    distanceKm: 10, city: 'London', iso2: 'GB', lat: 51.5, lng: -0.12,
    courseType: 'road', url: '//evil.example/steal', state: 'scheduled', lastSeen: '2026-08-16' }
];

module.exports = { PROVIDER_A, PROVIDER_B, RAW_A, RAW_B };
