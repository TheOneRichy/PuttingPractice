// Persistence in localStorage. Everything lives in one JSON blob so it is easy
// to export / import as a backup.

const KEY = 'putting-practice:v1';

export const DEFAULT_ROUTINES = [
  {
    id: 'c1-ladder',
    name: 'Circle 1 Ladder',
    kind: 'stations',
    unit: 'ft',
    count: 'sets',
    stations: [10, 15, 20, 25, 30].map((d) => ({ distance: d, sets: 2 })),
  },
  {
    id: 'c1x-grind',
    name: 'C1X Grind',
    kind: 'stations',
    unit: 'ft',
    count: 'sets',
    stations: [20, 25, 30, 33].map((d) => ({ distance: d, sets: 2 })),
  },
  {
    id: 'c2-reps',
    name: 'Circle 2 Reps',
    kind: 'stations',
    unit: 'ft',
    count: 'sets',
    stations: [40, 50, 66].map((d) => ({ distance: d, sets: 2 })),
  },
  { id: 'jyly', name: 'JYLY (20 rounds)', kind: 'jyly', unit: 'm', stations: [] },
];

export const DEFAULT_SETTINGS = { unit: 'ft', zoneFt: 18, zoneTarget: 85, zoneSets: 8, putters: 6 };

// Default routines added after launch, so existing users get them once too.
// (Listed ids are only ever added once; deleting one keeps it deleted.)
const LATER_DEFAULTS = [];

const fresh = () => ({
  settings: { ...DEFAULT_SETTINGS, seenDefaults: [...LATER_DEFAULTS] },
  routines: structuredClone(DEFAULT_ROUTINES),
  sessions: [],
  active: null,
});

export function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return fresh();
    return upgrade({ ...fresh(), ...JSON.parse(raw) });
  } catch {
    return fresh();
  }
}

// Earlier versions of default routines, keyed by id (see upgrade()).
// Each entry lists old shapes; an untouched copy is replaced by the current
// default, or removed when there is no current default (18 ft Zone Reps moved
// to the Zone practice card on the Practice screen).
const putts10 = (ds) => ds.map((d) => ({ distance: d, putts: 10 }));
const RETIRED_DEFAULTS = {
  'zone-18': [
    { name: '18 ft Zone Reps', unit: 'ft', stations: putts10([18, 18, 18, 18, 18]) },
    { name: '18 ft Zone Reps', unit: 'ft', count: 'sets', stations: [{ distance: 18, sets: 8 }] },
  ],
  'c1-ladder': [{ name: 'Circle 1 Ladder', unit: 'ft', stations: putts10([10, 15, 20, 25, 30]) }],
  'c1x-grind': [{ name: 'C1X Grind', unit: 'ft', stations: putts10([25, 28, 30, 33]) }],
  'c2-reps': [{ name: 'Circle 2 Reps', unit: 'ft', stations: putts10([40, 50, 60]) }],
};

function upgrade(state) {
  state.settings = { ...DEFAULT_SETTINGS, ...state.settings };
  const seen = new Set(state.settings.seenDefaults || []);
  for (const id of LATER_DEFAULTS) {
    if (seen.has(id)) continue;
    if (!state.routines.some((r) => r.id === id)) {
      state.routines.unshift(structuredClone(DEFAULT_ROUTINES.find((r) => r.id === id)));
    }
    seen.add(id);
  }
  state.settings.seenDefaults = [...seen];
  // Default routines that moved from putts to sets of putters: swap in the new
  // version, but only where the saved copy is still the untouched old default.
  const shape = (r) => JSON.stringify([r.name, r.unit, r.count || 'putts', r.stations]);
  state.routines = state.routines.flatMap((r) => {
    if (!(RETIRED_DEFAULTS[r.id] || []).some((old) => shape(old) === shape(r))) return [r];
    const current = DEFAULT_ROUTINES.find((d) => d.id === r.id);
    return current ? [structuredClone(current)] : [];
  });
  return state;
}

export function save(state) {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch (e) {
    console.error('Could not save', e);
  }
}

export function validateImport(data) {
  if (!data || !Array.isArray(data.sessions) || !Array.isArray(data.routines)) {
    throw new Error('That file does not look like a putting practice backup.');
  }
  return upgrade({ ...fresh(), ...data, active: null });
}

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
