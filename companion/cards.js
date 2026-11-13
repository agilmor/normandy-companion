// The player's physical deck (docs/02 §7.3): the app never draws for the player, it tells them what to do with
// their cards. From the public log: how many to draw and when the discard pile is shuffled into a new deck, the bid
// card to the discard pile, a hunkered card to the supply, the Fog of War from scouting or from the computer's
// Conceal, Bolster, Inspire, Recon and the end of the turn (casualties are in guide.js, with the board). The panel
// "Your cards" shows the piles as the app counts them; hand and deck only together.

import { h } from '../src/ui/dom.js';
import { t } from '../src/i18n/index.js';
import { cardName, sideName } from '../src/ui/text.js';

/** Card ids or a { type: n } count, grouped: [["RA", 2], ["SB", 1]]. */
function typeCounts(cards) {
    const n = {};
    if (Array.isArray(cards)) for (const c of cards) n[c.split(':')[1]] = (n[c.split(':')[1]] ?? 0) + 1;
    else Object.assign(n, cards ?? {});
    return Object.entries(n).filter(([, k]) => k > 0);
}

const counted = ([type, k]) => `${cardName(type)}${k > 1 ? ` ×${k}` : ''}`;

/** "Rifleman A ×2, Scout B" from card ids or a { type: n } count. */
export function cardList(cards) {
    return typeCounts(cards).map(counted).join(', ');
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

// ------------------------------------------------------------------ the cards panel, three ways (docs/02 §7.9)
// 'player': one panel per player (the player's with the cards they may hold in hand and deck); 'compared': one
// panel, both players side by side pile by pile, sections that fold (PR #1 of the public repository, by Albert Gil);
// 'detailed': the same, with the player's hand-and-deck cards too. Chosen on the start screen and in ☰.

export const CARD_VIEWS = ['player', 'compared', 'detailed'];

/** The panels for the player's choice of view; `fold` keeps the sections folded in 'compared' and 'detailed'. */
export function cardPanels(viewName, view, me, botSeat, { open = false, fold } = {}) {
    if (viewName === 'compared' || viewName === 'detailed') return [cardsPanel(view, me, botSeat, { open, fold, detail: viewName === 'detailed' })];
    return [deckPanel(view, me, { open }), botPanel(view, botSeat, { open })];
}

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

/** The computer's cards: what anyone may see (its discard pile and supply), and how many in hand and deck. */
export function botPanel(view, botSeat, { open = false } = {}) {
    const p = view.players[botSeat];
    const list = (cards) => cardList(cards) || t('cmp.check.none');
    return h('details', { class: 'info bot', open: open || null },
        h('summary', {}, `${sideName(botSeat)} (${t('cmp.bot')}) · ${t('game.handCount', { n: p.handCount })} · ${t('game.deck', { n: p.deckCount })}`),
        h('p', { class: 'small' }, h('b', {}, `${t('game.discardPile')}: `), list(p.discard)),
        h('p', { class: 'small' }, h('b', {}, `${t('game.supply')}: `), list(p.supply)));
}

/** One pile as a column, a line per type of card. */
const pileCol = (cards, right = false) => {
    const types = typeCounts(cards);
    return h('div', { class: `cards-col${right ? ' right' : ''}` }, types.length ? types.map((x) => h('div', {}, counted(x))) : '—');
};

/**
 * Both players side by side, pile by pile, so the same pile compares at a glance; each section folds (`fold`:
 * { collapsed, toggle(key) }). The computer's removed cards stay hidden, as in the rulebook. `detail`: under the
 * player's deck and hand counts, the cards they may hold there.
 */
function cardsPanel(view, me, botSeat, { open = false, fold = { collapsed: {}, toggle: () => {} }, detail = false } = {}) {
    const [mine, bot] = [view.players[me], view.players[botSeat]];
    const title = (key, lines) => h('div', { class: 'cards-title', onclick: () => fold.toggle(key) },
        lines.map((text, i) => h('div', {}, i ? text : `${fold.collapsed[key] ? '▸' : '▾'} ${text}`)));
    const section = (key, label, a, b) => (fold.collapsed[key] ? [title(key, [label])] : [title(key, [label]), pileCol(a), pileCol(b, true)]);
    return h('details', { class: 'info cards-panel', open: open || null },
        h('summary', {}, t('cmp.cards.title')),
        h('div', { class: 'cards-grid' },
            h('div', { class: 'cards-head' }, sideName(me), h('div', {}, `(${t('cmp.you')})`)),
            h('div', { class: 'cards-head right' }, sideName(botSeat), h('div', {}, `(${t('cmp.bot')})`)),
            title('handDeck', [t('cmp.deck.handDeck'), t('cmp.deck.play')]),
            ...(fold.collapsed.handDeck ? [] : [
                h('div', { class: 'cards-col' }, `${mine.deckCount} / ${mine.handCount}`, detail ? h('div', { class: 'cards-hidden muted' }, pileCol(mine.hidden)) : null),
                h('div', { class: 'cards-col right' }, `${bot.deckCount} / ${bot.handCount}`),
                pileCol(mine.play), pileCol(bot.play, true)]),
            ...section('discard', t('cmp.deck.discard'), mine.discard, bot.discard),
            ...section('supply', t('cmp.deck.supply'), mine.supply, bot.supply),
            ...section('removed', t('cmp.deck.removed'), mine.removed ?? [], [])));
}

