# Audio drop — how to hand sound files to the build

Everything below is derived from **PRD §15.1** (the cue inventory, where file
names are permanent) and **§7.4** (which moment each cue fires on). This
document is a delivery spec, not a new source of truth — if it and §15.1 ever
disagree, §15.1 wins and this file gets fixed.

Nothing here is wired yet. `apps/mobile/src/game/sfx.ts` currently exposes a
no-op `playCue(cue, semitones?)` called at each §7.4 moment. One follow-up
session turns that into real playback once files land; do not add audio code
before then.

## What to do

1. Rename each file to **exactly** the cue name in the tables below, plus the
   extension (`piece_pick.m4a`, not `Piece Pick v3 FINAL.m4a`). The names are
   the API — §15.1 calls them permanent, and `sfx.ts`'s union type is generated
   from them.
2. Drop them into `apps/mobile/assets/audio/` (create it; it does not exist yet).
3. Tell me they've landed. The wiring session does the rest: real playback,
   the sprite build, the mute toggles, and the PRD amendment below.

## Format specs

| Property | SFX | Music |
|---|---|---|
| Sample rate | 44.1 kHz | 44.1 kHz |
| Channels | **mono** | stereo |
| Format | `.m4a` (AAC) preferred, `.wav` accepted for masters | `.m4a` (AAC) |
| Bitrate | 96–128 kbps VBR | 128 kbps VBR |
| Peak | −1.0 dBTP (true peak), no clipping | −1.0 dBTP |
| Loudness | −16 LUFS integrated | −20 LUFS integrated (sits under SFX) |
| Trim | zero leading silence — latency is audible on a snap | — |
| Loops | — | seamless, zero-crossing edits, no fade at the seam |

**Hard budget: ≤ 4 MB total**, all audio, per §15.1. That is the binding
constraint — at ~110 kbps mono, the full SFX inventory fits in roughly 1.5 MB
and leaves the rest for the three music beds, which is why music streams
separately rather than sitting in the sprite.

Two §15.1 rules that shape the mix, not just the files:

- **UI taps ≤ −18 dB relative to gameplay SFX.** Deliver `btn_tap` / `btn_gold`
  already quiet; do not rely on the app to duck them.
- **No silent interactions on rewarding moments.** Every cue below must exist
  before the screen that fires it ships — a missing file is a blocked screen,
  not a soft degrade.

## Cue list

Stage-1 cues are the ones that block current work. Later-stage cues are listed
so you can record them in the same session, but they are not blocking today.

### Gameplay — §7.4, needed now

| File | Fires on | Notes |
|---|---|---|
| `piece_pick` | tray piece lifted | soft pick; pairs with a `selection` haptic |
| `snap_thock` | legal placement settles | wooden thock, 90 ms window |
| `clear_chime` | line clear | **pitched at runtime**: `+1 semitone × (comboDisplay − 1)`, capped +7. Deliver ONE unpitched sample — a first clear plays it unshifted (§0 v1.7) |
| `combo_layer` | multi-line clear | layers *over* `clear_chime`, does not replace it |
| `perfect_gliss` | perfect clear | harp gliss, ~600 ms to match the shimmer |
| `near_death_amb` | board fill > 0.8 | **loop**, low ambience, starts/stops with the vignette |
| `win_fanfare` | level win | |
| `fail_thud` | level fail | muffled |

### UI — needed as screens ship (§7.5, §7.11, §12)

| File | Fires on |
|---|---|
| `btn_tap` | every button, subtle |
| `btn_gold` | primary CTAs, warmer |
| `modal_open` / `modal_close` | sheets and modals |
| `toast` | toasts |

### Music — §7.4, three beds

| File | Context |
|---|---|
| `music_home` | Home / manor — warm, fireplace-cozy, ~70 BPM |
| `music_gameplay` | gameplay — light, minimal, non-intrusive |
| `music_daily_tension` | **layer** over `music_gameplay` when Daily Board fill > 0.7 — a volume-automated layer, NOT a track switch |

Music is on by default and ducks −12 dB under SFX moments (§7.4). Licensed
loops must be listed in the repo `NOTICE` — send licence details with the files.

### Later stages — record now, wire later

Reward/economy (Stage 2): `coin_single`, `coin_flurry` (count-scaled volume),
`star_slam` (win stars, ×3), `chest_open`, `booster_hammer`, `booster_broom`,
`booster_hourglass`, `streak_flame_up`, `streak_break`.

Daily/meta: `daily_reveal` (percentile count-up riser), `share_ready`,
`reno_complete` (S3, sparkle sweep), `chapter_sting` (S3).

## Known amendment, deferred until files exist

§7.4 and §15.1 both name **`expo-av`**, which Expo deprecated in favour of
**`expo-audio`** on SDK 57. The wiring session makes that amendment (a §0
changelog row) as its first step, per the one law. It is deliberately not made
now: amending toward a library we have nothing to play through would be a
speculative edit to the source of truth.

`star_slam` is worth flagging when you record: §15.1 files it under
reward/economy, but §7.4's win row fires it in Stage 1. Deliver it with the
Stage-1 batch if you can.
