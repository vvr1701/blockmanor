/**
 * FailScreen presentation tokens — PRD §7.5 / §9.4, following the
 * `src/game/juice.ts` / `FtueScreen/ftueTokens.ts` convention: every
 * layout constant this screen uses is named here, never an inline literal.
 */

/**
 * §9.4 continue-button slot reservation (CLAUDE.md rule 1 / §0 rule 2a: a
 * flag-hidden slot a current-stage section explicitly specs IS in scope as a
 * pure layout reservation). Sized off the Production Spec's "3.6 Fail /
 * Continue" panel's primary-CTA card (`padding:15px 16px`, ~52px content +
 * padding) so §9.4 drops its real `ContinueSheet`-triggering button in here
 * without reflowing this screen. Renders nothing, reads no Stage-2 state.
 */
export const CONTINUE_SLOT_RESERVED_HEIGHT = 64;
