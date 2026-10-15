# Worklist (temporary)

Tracking file for the docs/balance review pass. **Delete this file in the last commit** once every box is ticked or marked BLOCKED.

How to resume: read the first unticked item, do it, run `npm test`, `npm run lint`, `npm run typecheck`, update the docs and CHANGELOG in the same commit, tick the box here with the commit hash. Rules: additive migrations only (023+), no `Co-Authored-By` trailers, one commit per item or small group.

## P0 Tracking and safety net
- [x] P0.1 This worklist (cc726bf)
- [x] P0.2 `scripts/balance-sim.js` and `packages/shared/test/balance.test.js`

## P1 Bug fixes
- [x] P1.1 Cap class bonus on item_add and list_create at 3x base
- [x] P1.2 Prestige bonus no longer rounds away
- [x] P1.3 Artisan keeps half its progress on a clear, clear bonus 5 -> 8
- [ ] P1.4 Cap HIGH-priority bonuses at 3 completions a day
- [ ] P1.5 Hero's generic skills (Champion, Legendary, Valor, Inspire) become class-only
- [ ] P1.6 Daily claim by calendar day (KNOWN_ISSUES #37); check Sniper list-priority resolution
- [ ] P1.7 Lint warnings (7)

## P2 Balance pass (existing classes)
- [ ] P2.1 Nerfs: Monk, Wizard, Hero, Gambler, Archer
- [ ] P2.2 Buffs: Tank, Assassin, Paladin, Ranger, Necromancer
- [ ] P2.3 Docs tables regenerated from the sim

## P3 New skills for existing classes
- [ ] P3.1 One new skill per existing class tree
- [ ] P3.2 Three new Default skills

## P4 New classes
- [ ] P4.0 Migration and shared plumbing for new classes
- [ ] P4.1 Bard
- [ ] P4.2 Alchemist
- [ ] P4.3 Druid
- [ ] P4.4 Chronomancer
- [ ] P4.5 Warden

## P5 New XP sources
- [ ] P5.1 perfect_day
- [ ] P5.2 inbox_zero (weekly)
- [ ] P5.3 reflection (daily)
- [ ] P5.4 boss tasks
- [ ] P5.5 comeback bonus
- [ ] P5.6 weekly goal
- [ ] P5.7 party task bonus
- [ ] P5.8 seasonal weekly modifier
- [ ] P5.9 estimate accuracy

## P6 Product and UX
- [ ] P6.1 Class what-if calculator
- [ ] P6.2 Skill respec / refund
- [ ] P6.3 XP breakdown popover
- [ ] P6.4 Undo for completions
- [ ] P6.5 Today screen
- [ ] P6.6 Streak-at-risk reminder
- [ ] P6.7 Visual skill tree and next-unlock hints
- [ ] P6.8 Kanban and calendar views
- [ ] P6.9 Empty states, mobile gestures and bottom nav, accessibility pass
- [ ] P6.10 Shared-list ownership transfer
- [ ] P6.11 Party boards and extra party quests
- [ ] P6.12 Archive job and XP-per-class report

## P7 Docs
- [ ] P7.1 Index refresh, start-here pages, KNOWN_ISSUES split, CHANGELOG

## P8 Blocked (not built, needs the outside world)
- BLOCKED live Gemini evals (needs an API key)
- BLOCKED real screenshots (needs a signed-in deployment)
- BLOCKED push delivery verification (needs real push services) and push for AI results
- BLOCKED full internationalisation
