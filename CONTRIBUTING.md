# Contributing

Thanks for helping. Spanish or English, as you prefer.

## Reporting a bug

Open an [issue](https://github.com/plissken2013es/normandy-companion/issues/new/choose). The most useful thing is the **game code**: in a game, ☰ → *Code*
copies it (it starts with `UNN1.`). With it we can replay your game up to the moment it went wrong. Say also what
happened, what you expected, and your browser or phone.

## Pull requests

- Plain JavaScript modules, no build and no dependencies. Run `npm test` before sending.
- The rules engine (`src/engine/`) has no DOM, no timers and no `Math.random`; a change to a rule needs a test.
- Every text on screen goes through `t()`, in Spanish and English (`src/i18n/`).
- Nothing of the game itself: no photos or scans of its tiles, cards or counters, and no texts of its rulebook or
  scenario book.

This repository is built from the source of a larger private project, which also has a full digital version used to
study the rules. A pull request accepted here is applied there with its author and comes back in the next release, so
it may be merged by hand rather than with the merge button.
