# Remote testing runbook — getting Inflo onto Devasri's phone (India ↔ Singapore)

**Situation:** Devasri is in India, Keshav in Singapore — different networks, so the usual
"run the server, scan the QR on the same wifi" (LAN mode) will not reach her.

**Devasri's phone:** iOS → the free/instant path is **Expo tunnel + Expo Go**.
(TestFlight, the "install once" iOS path, needs a paid Apple Developer account — see the last
section. It's a decision for Keshav, not something this runbook does.)

---

## The short version

1. Keshav wakes the Supabase project (if it's been idle) and runs the app with `--tunnel`.
2. Keshav sends Devasri the tunnel link (or QR).
3. Devasri opens it in **Expo Go** on her iPhone.
4. She logs in / signs up and tests. If it won't connect, it's almost always (a) Keshav's
   laptop/tunnel not running, or (b) the Supabase project asleep — ping Keshav.

The catch: **Keshav's laptop must be running the tunnel the whole time she's testing**, and you
both need an overlapping window (IST and SGT are ~2.5h apart — SGT is ahead).

---

## For Keshav — start the tunnel

Run these from the repo each testing session:

```bash
# 1. (Once per session) make sure the dev Supabase project is AWAKE.
#    Free tier pauses on inactivity. If Devasri's app can't reach the backend,
#    this is the usual cause. Resume it in the Supabase dashboard → your project →
#    click "Resume"/"Restore" if it shows as paused.

# 2. Start Metro with a public tunnel:
cd frontend
npx expo start --tunnel
```

Notes:
- **First run** will ask to install `@expo/ngrok` — say yes (one-time, free).
- The terminal prints a **QR code** and a URL like `exp://xxxx.exp.direct`. That URL/QR is what
  Devasri uses — it works over the public internet, not just your wifi.
- Keep the terminal open. Closing it, sleeping the laptop, or dropping wifi kills the tunnel.
- Tunnels can be **slow or occasionally flaky** (it's a free third-party relay). If it hangs,
  `Ctrl-C` and re-run `npx expo start --tunnel`. If ngrok itself is having an outage the command
  errors out — just retry, or check status.expo.dev.
- Send Devasri the link the easiest way (WhatsApp the URL, or screenshot the QR). Pressing `s`
  in the Expo CLI can also send it as needed.

## For Devasri — open the app

1. On your iPhone, install **Expo Go** from the App Store (if not already).
2. Open the link Keshav sends (tap it), **or** open Expo Go → scan the QR he sends.
3. The app ("Inflo") downloads into Expo Go and launches. First load over a tunnel can take
   30–60s — give it a moment.
4. **If the OTP email doesn't arrive, check your spam folder.** Dev emails come from a Gmail
   sender via Brevo and often land in spam.
5. **If it won't connect / spins forever:** message Keshav. It's almost always his tunnel not
   running or the Supabase project asleep — nothing you did wrong.

### Compatibility — mostly a non-issue
Keshav also has an iPhone, so **the simplest check is: Keshav runs the tunnel and opens the app
in Expo Go on his own iPhone first.** If it works on his, it will work on Devasri's — Expo Go on
iOS is the same App Store build for both, so as long as Devasri's Expo Go is **updated to the
current version**, they're on the same SDK and behave the same. Only edge case: if her Expo Go is
badly out of date, have her update it from the App Store. (If either phone ever shows an
"unsupported SDK / update required" message, tell Keshav — it's a version mismatch, not an app bug.)

---

## What Devasri can actually test right now

Only these surfaces are real (Phase 7 — Identity & Trust). Everything else is a placeholder —
the "What's built" tab of the tracker has the full checklist and the known-limitations list, so
placeholders aren't logged as bugs.

- **Auth:** sign up (email + password) → 6-digit email OTP → login → stays logged in.
- **Creator onboarding:** role pick → name/city/up to 3 niches/languages/bio → connect socials
  (mock stats) → inbound/outbound prefs → signature (draw or type) → completeness ring + recap.
- **Brand onboarding:** role pick → company/industry/GST/domain → lands in app.
- **Account tab:** log out; maker-checker config (toggles are *disabled for a solo brand* — that's
  correct, not a bug).

---

## The iOS "install once" option (a cost decision — Keshav to make)

Tunnel + Expo Go works today but tethers Devasri to Keshav's laptop being on. The async
alternative on iOS is an **EAS preview build distributed via TestFlight**, so she installs once and
tests on her own schedule, with OTA updates.

**This requires a paid Apple Developer account (~US$99/yr)** — a cost gate. It is deliberately
**not** set up by this runbook. If the back-and-forth of tunnel sessions gets painful, that's the
upgrade to weigh. (On Android this would be free via an APK link — but Devasri is on iOS, so the
free async path isn't available without the Apple account.)

**Recommendation:** start with tunnel + Expo Go now (free, unblocks her today). If session
overlap or laptop-uptime becomes a real friction, revisit the $99/yr TestFlight path then.

---

## Shared links (for Devasri's briefing PDF, later)

- **Testing tracker (Google Sheet):**
  https://docs.google.com/spreadsheets/d/1YJ5CMGCPFBrDwV3-BbSM6iU7DKyZuU4KZ1aaSrMa53c/edit
- **Logging form ("Log an Inflo issue") — share this with Devasri:**
  https://docs.google.com/forms/d/e/1FAIpQLSdam-2PU7HL61Qytpi2r3GdtmsyC6_95CyEb7H_t3seToOEfA/viewform
- **Form editor (for Keshav):**
  https://docs.google.com/forms/d/1zmfdo3rBXzgvxBtGslffjkHTPdB0tK05LxBlLNGNIBk/edit
