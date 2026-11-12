// The companion's own map (docs/02 §7.1): no photographed tiles, only a diagram drawn from the scenario data. Each
// tile is a square at its place on the half-tile grid with its identifier (the number and letter printed on the
// physical tile), its cover as a colour and a number, the objective value, the control markers of both sides, the
// spawn markers, the radio and the mortar targets. Counters are circles with the unit's short name and defence.
// What answers the pending decision is highlighted and clickable (`data-pick`); `focus` marks the counter or tile an
// instruction is about, and `arrow` draws a move or an attack.

import { s } from '../src/ui/dom.js';
import { t } from '../src/i18n/index.js';
import { TILES, defenceOf, scenarioById, unitKind, unitType } from '../src/engine/data.js';
import { unitName } from '../src/ui/text.js';

const T = 120; // tile side in SVG units
const SIDES = ['us', 'de'];

/** Board size in SVG units and the top-left corner of each tile. */
export function layout(sc) {
    const xs = sc.tiles.map((x) => x.x);
    const ys = sc.tiles.map((x) => x.y);
    const minX = Math.min(...xs), minY = Math.min(...ys);
    const W = ((Math.max(...xs) - minX) / 2 + 1) * T, H = ((Math.max(...ys) - minY) / 2 + 1) * T;
    const at = Object.fromEntries(sc.tiles.map((x) => [x.id, [((x.x - minX) * T) / 2, ((x.y - minY) * T) / 2]]));
    return { W, H, pos: (tile) => at[tile] };
}

/** The tile under a point of the map, if any. */
export function tileAtPoint(sc, x, y) {
    const { pos } = layout(sc);
    return sc.tiles.find((tile) => {
        const [tx, ty] = pos(tile.id);
        return x >= tx && x < tx + T && y >= ty && y < ty + T;
    })?.id ?? null;
}

/** Cover as the class of a tile's colour: open ground to heavy cover, and hills. */
const coverClass = (c) => (c === 'hill' ? 'hill' : `c${c}`);

/** Pixel-art squares per cover (assets/terrain, our own); a tile always gets the same one. */
const TERRAIN = { c0: 4, c1: 3, c2: 3, c3: 4, hill: 2 };
function terrainOf(tileId, cover) {
    const cls = coverClass(cover);
    let h = 0;
    for (const ch of tileId) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    return `assets/terrain/${cls}-${(h % TERRAIN[cls]) + 1}.png`;
}
let clipIds = 0;
// loaded once at the start, so the first map does not show up empty
if (typeof Image !== 'undefined') for (const [cls, n] of Object.entries(TERRAIN)) for (let i = 1; i <= n; i++) new Image().src = `assets/terrain/${cls}-${i}.png`;
export const coverText = (c) => (c === 'hill' ? '3/1' : String(c));

/** Short label of a counter: "FUS A", "MORT". */
export function shortName(uid) {
    const type = unitType(uid);
    const kind = unitKind(type);
    return `${t(`unit.short.${kind}`)}${type.length === 2 && kind !== 'MO' && kind !== 'SN' ? ` ${type[1]}` : ''}`;
}

/**
 * @param {any} view
 * @param {{ picks?: Map<string, string>, onPick?: (id: string) => void, viewer: number,
 *   focus?: { unit?: string, tile?: string, tiles?: string[] }, arrow?: { from: string, to: string, kind: 'move' | 'attack', side: string } }} o
 *   picks: `tile:12B` / `unit:de:RA` -> the option id they answer; terrain: pixel art on the tiles (else colours only)
 */
