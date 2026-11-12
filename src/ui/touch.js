// Touch screens, as in the sibling apps (48, 52, 55, 58, 59): a long press reads a card without playing it, the
// viewer is browsed by swiping, a pick is made with two taps of a finger and the page can go full screen. The desktop
// keeps clicks; a right click does what a long press does.

export const LONG_PRESS_MS = 450;

/**
 * A long press on an element of `root` for which `find(target)` returns something calls `onLong(found)`; the click
 * that follows is swallowed, and the browser's own long-press menu (save image, select) does not show. A right click
 * on the same elements calls `onLong` too.
 * @returns {() => void} removes the listeners
 */
export function longPress(root, find, onLong) {
    let timer = null;
    let from = null;
    let swallow = false;
    let touchHeld = false;
    const cancel = () => {
        clearTimeout(timer);
        timer = null;
    };
    const down = (ev) => {
        touchHeld = false;
        const found = find(ev.target);
        if (!found || ev.pointerType === 'mouse') return;
        from = [ev.clientX, ev.clientY];
        cancel();
        timer = setTimeout(() => {
            timer = null;
            swallow = true;
            touchHeld = true;
            onLong(found);
        }, LONG_PRESS_MS);
    };
    const move = (ev) => {
        if (timer && Math.hypot(ev.clientX - from[0], ev.clientY - from[1]) > 10) cancel();
    };
    const menu = (ev) => {
        const found = find(ev.target);
        if (!found) return;
        ev.preventDefault();
        if (!touchHeld) onLong(found); // a mouse's right click (a finger's long press was handled by the timer)
    };
    const click = (ev) => {
        if (!swallow) return;
        swallow = false;
        ev.preventDefault();
        ev.stopPropagation();
    };
    const listeners = [['pointerdown', down], ['pointermove', move], ['pointerup', cancel], ['pointercancel', cancel], ['contextmenu', menu]];
    for (const [k, f] of listeners) root.addEventListener(k, f);
    root.addEventListener('click', click, true);
    return () => {
        for (const [k, f] of listeners) root.removeEventListener(k, f);
        root.removeEventListener('click', click, true);
    };
}

/** A horizontal swipe on `el` (more than 40 px, more across than down) calls onSwipe(-1) leftwards or (+1) rightwards. */
export function swipe(el, onSwipe) {
    let from = null;
    el.addEventListener('pointerdown', (ev) => { from = [ev.clientX, ev.clientY]; });
    el.addEventListener('pointerup', (ev) => {
        if (!from) return;
        const dx = ev.clientX - from[0];
        const dy = ev.clientY - from[1];
        from = null;
        if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy)) onSwipe(dx < 0 ? -1 : 1);
    });
    el.addEventListener('pointercancel', () => { from = null; });
}

/** The last pointer was a finger (or a pen), not a mouse: a pick then waits for a second tap. */
let lastPointer = 'mouse';
document.addEventListener('pointerdown', (ev) => { lastPointer = ev.pointerType; }, true);
export const fingerTap = () => lastPointer !== 'mouse';

// Full screen: not on iPhone (Safari does not allow it) and not inside the Android app (mobile/), already full screen.
const iPhone = () => /iPhone|iPod/.test(navigator.userAgent);
export const inApp = () => Boolean(window.Capacitor?.isNativePlatform?.());
export const canFullscreen = () => Boolean(document.fullscreenEnabled || document.webkitFullscreenEnabled) && !iPhone() && !inApp();
export const isFullscreen = () => Boolean(document.fullscreenElement || document.webkitFullscreenElement);

export async function toggleFullscreen() {
    try {
        if (isFullscreen()) await (document.exitFullscreen ?? document.webkitExitFullscreen).call(document);
        else {
            const el = document.documentElement;
            await (el.requestFullscreen ?? el.webkitRequestFullscreen).call(el, { navigationUI: 'hide' });
        }
    } catch (err) {
        console.warn('fullscreen:', err);
    }
}
