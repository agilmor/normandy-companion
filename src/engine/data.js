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

/** Cover bonus of a tile against an attack: hills give 3, or 1 against a Blast or an attacker on a hill. */
export function coverOf(tile, { blast = false, fromTile = null } = {}) {
    const c = TILES[tile].cover;
    if (c !== 'hill') return c;
    return blast || (fromTile && TILES[fromTile].cover === 'hill') ? 1 : 3;
}
