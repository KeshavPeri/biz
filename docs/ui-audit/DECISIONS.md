# UI decisions for Keshav + Devasri

Fill in "Decision:" with `yes` (use the proposal), `no` (keep current), or your own words.
Decided by Keshav on 2026-09-17. Remediation sessions read this file. A blank decision means: skip that part and leave current behaviour.

1. Field error outline in red (B1-42). Proposal: ink outline + red dot before error text.
   Decision: yes: ink outline + red dot before the error text.
2. Sheet top radius 24 (B1-48). Proposal: add `sheet: 24` token to design-tokens.md.
   Decision: yes: add `sheet: 24` (sheet top corners only). Add it to docs/design-tokens.md in the same PR.
3. Warning/critical washed fills (B2-17 family). Proposal: neutral recess panel + small red/amber icon.
   Decision: yes: neutral recess box + small red dot/icon + clear copy. No red or pink washed fills.
4. Add `expo-glass-effect` for native iOS 26 glass on nav + active pill, BlurView fallback (B1-09). Free.
   Decision: yes: add `expo-glass-effect` with `npx expo install expo-glass-effect` (SDK 54 matched). Use GlassView on nav bar + active pill when `isLiquidGlassAvailable()`, BlurView recipe fallback on older iOS, Android and web.
5. Stage-pill colours (B3-15). Proposal: neutral pills, green tint only Posted, red dot only Disputed.
   Decision: yes: neutral pills; soft green tint only for Posted; small red dot only for Disputed.
6. Win spring on "Request sent" / rating submit (B3-46, B2-66). Proposal: yes for request sent, no for rating.
   Decision: yes to all three: WinSpring on connection request sent, rating submit, and contract signed (in addition to deal closed and payment received).
7. Inbox rows L1 shadow (B3-20). Proposal: L0 hairline rows, L1 only on rows with a pending action.
   Decision: yes: L0 flat hairline rows; L1 lift only on rows with a pending action for the viewer.
8. Chat bubble tail radius 6 (B2-01). Proposal: add `tail: 6` token.
   Decision: yes: add `tail: 6` (chat bubble tail corner only). Add it to docs/design-tokens.md in the same PR.
9. Eyebrow/kicker above onboarding headings (B4-04). Proposal: drop it.
   Decision: yes: drop the eyebrow/kicker on onboarding and auth screens; progress bar + title carry the step.
10. Inset recess shadows invisible on native (B4-22, B5-20). Proposal: `#F6F4EF` fill + hairline.
   Decision: yes: replace inset shadows on native with `#F6F4EF` recess fill + hairline.
11. Routine errors in red text (B5-39, B4-17). Proposal: ink-2 copy; red dot only for payment/contract harm.
   Decision: yes: routine errors in ink-2 text; red dot only for payment, dispute and contract failures.
