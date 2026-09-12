# Block Royale Challenge and Seasons Plan

**Status:** Implemented for testing on `codex/challenge-seasons`; not on `main`

**Feature-branch review begins:** September 12, 2026

**Proposed Season 1 start:** September 25, 2026

## 1. Outcome

Make the leaderboard fair and easy to understand without changing the game the players already know.

The player-facing rule is:

> **Challenge counts. Custom does not. Your fighter progress stays forever.**

The familiar combat, Armory, opponent slider, maps, pets, weapons, coins, XP, mastery, and daily challenges remain. We are separating competitive standing from adjustable matches, not redesigning the game.

## 2. The three match types

| Mode | Purpose | Rules | Progress |
| --- | --- | --- | --- |
| **Challenge** | Climb the leaderboard | Standard opponent count and time; the next opponent tier is automatic; arena and loadout come from the Armory | Coins, XP, mastery, challenges, and seasonal leaderboard |
| **Custom Battle** | Play by your own rules | Keep the existing 1 to 11 opponent slider, skill choices, arena, and time controls | Coins, XP, mastery, and challenges; **never changes the leaderboard** |
| **Training Range** | Internal evaluation and optional weapon testing | Current safe-range behavior | No rewards and no leaderboard |

Training Range remains inside Match Setup or a secondary tools area. It does not become a top-level menu item.

The main menu stays short: **Seasonal Challenge**, **Custom Battle**, **Play with Friends**, **Armory**, and **How to Play**. Seasonal Challenge shows a three-second, read-only launch briefing with the player's current place, next target, and loadout; Custom Battle opens the familiar adjustable setup. Rematches skip the briefing.

The existing opponent slider and presets stay exactly as players know them in Custom Battle. Seasonal Challenge has no setup form; its launch briefing shows the fixed rules as read-only pills.

## 3. Challenge rules

A Challenge match uses:

- 7 opponents
- 3-minute time limit
- The player's selected Armory arena
- The player's owned weapons, pet, food, and cosmetics
- The next uncleared opponent tier: Rookie, Regular, Veteran, Elite, then Nightmare
- The existing last-fighter-standing combat rules

Seven opponents and three minutes match the game's established balance baseline. Keeping arena and loadout choice preserves the value of unlocks and avoids redesigning the Armory economy. This means the Challenge Ladder measures both player ability and fighter progression, which fits this game better than an equal-loadout esports ranking.

### What counts as a Challenge clear

The player must:

1. Win the match under the existing win condition.
2. Score at least 3 eliminations during that match.

If the player survives with fewer than 3 eliminations, show:

> **YOU SURVIVED**
>
> Challenge not cleared. Score 3 eliminations to make it count.

This is the same contribution threshold already used by the reward system. It prevents hiding from becoming the best leaderboard strategy while keeping the existing combat understandable.

### Leaderboard order

Rank players by:

1. Highest difficulty cleared this season
2. Most eliminations in their best clear at that difficulty
3. Most damage in that clear
4. Earliest time the best result was achieved

Do not use accumulated wins as a tie-breaker. Repeating an easy or short match should not improve competitive standing.

The leaderboard explanation should remain one sentence:

> **Beat a standard Challenge with at least 3 eliminations. Your hardest clear sets your Challenge Tier; ties use the best performance.**

## 4. Bots fighting each other

Keep bot-on-bot combat enabled in Challenge.

This is part of the current battle-royale identity. The AI is also intentionally balanced around it: easier bots frequently target each other so a new player is not attacked by the entire lobby at once. Disabling it would turn Challenge into one player versus seven coordinated enemies and would require a substantial AI and difficulty rebalance.

The 3-elimination requirement solves the hiding problem with a visible rule instead of changing the whole combat model.

Do not add a bot-combat switch in the first release. It does not help leaderboard fairness once Custom is unranked, and it adds another setting to explain. If players later request it, it can be added to Custom Battle only, with the current free-for-all behavior as the default.

## 5. Clarify progression

Each system should have one meaning:

- **Coins:** Buy items in the Armory.
- **Fighter Level:** Shows long-term play and XP. Rename the current personal "Rank" label to "Level" without changing XP or titles.
- **Weapon Mastery:** Shows experience with one weapon and remains cosmetic.
- **Challenge Tier:** Rookie through Nightmare, based on the hardest eligible Challenge clear.
- **Leaderboard Place:** Compares seasonal Challenge results only.
- **Daily Challenges:** Short goals that reward regular play.

Custom Battle can continue awarding ordinary personal progression because Fighter Level and owned gear are permanent play history, not competitive standing. The leaderboard must never use Custom results.

Friends PvP remains separate from this PvE Challenge Ladder. It should stay unranked until it has its own proven ranking design.

## 6. Seasons

Use four-week seasons. Two weeks is too easy to miss because of school, travel, or limited device access. Four weeks still refreshes the competition often enough that new players can join.

Only seasonal leaderboard results start fresh. Never reset:

- Coins
- XP or Fighter Level
- Owned or equipped items
- Weapon mastery
- Pets, food, cosmetics, or arenas
- Lifetime match statistics
- Account or club membership

Preserve the current leaderboard as **Preseason** or **All-Time History**. When Season 1 begins, every player starts with no seasonal Challenge clear, but all existing fighter progress remains available.

At first, seasons need only:

- A name, such as `Season 1`
- Start and end dates
- A visible countdown
- The current seasonal leaderboard
- A read-only list of previous season winners

Do not add season passes, paid rewards, resets, or complicated scoring. A small profile badge for the highest tier or top-three finish can be considered later, but it should never provide combat power.

## 7. Two-week transition

For the 14 days before Season 1, show this message on the title and leaderboard screens:

> **SEASON 1 STARTS IN 14 DAYS**
>
> Challenge matches will use 7 opponents, 3 minutes, and require 3 eliminations. Custom Battles will not affect the leaderboard. Your coins, gear, level, and mastery will not reset.

The countdown updates daily. Keep the existing leaderboard visible as Preseason during this period.

At the Season 1 launch:

1. Rename Trial to Challenge.
2. Add Custom Battle while preserving its familiar controls.
3. Start the new seasonal board without deleting old matches.
4. Label XP progression as Fighter Level.
5. Keep Training Range in its current secondary location.

## 8. What we are deliberately not changing

- No Armory redesign
- No opponent-slider redesign
- No weapon, pet, map, or economy rebalance
- No loss of player progress
- No removal of bot-on-bot combat
- No server-authoritative combat rewrite
- No new season pass or reward currency
- No Friends PvP ranking

These boundaries keep the release understandable and reduce risk to the game players already enjoy.

## 9. Success checks

The change is successful when:

- A player can say, "Challenge counts; Custom doesn't."
- A one-opponent Custom win never changes the seasonal leaderboard.
- A Challenge survival with fewer than 3 eliminations does not clear a tier.
- Repeating the same result does not improve leaderboard position.
- Existing coins, levels, items, mastery, and history survive the season launch.
- The leaderboard clearly shows the current season and time remaining.
