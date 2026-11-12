// The board's frame (like 58's map, copied from 60): the viewBox is the zoom, so tiles and counters stay sharp. One finger drags
// (past 8 px it is no tap), two pinch, the wheel zooms, ⤢ shows the whole board again. A long press or a right click
// asks about the point under it. With a finger a pick takes two taps: the first arms it and names it, the second on
// the same piece acts. The frame outlives every render, so the zoom stays while the board is redrawn.

import { h } from './dom.js';
import { LONG_PRESS_MS } from './touch.js';

const MAX_ZOOM = 5;

export class BoardZoom {
    /**
     * @param {{ onInfo?: (x: number, y: number) => void, tapAgain?: (pick: string) => string, resetLabel?: string }} o
     *   onInfo gets board coordinates; tapAgain names an armed pick (its option id)
     */
    constructor(o = {}) {
        this.o = o;
        this.svg = null;
        this.base = null; // the board's own viewBox
        this.z = 1; // 1 = the whole board fits
        this.c = null; // board point at the middle of the frame
        this.armed = null;
        this.reset = h('button', { class: 'board-reset', hidden: true, title: o.resetLabel ?? '', onclick: () => this.resetView() }, '⤢');
        this.tip = h('div', { class: 'arm-tip', hidden: true });
        this.el = h('section', { class: 'board-wrap' }, this.reset, this.tip);
        new ResizeObserver(() => this.apply()).observe(this.el);
        this.bind();
    }

    /** Puts a freshly drawn board in the frame, with the zoom it had if it is the same board. */
    show(svg) {
        const base = svg.getAttribute('viewBox').split(' ').map(Number);
        if (!this.base || base.join() !== this.base.join()) {
            this.base = base;
            this.z = 1;
            this.c = [base[0] + base[2] / 2, base[1] + base[3] / 2];
        }
        this.svg?.remove();
        this.svg = svg;
        this.el.prepend(svg);
        this.arm(null);
        this.apply();
    }

    resetView() {
        this.z = 1;
        this.c = [this.base[0] + this.base[2] / 2, this.base[1] + this.base[3] / 2];
        this.apply();
    }

    /** Screen pixels per board unit at the current zoom. */
    scale() {
        const r = this.el.getBoundingClientRect();
        return Math.min(r.width / this.base[2], r.height / this.base[3]) * this.z;
    }

    /** The viewBox is the part of the board the frame shows: as wide and tall as the frame, never past the edges. */
    apply() {
        if (!this.svg || !this.base) return;
        const r = this.el.getBoundingClientRect();
        if (!r.width || !r.height) return;
        const k = this.scale();
        const w = r.width / k, hgt = r.height / k;
        const [bx, by, bw, bh] = this.base;
        const clamp = (v, size, lo, len) => (size >= len ? lo + len / 2 : Math.min(Math.max(v, lo + size / 2), lo + len - size / 2));
        this.c = [clamp(this.c[0], w, bx, bw), clamp(this.c[1], hgt, by, bh)];
        this.svg.setAttribute('viewBox', [this.c[0] - w / 2, this.c[1] - hgt / 2, w, hgt].map((v) => v.toFixed(2)).join(' '));
        this.reset.hidden = this.z <= 1.01;
    }

    /** Board coordinates under a screen point. */
    toBoard(clientX, clientY) {
        const p = new DOMPoint(clientX, clientY).matrixTransform(this.svg.getScreenCTM().inverse());
        return [p.x, p.y];
    }

    /** Zooms by `factor` keeping the board point under (clientX, clientY) where it is. */
    zoomAt(factor, clientX, clientY) {
        const [x, y] = this.toBoard(clientX, clientY);
        this.z = Math.min(MAX_ZOOM, Math.max(1, this.z * factor));
        const r = this.el.getBoundingClientRect();
        const k = this.scale();
        this.c = [x - (clientX - r.left - r.width / 2) / k, y - (clientY - r.top - r.height / 2) / k];
        this.arm(null);
        this.apply();
    }

