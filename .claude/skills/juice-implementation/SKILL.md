---
name: juice-implementation
description: Implementation patterns for game feel — Skia board rendering, Reanimated drivers, haptics mapping, audio triggering, and the PRD §7.4 juice table. Load when building or tuning anything the player sees or feels on the board.
---
# Juice Implementation

## Architecture
- ONE Skia canvas draws the board: cells, blocks, ghosts, particles. React
  re-renders never drive frames; Reanimated shared values + Skia do.
- src/game/juice.ts holds EVERY timing/scale/offset as named tokens matching
  PRD §7.4. Tuning = editing tokens, shippable via EAS Update.
- Engine GameEvent[] → a juice dispatcher maps each event to (animation,
  haptic, sound) triples. One mapping table, not scattered calls.

## The five moments, in priority order
1. Line clear: staggered cell pops (12ms/cell outward from placement),
   particles, floating +N, haptic impactMedium, chime pitched up per combo
2. Legal snap: 90ms spring + impactLight + thock (this is 80% of feel)
3. Drag: piece rides -80px above finger, ghost at nearest legal anchor
   within 0.6-cell snap radius, green/red 45% tints
4. Near-death: red edge vignette pulse when fill>0.8
5. Fail: 400ms desaturation — soft landing, not punishment (PRD P2)

## Rules
- Audio: expo-av preloaded sprite; combo chime rises +1 semitone/level,
  cap +7; duck music -12dB under SFX
- Haptics exactly per the §7.4 table (expo-haptics); never add haptics to
  passive events
- Reduced-motion: kill shakes/particles, keep snap/clear core feedback
- Profile on Redmi-class device; report worst frame time. 60fps is the bar
- If a specced value feels wrong ON DEVICE, propose a change with the felt
  reason — but the PRD amends before the token changes
