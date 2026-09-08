/**
 * §12.1 layout reservation, same idea as `FailScreen`'s
 * `CONTINUE_SLOT_RESERVED_HEIGHT` (§0 rule 2a): a later-stage settings row
 * (language S3; link account / restore purchases / delete account S2)
 * occupies its final row height NOW, so the Stage-2/3 PR that fills it in
 * drops in without a layout shift. A plain constant, not derived from
 * `SheetRow`'s own height, because that component is local to `PauseSheet`
 * (deliberately not promoted to `src/components` — see that file's own
 * note) and this screen has no row of its own to measure it from yet either.
 */
export const SETTINGS_RESERVED_ROW_HEIGHT = 52;
