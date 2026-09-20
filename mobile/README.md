# Saath for Android

Native Expo app for the Saath family workspace. Same Convex backend as the website: email OTP, rooms, inbox, files, settings, attachments, Gmail, and live voice.

The UI is rebuilt for a phone, not wrapped in a WebView. Warm forest night surfaces, serif titles, large type, and a conversation-first layout.

## Run

Needs a development build (live voice uses WebRTC, which Expo Go cannot load).

```sh
cd mobile
bun install
# EXPO_PUBLIC_CONVEX_URL is already set to the current deployment in .env
bun run android
```

That compiles a native Android app and starts Metro. First build is slow.

To only start Metro after a build exists:

```sh
bun start
```

## What is in this client

- Email OTP sign-in
- Username and first-family onboarding
- Home: My Saathi + family rooms
- Chat: translations stay on the record, @mentions, photos, files, image prompts
- Live voice (dev build)
- Family inbox with confirm / dismiss
- Files
- Settings: language, image style, Gmail, food budget, inbox address, model tier, BYOK, invites

Admin-only Jev debug and the website preview mode are not in the phone app.