    bind() {
        const el = this.el;
        const pointers = new Map();
        let drag = null, pinch = null, press = null, swallow = false, touch = false;
        const onBoard = (ev) => this.svg?.contains(ev.target);
        const pinchInfo = () => {
            const [a, b] = [...pointers.values()];
            return { dist: Math.hypot(a.x - b.x, a.y - b.y), x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        };
        const cancelPress = () => { clearTimeout(press); press = null; };
        el.addEventListener('pointerdown', (ev) => {
            if (!onBoard(ev)) return;
            touch = ev.pointerType !== 'mouse';
            swallow = false;
            pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
            cancelPress();
            if (pointers.size === 2) {
                pinch = pinchInfo();
                drag = null;
                return;
            }
            if (ev.button !== 0) return;
            drag = { x: ev.clientX, y: ev.clientY, c: [...this.c], moved: false };
            if (!touch) return;
            press = setTimeout(() => {
                press = null;
                const at = drag;
                drag = null;
                if (!at) return;
                swallow = true;
                this.arm(null);
                this.o.onInfo?.(...this.toBoard(at.x, at.y));
            }, LONG_PRESS_MS);
        });
        const forget = (ev) => {
            pointers.delete(ev.pointerId);
            if (pointers.size < 2) pinch = null;
            if (!pointers.size) { cancelPress(); el.classList.remove('panning'); }
        };
        el.addEventListener('pointermove', (ev) => {
            if (!pointers.has(ev.pointerId)) return;
            pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
            if (pinch && pointers.size === 2) {
                const now = pinchInfo();
                this.zoomAt(now.dist / Math.max(pinch.dist, 1), now.x, now.y);
                // the two fingers also drag: the midpoint moves the board
                const k = this.scale();
                this.c = [this.c[0] - (now.x - pinch.x) / k, this.c[1] - (now.y - pinch.y) / k];
                this.apply();
                pinch = now;
                swallow = true;
                return;
            }
            if (!drag) return;
            if (!drag.moved && Math.hypot(ev.clientX - drag.x, ev.clientY - drag.y) < 8) return;
            if (!drag.moved) {
                try {
                    el.setPointerCapture(ev.pointerId);
                } catch {} // a pointer that is already gone
                el.classList.add('panning');
            }
            drag.moved = true;
            swallow = true;
            cancelPress();
            const k = this.scale();
            this.c = [drag.c[0] - (ev.clientX - drag.x) / k, drag.c[1] - (ev.clientY - drag.y) / k];
            this.arm(null);
            this.apply();
        });
        el.addEventListener('pointerup', (ev) => { forget(ev); drag = null; });
        el.addEventListener('pointercancel', (ev) => { forget(ev); drag = null; });
        el.addEventListener('wheel', (ev) => {
            if (!onBoard(ev)) return;
            ev.preventDefault();
            this.zoomAt(Math.exp(-ev.deltaY * 0.0015), ev.clientX, ev.clientY);
        }, { passive: false });
        el.addEventListener('contextmenu', (ev) => {
            if (!onBoard(ev)) return;
            ev.preventDefault();
            if (touch) return; // a finger's long press was handled by the timer
            this.o.onInfo?.(...this.toBoard(ev.clientX, ev.clientY));
        });
        el.addEventListener('click', (ev) => {
            if (!onBoard(ev)) return;
            if (swallow) { swallow = false; ev.stopPropagation(); ev.preventDefault(); return; }
            if (!touch) return;
            const pick = /** @type {Element} */ (ev.target).closest?.('[data-pick]');
            if (!pick) { this.arm(null); return; }
            if (pick.hasAttribute('data-now')) { this.arm(null); return; } // one tap: what it opens asks again
            if (this.armed === pick.dataset.pick) { this.arm(null); return; } // second tap: let it act
            ev.stopPropagation();
            this.arm(pick, ev.clientX, ev.clientY);
        }, true);
    }

    /** Marks a pick as armed by a first tap (null disarms) and names it beside the finger. */
    arm(pick, clientX = 0, clientY = 0) {
        this.svg?.querySelector('.armed')?.classList.remove('armed');
        this.armed = pick ? pick.dataset.pick : null;
        this.tip.hidden = !pick;
        if (!pick) return;
        pick.classList.add('armed');
        this.tip.textContent = this.o.tapAgain?.(this.armed) ?? '';
        const box = this.el.getBoundingClientRect();
        const x = clientX - box.left, y = clientY - box.top;
        const half = Math.min(this.tip.offsetWidth / 2 + 4, box.width / 2);
        this.tip.style.left = `${Math.min(Math.max(x, half), box.width - half)}px`;
        this.tip.style.top = `${y > 70 ? y - 54 : y + 34}px`;
    }
}