export function drawMap(view, { picks = new Map(), onPick = () => {}, viewer, focus = {}, arrow = null, terrain = true }) {
    const sc = scenarioById(view.scenario);
    const { W, H, pos } = layout(sc);
    const svg = s('svg', { viewBox: `-4 -4 ${W + 8} ${H + 8}`, class: `cmap${terrain ? ' terrain' : ''}`, role: 'img' });
    const clip = `ctclip${++clipIds}`;
    if (terrain) svg.append(s('defs', {}, s('clipPath', { id: clip }, s('rect', { x: 1.5, y: 1.5, width: T - 3, height: T - 3, rx: 6 }))));
    const spawnsAt = {};
    for (const side of SIDES) for (const sp of sc.spawns[side]) (spawnsAt[sp.tile] ??= []).push({ side, who: sp.who });
    const focusTiles = new Set([focus.tile, ...(focus.tiles ?? [])].filter(Boolean));

    for (const tile of sc.tiles) {
        const [x, y] = pos(tile.id);
        const cover = TILES[tile.id].cover;
        const pick = picks.get(`tile:${tile.id}`);
        const g = s('g', { transform: `translate(${x} ${y})`, class: `ctile ${coverClass(cover)}${pick ? ' pickable' : ''}${focusTiles.has(tile.id) ? ' focus' : ''}`,
            'data-pick': pick, onclick: pick ? () => onPick(pick) : null });
        if (terrain) g.append(s('image', { href: terrainOf(tile.id, cover), x: 1.5, y: 1.5, width: T - 3, height: T - 3, preserveAspectRatio: 'none', 'clip-path': `url(#${clip})`, class: 'tart' }));
        g.append(s('rect', { x: 1.5, y: 1.5, width: T - 3, height: T - 3, rx: 6, class: 'ground' }));
        if (cover === 'hill' && !terrain) g.append(s('path', { d: `M14 ${T - 30} Q${T / 2} ${T - 70} ${T - 14} ${T - 30} M28 ${T - 30} Q${T / 2} ${T - 56} ${T - 28} ${T - 30}`, class: 'contour' }));
        g.append(s('text', { x: 8, y: T - 9, class: 'tid' }, tile.id));
        // the cover in a small shield
        g.append(s('path', { d: `M${T - 31} ${T - 25} h20 v8 q0 9 -10 13 q-10 -4 -10 -13 z`, class: 'tshield' }));
        g.append(s('text', { x: T - 21, y: T - 11.5, class: 'tcover' }, coverText(cover)));
        const val = view.objectives[tile.id];
        if (val) {
            g.append(s('path', { d: `M${T - 30} 6 h24 l-6 8.5 l6 8.5 h-24 z`, class: 'flag' }));
            g.append(s('text', { x: T - 20, y: 19.5, class: 'flag-t' }, val));
        }
        let mx = 12;
        for (const side of SIDES) {
            const c = view.control[tile.id][side];
            if (!c) continue;
            g.append(s('g', { class: `cmark ${side} ${c}` },
                s('circle', { cx: mx, cy: 13, r: 9.5 }),
                s('text', { x: mx, y: 17 }, c === 'controlled' ? '★' : '◉')));
            mx += 22;
        }
        for (const sp of spawnsAt[tile.id] ?? []) {
            const label = sp.who.map((w) => (w.length === 1 ? w : t(`spawn.${w}`))).join(' ');
            const w = 8 + label.length * 5.6;
            g.append(s('rect', { x: mx - 4, y: 4, width: w, height: 15, rx: 3, class: `cspawn ${sp.side}` }));
            g.append(s('text', { x: mx - 4 + w / 2, y: 15, class: 'cspawn-t' }, label));
            mx += w + 2;
        }
        if (sc.radio === tile.id) g.append(s('text', { x: T - 44, y: 19, class: 'radio' }, '📡'));
        view.targets.forEach((tt, seat) => {
            if (tt !== tile.id) return;
            g.append(s('g', { class: `ctarget ${SIDES[seat]}` },
                s('circle', { cx: T / 2, cy: T / 2 + 4, r: T * 0.34 }),
                s('path', { d: `M${T / 2} ${T * 0.14} V${T * 0.9} M${T * 0.14} ${T / 2 + 4} H${T * 0.86}` })));
        });
        g.append(s('title', {}, `${tile.id} · ${t('cmp.map.cover')} ${coverText(cover)}`));
        svg.append(g);
    }

    // counters, grouped per tile
    const at = {};
    const byTile = {};
    for (const u of Object.values(view.units)) if (u.tile) (byTile[u.tile] ??= []).push(u);
    for (const [tile, units] of Object.entries(byTile)) {
        const [x, y] = pos(tile);
        const n = units.length;
        // between the markers at the top and the identifier at the bottom
        const cols = n > 6 ? 4 : n > 4 ? 3 : 2;
        const r = n > 6 ? T * 0.105 : n > 4 ? T * 0.12 : n > 2 ? T * 0.135 : T * 0.17;
        units.sort((a, b) => a.seat - b.seat || a.id.localeCompare(b.id));
        const rows = Math.ceil(n / cols);
        units.forEach((u, i) => {
            const row = Math.floor(i / cols);
            const inRow = Math.min(cols, n - row * cols);
            const cx = x + T / 2 + ((i % cols) - (inRow - 1) / 2) * r * 2.25;
            const cy = y + T * 0.47 + (row - (rows - 1) / 2) * r * 2.2;
            at[u.id] = [cx, cy, r];
            const pick = picks.get(`unit:${u.id}`);
            const side = SIDES[u.seat];
            const el = s('g', { class: `ccounter ${side}${u.suppressed ? ' suppressed' : ''}${pick ? ' pickable' : ''}${focus.unit === u.id ? ' focus' : ''}`,
                'data-pick': pick, 'data-now': pick?.startsWith('sel:') ? 'true' : undefined, 'data-unit': u.id, onclick: pick ? (ev) => { ev.stopPropagation(); onPick(pick); } : null });
            el.append(s('circle', { cx, cy, r }));
            el.append(s('text', { x: cx, y: cy - r * 0.05, class: 'cn', 'font-size': r * 0.5 }, shortName(u.id)));
            el.append(s('text', { x: cx, y: cy + r * 0.55, class: 'cd', 'font-size': r * 0.42 }, u.suppressed ? `⬇ ${defenceOf(u.id)}` : defenceOf(u.id)));
            el.append(s('title', {}, `${unitName(u.id, viewer)}${u.suppressed ? ` · ${t('cmp.map.suppressed')}` : ''}`));
            svg.append(el);
        });
    }
    if (arrow) drawArrow(svg, arrow, at, pos);
    return svg;
}

function drawArrow(svg, { from, to, kind, side }, at, pos) {
    const centre = (k) => {
        if (at[k]) return at[k];
        const p = pos(k);
        return p ? [p[0] + T / 2, p[1] + T / 2, T * 0.2] : null;
    };
    const a = centre(from), b = centre(to);
    if (!a || !b) return;
    svg.append(s('defs', {}, s('marker', { id: `chead-${side}`, viewBox: '0 0 10 10', refX: 8, refY: 5, markerWidth: 4, markerHeight: 4, orient: 'auto-start-reverse' },
        s('path', { d: 'M0 0 L10 5 L0 10 z', class: `chead ${side}` }))));
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    const k0 = a[2] / len, k1 = (len - b[2] - 3) / len;
    svg.append(s('line', { x1: a[0] + (b[0] - a[0]) * k0, y1: a[1] + (b[1] - a[1]) * k0, x2: a[0] + (b[0] - a[0]) * k1, y2: a[1] + (b[1] - a[1]) * k1,
        class: `carrow ${kind} ${side}`, 'marker-end': `url(#chead-${side})` }));
}
