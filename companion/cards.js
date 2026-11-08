// The player's physical deck (docs/02 §7.3): the app never draws for the player, it tells them what to do with
// their cards. From the public log: how many to draw and when the discard pile is shuffled into a new deck, the bid
// card to the discard pile, a hunkered card to the supply, the Fog of War from scouting or from the computer's
// Conceal, Bolster, Inspire, Recon and the end of the turn (casualties are in guide.js, with the board). The panel
// "Your cards" shows the piles as the app counts them; hand and deck only together.

import { h } from '../src/ui/dom.js';
import { t } from '../src/i18n/index.js';
import { cardName, sideName } from '../src/ui/text.js';

/** "Rifleman A ×2, Scout B" from card ids or a { type: n } count. */
export function cardList(cards) {
    const n = {};
    if (Array.isArray(cards)) for (const c of cards) n[c.split(':')[1]] = (n[c.split(':')[1]] ?? 0) + 1;
    else Object.assign(n, cards ?? {});
    return Object.entries(n).filter(([, k]) => k > 0).map(([type, k]) => `${cardName(type)}${k > 1 ? ` ×${k}` : ''}`).join(', ');
}

/**
 * Steps for the player's cards caused by log entry `e` (entries[i]). `op` says what the step does to the piles (the
 * tests follow it on a deck of their own): { move: [from, to] }, { draw: n, first } or { endTurn: true }.
 */
export function cardSteps(e, me, entries, i) {
    const step = (text, op) => [{ text, kind: 'cards', mine: true, op }];
    const move = (from, to) => ({ move: [from, to] });
    if (e.k === 'conceal' && e.seat !== me) return [{ text: t('cmp.c.conceal'), kind: 'cards', mine: false, op: move('supply', 'discard') }];
    if (e.k === 'bids' && e.cards[me]) return step(t('cmp.c.bid', { card: cardName(e.cards[me]) }), move('hand', 'discard'));
    if (e.seat !== me) return [];
    switch (e.k) {
        case 'draw': {
            if (!e.n) return step(t('cmp.c.drawNone'));
            const out = [];
            const round = entries.slice(0, i).findLast((x) => x.k !== 'reshuffle' && x.k !== 'draw');
            if (e.first == null) out.push(round?.k === 'round' ? t('cmp.c.drawRound', { round: round.round, n: e.n }) : t('cmp.c.draw', { n: e.n }));
            else if (e.first === 0) out.push(t('cmp.c.drawShuffleFirst', { n: e.n }));
            else out.push(t('cmp.c.drawShuffle', { first: e.first, rest: e.n - e.first }));
            if (e.n < e.want) out.push(t('cmp.c.drawShort', { n: e.n, want: e.want }));
            return step(out.join(' '), { draw: e.n, first: e.first });
        }
        case 'hunker':
            return step(t('cmp.c.hunker', { card: cardName(e.card) }), move('hand', 'supply'));
        case 'scouted':
            return e.fog ? step(t('cmp.c.fogScout', { tile: e.tile }), move('supply', 'discard')) : [];
        case 'bolster':
            return step(t('cmp.c.bolster', { card: cardName(e.card) }), move('supply', 'discard'));
        case 'inspire':
            return step(t('cmp.c.inspire', { card: cardName(e.card) }), move('play', 'hand'));
        case 'recon':
            return step(t('cmp.c.recon'), move('hand', 'removed'));
        case 'endTurn': {
            const left = entries.slice(0, i).findLast((x) => x.k === 'leftover' && x.seat === me && !entries.slice(entries.indexOf(x), i).some((y) => y.k === 'turn'));
            return step(left ? t('cmp.c.endTurnLeft', { cards: cardList(Object.fromEntries(countTypes(left.cards))) }) : t('cmp.c.endTurn'), { endTurn: true });
        }
        default:
            return [];
    }
}

const countTypes = (types) => {
    const m = new Map();
    for (const x of types) m.set(x, (m.get(x) ?? 0) + 1);
    return m;
};

/** The player's cards as the app counts them: hand and deck only together, the rest pile by pile. */
export function deckPanel(view, me, { open = false } = {}) {
    const p = view.players[me];
    const row = (label, text) => [h('b', {}, label), h('span', {}, text || '—')];
    return h('details', { class: 'info deck-panel', open: open || null },
        h('summary', {}, `${t('cmp.deck.title', { side: sideName(me) })} · ${t('cmp.deck.counts', { deck: p.deckCount, hand: p.handCount })}`),
        h('div', { class: 'piles' },
            row(t('cmp.deck.hidden'), cardList(p.hidden)),
            row(t('cmp.deck.discard'), cardList(p.discard)),
            row(t('cmp.deck.play'), cardList(p.play)),
            row(t('cmp.deck.supply'), cardList(p.supply)),
            row(t('cmp.deck.removed'), cardList(p.removed ?? []))));
}

