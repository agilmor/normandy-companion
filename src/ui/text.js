// Texts built from engine data: card and unit names, prompts, option labels, log lines and results.

import { t, tr } from '../i18n/index.js';
import { TYPES, UNITS, hitChance, unitKind, unitType } from '../engine/data.js';

const SIDES = ['us', 'de'];
export const sideName = (seat) => t(`side.${SIDES[seat]}`);

/** Card type `RA` → "Fusilero A". */
export function cardName(type) {
    const c = TYPES[type];
    return c.squad ? `${tr(c.name)} ${c.squad}` : tr(c.name);
}

/** A card's name with its initiative, shown wherever a card is picked by name: "Fusilero A (5)". */
export function cardLabel(type) {
    return `${cardName(type)} (${TYPES[type].initiative})`;
}

/** Unit id `de:RA` → "Fusileros A (Alemania)"; own units without the side. */
export function unitName(uid, viewer) {
    const type = unitType(uid);
    const base = tr(UNITS[unitKind(type)].name) + (type.length === 2 && !['MO', 'SN'].includes(type) ? ` ${type[1]}` : '');
    return viewer == null || SIDES[viewer] === uid.slice(0, 2) ? base : `${base} (${t(`side.${uid.slice(0, 2)}`)})`;
}

export function actionName(a, value, squad) {
    return `${t(`act.${a}`)}${value ? ` ${value}` : ''}${squad ? ` ${squad}` : ''}`;
}

export function promptText(req, viewer) {
    const unit = req.unit ? unitName(req.unit, viewer) : '';
    return t(`prompt.${req.kind}`, { unit, step: req.step, of: req.of, left: req.left });
}

export function optionLabel(req, o, viewer) {
    if (o.id === 'end') return t('opt.end');
    if (o.id === 'stop') return t('opt.stop');
    if (o.id === 'done') return t('opt.done');
    switch (req.kind) {
        case 'bid':
            return cardLabel(o.card);
        case 'play':
            if (o.action === 'hunker') return t('opt.hunker');
            if (o.action === 'rally') return t('opt.rally');
            return actionName(o.action, o.value, o.squad);
        case 'attack':
        case 'suppress':
            return t('opt.attack', { ...o, unit: unitName(o.unit, viewer), pct: Math.round(100 * hitChance(o.total, o.dice)) });
        case 'guide':
            return `${unitName(o.unit, viewer)} (${o.tile})`;
        case 'bolster':
        case 'inspire':
            return cardLabel(o.card);
        default:
            return o.tile ?? o.id;
    }
}

const KIND = { attack: 'act.attack', suppress: 'act.suppress', blast: 'act.blast' };

/** Card names with repeats counted: "Niebla de guerra ×2, Fusilero A". */
export function cardsText(types) {
    const n = new Map();
    for (const c of types) n.set(c, (n.get(c) ?? 0) + 1);
    return [...n].map(([c, k]) => (k > 1 ? `${cardName(c)} ×${k}` : cardName(c))).join(', ');
}

export function logLine(e, viewer) {
    const side = e.seat != null ? sideName(e.seat) : '';
    const p = { ...e, side };
    if (e.unit) p.unit = unitName(e.unit, viewer);
    if (e.target) p.target = unitName(e.target, viewer);
    if (e.card) p.card = cardName(e.card);
    switch (e.k) {
        case 'bids':
            return t('log.bids', { us: e.cards[0] ? cardName(e.cards[0]) : '—', de: e.cards[1] ? cardName(e.cards[1]) : '—', side: sideName(e.initiative), kept: e.kept ? t('log.kept') : '' });
        case 'play':
            return t('log.play', { ...p, action: actionName(e.action, e.value) });
        case 'scouted':
            return t('log.scouted', { ...p, fog: e.fog ? t('log.fog') : '' });
        case 'attack':
            return t('log.attack', { ...p, kind: t(KIND[e.kind]), dice: e.dice ? e.dice.join(' ') : t('log.physicalDice'), result: t(e.hit ? 'log.hit' : 'log.miss') });
        case 'leftover':
            return t('log.leftover', { ...p, cards: cardsText(e.cards) });
        case 'casualty':
            return t('log.casualty', { ...p, from: t(`log.from.${e.from}`) });
        case 'paradrop': {
            // the 0 counts as 10 ([D-39])
            const dice = e.rolls.map(([a, b], i) => `${a || 10}+${b || 10}=${(a || 10) + (b || 10)}${i < e.rolls.length - 1 ? t('log.noTile') : ''}`).join(', ');
            return t('log.paradrop', { ...p, dice, marker: e.marked ? t('log.paradropMarker') : '' });
        }
        case 'gameOver':
            return t('log.gameOver', { result: resultText(e) });
        default:
            return t(`log.${e.k}`, p);
    }
}

export function noteLine(n) {
    if (n.k === 'drew') return t('note.drew', { cards: n.cards.map((c) => cardName(c.split(':')[1])).join(', ') });
    if (n.k === 'bid') return t('note.bid', { card: cardName(n.card) });
    if (n.k === 'stuck') return t('note.stuck', { n: n.n });
    return n.k;
}

export function resultText(r) {
    return t(`result.${r.how}`, { side: r.winner != null ? sideName(r.winner) : '' });
}
