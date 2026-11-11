// Persistence in localStorage. Everything lives in one JSON blob so it is easy
// to export / import as a backup.

const KEY = 'putting-practice:v1';

export const DEFAULT_ROUTINES = [
  {
    id: 'zone-18',
    name: '18 ft Zone Reps',
    kind: 'stations',
    unit: 'ft',
    stations: Array.from({ length: 5 }, () => ({ distance: 18, putts: 10 })),
  },
  {
    id: 'c1-ladder',
    name: 'Circle 1 Ladder',
    kind: 'stations',
    unit: 'ft',
    stations: [10, 15, 20, 25, 30].map((d) => ({ distance: d, putts: 10 })),
  },
  {
    id: 'c1x-grind',
    name: 'C1X Grind',
    kind: 'stations',
    unit: 'ft',
    stations: [25, 28, 30, 33].map((d) => ({ distance: d, putts: 10 })),
  },
  {
    id: 'c2-reps',
    name: 'Circle 2 Reps',
    kind: 'stations',
    unit: 'ft',
    stations: [40, 50, 60].map((d) => ({ distance: d, putts: 10 })),
  },
  { id: 'jyly', name: 'JYLY (20 rounds)', kind: 'jyly', unit: 'm', stations: [] },
];

export const DEFAULT_SETTINGS = { unit: 'ft', zoneFt: 18, zoneTarget: 85 };

// Default routines added after launch, so existing users get them once too.
// (Listed ids are only ever added once; deleting one keeps it deleted.)
const LATER_DEFAULTS = ['zone-18'];

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
