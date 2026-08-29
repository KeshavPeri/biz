# Test Inflo locally with Expo Go

Use only fictional accounts, chats, contracts, and payment details.

## Start the app

1. Put your Mac and phone on the same Wi-Fi and turn off any VPN.
2. In Terminal 1, start the backend:
   ```bash
   cd /Users/keshav/Projects/biz/backend
   .venv/bin/uvicorn main:app --reload --host 0.0.0.0 --port 8000
   ```
3. Check `http://localhost:8000/health` in your Mac browser.
4. Find your Mac's Wi-Fi address:
   ```bash
   ipconfig getifaddr en0
   ```
5. In `frontend/.env`, set `EXPO_PUBLIC_API_URL=http://YOUR_MAC_IP:8000`. Do not change or share the other keys.
6. In Terminal 2, start Expo:
   ```bash
   cd /Users/keshav/Projects/biz/frontend
   npx expo start --lan
   ```
7. Open Expo Go on your phone and scan the QR code.

## What to check

- Sign in with fictional creator and brand accounts.
- Open the same deal on two phones and confirm messages and approver status refresh.
- Review all 22 extracted fields; try approve and request-changes paths.
- Check contract generation, the alignment/conflict card, and the signing lock.
- Try drawn signature, typed signature, PDF upload/picker, and signed-PDF opening.
- For the optional live Gemini check, use varied fictional terms and confirm missing or conflicting fields are flagged honestly.

## Stop the app

Press `Ctrl+C` in both Terminal windows. If the phone cannot connect, recheck the same Wi-Fi, the Mac IP in `frontend/.env`, macOS firewall permission, and restart Expo.
