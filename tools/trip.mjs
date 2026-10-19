// The trip, in one place: every tool that needs the dates imports them from here.
// User, 16 Oct 2026: a big group 8-18 Jan, two people until 23 Jan, then the traveler alone; flight home 26 Jan, 18:20.
// If the dates change: edit ALL of TRIP (start, end, lastNight = the night before the flight, flight.day and time, and the
// from/to of every phase: the phases must cover every day), PLAN_PHANGAN in build.mjs if the Koh Phangan nights move,
// then the date texts (grep -n "Jan" data/extra.json tools/curate.mjs tools/merge-late-jan.mjs), then `npm run all`.
export const TRIP = {
  start: '2027-01-08', end: '2027-01-26', lastNight: '2027-01-25', flight: { day: '2027-01-26', time: '18:20' },
  // the villas the group booked (ids in data/stays.json), 19 Oct 2026: a night belongs to the villa whose stay covers it
  // (from = check-in day, to = check-out day). The two villas' pins are Airbnb's approximate ones until the hosts send
  // the address.
  bases: [
    { id: '136-pool-villa-patong-5br', key: 'patong', short: 'Patong villa', from: '2027-01-08', to: '2027-01-14', checkIn: '15:00', checkOut: '11:00' },
    { id: 'luxurious-seaview-villa-rawai', key: 'rawai', short: 'Rawai villa', from: '2027-01-14', to: '2027-01-18', checkIn: '16:00', checkOut: '12:00' },
  ],
  phases: [
    { id: 'group', label: 'Group', from: '2027-01-08', to: '2027-01-18' },
    { id: 'duo', label: 'Two of you', from: '2027-01-19', to: '2027-01-23' },
    { id: 'solo', label: 'Solo', from: '2027-01-24', to: '2027-01-26' },
  ],
}

const DAY = 86400000
const utc = (iso) => Date.parse(iso + 'T00:00:00Z')
export const TRIP_DAYS = Array.from({ length: Math.round((utc(TRIP.end) - utc(TRIP.start)) / DAY) + 1 }, (_, i) => new Date(utc(TRIP.start) + i * DAY).toISOString().slice(0, 10))
TRIP.days = TRIP_DAYS.length

// the booked villa for the night of iso (null when the group is not in one), and the villa you leave that day
export const baseOf = (iso) => TRIP.bases.find((b) => iso >= b.from && iso < b.to) || null
export const leavingOn = (iso) => TRIP.bases.find((b) => b.to === iso) || null

// a night out counts if it starts on or before the last night (the flight leaves on the last day)
export const inTrip = (iso) => iso >= TRIP.start && iso <= TRIP.lastNight
export const windowOf = (dates) => (dates.some(inTrip) ? 'in' : dates.every((x) => x < TRIP.start) ? 'before' : 'after')
export const phaseOf = (iso) => (TRIP.phases.find((p) => iso >= p.from && iso <= p.to) || {}).id
// a day in no phase would get no button in the pass, and the flight must be the last day
{
  const gap = TRIP_DAYS.filter((d) => !phaseOf(d))
  if (gap.length) throw new Error('tools/trip.mjs: TRIP.phases do not cover ' + gap.join(', '))
  if (TRIP.flight.day !== TRIP.end) throw new Error('tools/trip.mjs: TRIP.flight.day should be TRIP.end')
}

// date words for the page copy
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const MONTH = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const day = (iso) => Number(iso.slice(8, 10)), mon = (iso) => Number(iso.slice(5, 7)) - 1, year = (iso) => iso.slice(0, 4)
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
// 'Tue 26 Jan'
export const dayLabel = (iso) => `${DOW[new Date(iso + 'T12:00:00Z').getUTCDay()]} ${day(iso)} ${MON[mon(iso)]}`
const range = (a, b, names, join) => (mon(a) === mon(b) ? `${day(a)}${join}${day(b)} ${names[mon(b)]}` : `${day(a)} ${names[mon(a)]}${join}${day(b)} ${names[mon(b)]}`)
export const TRIP_LABEL = {
  short: range(TRIP.start, TRIP.end, MON, '–'), // 8–26 Jan
  long: `${range(TRIP.start, TRIP.end, MON, '–')} ${year(TRIP.end)}`, // 8–26 Jan 2027
  full: `${range(TRIP.start, TRIP.end, MONTH, '–')} ${year(TRIP.end)}`, // 8–26 January 2027
  words: `${range(TRIP.start, TRIP.end, MONTH, ' to ')} ${year(TRIP.end)}`, // 8 to 26 January 2027
  days: `${TRIP_DAYS.length} days`,
}
// '8–18' for a phase chip, '8–18 Jan' for a phase row
export const phaseRange = (p) => (mon(p.from) === mon(p.to) ? `${day(p.from)}–${day(p.to)}` : `${day(p.from)} ${MON[mon(p.from)]}–${day(p.to)} ${MON[mon(p.to)]}`)
export const phaseLabel = (p) => range(p.from, p.to, MON, '–')
