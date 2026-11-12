// A bot with a plan for one job: taking a hill in the balanced setup of scenario 11 (docs/02 §5.5), which the planner
// never does (it shoots from below and does not scout). Scouts first, onto the hill and the tile next to it, then the
// squads walk up to that tile and fire at the hill; a Rifleman steps onto any objective left empty and Controls it. Each
// game goes for one hill, 2A three times out of four, so that it cannot be read in advance. What the plan does not
// decide goes to the heuristic bot. Like the others, it sees only the view.

import { TILES, TYPES } from '../engine/data.js';
import { seedFrom } from '../engine/rng.js';
import { context, heuristicBot, kindOf } from './heuristicBot.js';

/** What to Bolster first, per hill: its squad, the Mortar, then the centre. */
const THEN = ['MO', 'SB', 'RB', 'MB', 'R', 'M', 'S'];
const ASSAULTS = { '2A': ['SA', 'RA', 'MA', ...THEN], '16A': ['SC', 'RC', 'MC', ...THEN] };

export const assaultTarget = (seed) => (seedFrom(seed) % 4 ? '2A' : '16A');

const coverValue = (tile) => (TILES[tile].cover === 'hill' ? 3 : TILES[tile].cover);

export function assaultBot(seed, target = assaultTarget(seed)) {
    const base = heuristicBot(seed);
    const bolsterOrder = ASSAULTS[target];
    let goal = null; // where the unit being moved is going

    function chooseCard(req, view) {
        const seat = view.seat;
        const cx = context(view, seat);
        const { marked } = cx;
        const unitOf = (card) => `${cx.me}:${card}`;
        const tileOf = (x) => view.units[unitOf(x.card)]?.tile;
        const enemiesOn = (tile) => Object.values(view.units).some((u) => u.tile === tile && u.seat !== seat);
        const empty = Object.keys(view.objectives).filter((t) => !enemiesOn(t));
        const rifles = Object.values(view.units).filter((u) => u.seat === seat && u.tile && kindOf(u.id) === 'R' && !u.suppressed);
        const o = req.options;

        // an objective with no enemies: Control it, step onto it, or scout it
        for (const hill of empty) {
            const on = rifles.find((u) => u.tile === hill);
            const control = on && o.find((x) => x.action === 'control' && unitOf(x.card) === on.id);
            if (control) return control.id;
        }
        for (const hill of empty.filter(marked)) {
            const walkers = o.filter((x) => x.action === 'move' && TYPES[x.card].kind === 'R' && tileOf(x)).sort((a, b) => cx.d(tileOf(a), hill) - cx.d(tileOf(b), hill));
            if (walkers[0] && rifles.some((u) => u.id === unitOf(walkers[0].card))) {
                goal = hill;
                return walkers[0].id;
            }
        }
        for (const hill of empty.filter((t) => !marked(t))) {
            const scout = o.find((x) => x.action === 'scout' && tileOf(x) && cx.d(tileOf(x), hill) <= x.value);
            if (scout) {
                goal = hill;
                return scout.id;
            }
        }

        // the hill of this game: markers on it and next to it, fire at it, walk up
        const staging = Object.keys(view.control).filter((t) => cx.d(t, target) === 1).sort((a, b) => coverValue(b) - coverValue(a))[0];
        for (const tile of [target, staging]) {
            const scout = !marked(tile) && o.find((x) => x.action === 'scout');
            if (scout) {
                goal = tile;
                return scout.id;
            }
        }
        const fire = o.filter((x) => (x.action === 'attack' || x.action === 'blast') && tileOf(x) && TYPES[x.card].kind !== 'R' && cx.d(tileOf(x), target) <= 3 && enemiesOn(target));
        if (fire[0]) return fire[0].id;
        const walk = o.filter((x) => x.action === 'move' && tileOf(x) && TYPES[x.card].kind !== 'MO' && marked(staging) && cx.d(tileOf(x), target) > 1 && !view.units[unitOf(x.card)].suppressed).sort((a, b) => cx.d(tileOf(a), target) - cx.d(tileOf(b), target));
        if (walk[0]) {
            goal = staging;
            return walk[0].id;
        }
        const aim = o.find((x) => x.action === 'target' && !view.targets[seat]);
        if (aim) return aim.id;

        // the rest as usual, but it attacks rather than suppresses, always Commands, and does not hand out Fog
        const left = o.filter((x) => !(x.action === 'suppress' && o.some((y) => y.card === x.card && y.action === 'attack'))
            && !(x.card === 'PS' && x.action === 'bolster')
            && x.action !== 'conceal');
        return base({ ...req, options: left.length ? left : o }, view);
    }

    return (req, view) => {
        if (req.kind === 'play') return chooseCard(req, view);
        if (req.kind === 'move' && goal) {
            const cx = context(view, view.seat);
            const steps = req.options.filter((x) => x.tile).sort((a, b) => cx.d(a.tile, goal) - cx.d(b.tile, goal));
            const here = view.units[req.unit]?.tile;
            const canStop = req.options.some((x) => x.id === 'stop');
            if (here === goal && canStop) return 'stop';
            if (steps[0] && (here == null || cx.d(steps[0].tile, goal) < cx.d(here, goal) || !canStop)) return steps[0].id;
            if (canStop) return 'stop';
        }
        if (req.kind === 'attack' || req.kind === 'suppress') {
            const shots = req.options.filter((x) => x.tile === target).sort((a, b) => (kindOf(a.unit) === 'R' ? -1 : 0) - (kindOf(b.unit) === 'R' ? -1 : 0));
            if (shots[0]) return shots[0].id;
        }
        if (req.kind === 'target') {
            const here = req.options.find((x) => x.tile === target);
            if (here) return here.id;
        }
        if (req.kind === 'bolster') {
            for (const k of bolsterOrder) {
                const c = req.options.find((x) => x.card && (x.card === k || TYPES[x.card].kind === k));
                if (c) return c.id;
            }
        }
        return base(req, view);
    };
}
