// Static data: card types, unit defence, tile cover and the scenarios (docs/02 §2.3).

import cards from '../data/cards.json' with { type: 'json' };
import tiles from '../data/tiles.json' with { type: 'json' };
import { SCENARIOS } from '../data/scenarios/index.js';

export { SCENARIOS };
export const TYPES = cards.types;
export const UNITS = cards.units;
export const TILES = tiles;
export const SIDES = ['us', 'de'];

/** @param {number} id */
export function scenarioById(id) {
    const sc = SCENARIOS.find((s) => s.id === Number(id));
    if (!sc) throw new Error(`unknown scenario ${id}`);
    return sc;
}

/** Card id `us:RA:3` → its type (`RA`). */
export const typeId = (cid) => cid.split(':')[1];
export const typeOf = (cid) => TYPES[typeId(cid)];

/** Unit id `us:RA` → its side, type and defence. */
export const unitSide = (uid) => uid.slice(0, 2);
export const unitType = (uid) => uid.slice(3);
export const unitKind = (type) => (type === 'MO' || type === 'SN' ? type : type[0]);
export const defenceOf = (uid) => UNITS[unitKind(unitType(uid))].defence;

/** The unit a card belongs to (`us:RA:3` → `us:RA`), or null for command and Fog of War cards. */
export function unitOfCard(cid) {
    const t = typeOf(cid);
    return t.unit ? `${cid.slice(0, 2)}:${t.unit}` : null;
}

/**
 * A tile's cover as printed (a number or 'hill'), or 'hill' for a tile the scenario makes one (`hills` in its JSON:
 * Castle Itter, 1B of scenario 13).
 */
export const tileCover = (tile, hills = []) => (hills.includes(tile) ? 'hill' : TILES[tile].cover);

/** Cover bonus of a tile against an attack: hills give 3, or 1 against a Blast or an attacker on a hill. */
export function coverOf(tile, { blast = false, fromTile = null, hills = [] } = {}) {
    const c = tileCover(tile, hills);
    if (c !== 'hill') return c;
    return blast || (fromTile && tileCover(fromTile, hills) === 'hill') ? 1 : 3;
}

/**
 * The nation a counter or card of `side` shows: the other one for the coalition's squad (`coalition` in the
 * scenario's JSON: the US seat's squad C are Wehrmacht soldiers in scenario 13). Only its look: the cards and units
 * of both nations are the same.
 */
export function nationOf(sc, side, type) {
    const c = sc?.coalition;
    return c && c.side === side && TYPES[type]?.squad === c.squad ? SIDES[1 - SIDES.indexOf(side)] : side;
}

/** Chance that n d10 roll at least one 0 or one die ≥ total. */
export function hitChance(total, n) {
    const p = (total >= 10 ? 1 : 11 - Math.max(total, 1)) / 10;
    return 1 - (1 - Math.min(p, 1)) ** n;
}
