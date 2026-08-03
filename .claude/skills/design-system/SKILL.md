---
name: design-system
description: Block Manor's visual language — color tokens, type scale, component inventory, block/obstacle sprites, accessibility rules, and how to match the approved mockups in docs/design. Load when building any screen or component.
---
# Design System (PRD §15 companion)

## Tokens (the only colors that exist)
night #131830 · night2 #1C2344 · gold #E9C46A · gold-deep #C99A35 ·
cream #F3EAD7 · muted #98A1C6 · ok #7ED99E · bad #E85D5D
Blocks: coral #E76F51 · teal #2A9D8F · gold #E9C46A · violet #8E7CC3 ·
amber #F4A261 · sky #57A0E5 · rose #D46A9E
Type: Playfair Display (titles/chapters) · Nunito (UI) · tabular numerals
for all scores/timers. Scale: 12/14/16/20/26/34.

## Process for any screen
1. Open its mockup in docs/design/ FIRST — match composition, not just colors
2. Compose from src/components only; a missing component gets added to the
   system with all states (default/pressed/disabled/loading), then used
3. Ship all screen states: loading, empty (one action, inviting tone),
   error (retry), offline where relevant
4. Strings via i18n keys; INR formatting via Intl

## Component inventory
GoldButton(3 sizes) · GhostButton · Card · ModalSheet(brass frame) · HUDBar
· TimerChip · Badge · ProgressBar(xp/event/team) · Toast · Confetti

## Non-negotiable accessibility
Touch ≥44dp · obstacle sprites differ by SHAPE not only color ·
deuteranopia-safe block palette + optional pattern overlay ·
reduced-motion respected · text contrast ≥4.5:1 on night backgrounds

## Feel of the brand
Candlelit, cozy, slightly witty (butler voice). Celebration is generous
(gold, confetti); failure is gentle (desaturation, "so close!"), never
red-alarm punishment. When unsure, warmer.
