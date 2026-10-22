# Budget Tracker (personal, offline, iPhone)

Expense tracking and monthly budget planning. React Native + Expo (TypeScript), data stored on the phone in SQLite. No backend, no login.

## Run it on your iPhone (Expo Go)

One-time setup:
1. **Check whether Node.js is installed.** Open Terminal (Mac) or Command Prompt / PowerShell (Windows) and type:
   ```bash
   node -v
   ```
   If it prints a version like `v22.x.x` (v20 or higher), skip to step 2.
   If you get "command not found" or "not recognized", install it:
   - Go to https://nodejs.org, download the **LTS** installer, run it with the default options.
   - Close and reopen the Terminal, then run `node -v` again to confirm.
2. Install **Expo Go** on your iPhone from the App Store (keep it updated). This project uses **Expo SDK 57**, which matches the current App Store version of Expo Go.
3. Get the project onto your computer: `git clone https://github.com/nabeelkgm-cyber/budget-tracker_nabeel.git`, then
   `cd budget-tracker_nabeel` and `git checkout claude/amazing-cori-owc4a6`.
   (Or use GitHub's green **Code** button -> **Download ZIP** on that branch and unzip it.)

Then, in this folder:
```bash
npm install
npx expo start
```
Scan the QR code shown in the terminal with the iPhone **Camera** app, then tap the Expo Go link.
Your phone and computer must be on the same Wi-Fi. If that is not possible, run `npx expo start --tunnel`.

## Checks (run on the computer)
```bash
npm test          # logic + database tests
npm run typecheck
```

## Folder guide
```
src/app/        screens (file = screen, Expo Router)
src/domain/     pure logic: money maths, validation (unit-tested)
src/db/         schema migrations, repositories (all SQL lives here), sample data
src/components/ shared UI pieces
src/theme/      light/dark colours, icon and colour choices
__tests__/      automated tests
```

## Money rules
- Amounts are stored as integers in minor units (fils / paise). Never floats.
- Exchange rates are integers scaled by 1e8 and converted with BigInt.
- Each transaction stores the exchange rate used when it was entered, so changing the rate later never changes past figures.
- Credit card = an account with a negative balance when you owe money. Paying the bill is a **transfer**, not an expense.

## Database changes
Schema changes are numbered migrations in `src/db/migrations.ts`. Never edit an old one; add a new one at the end.

## Use it as a web app (no Apple fee)

The same app also runs in the browser and can be installed on the iPhone Home Screen.

**Build** (on your computer, inside the project folder):

```
npm run build:web
```

This creates a folder called `dist`.

**Publish** (free): open https://app.netlify.com/drop, sign in, and drag the `dist` folder onto the page.
Netlify gives you an `https://….netlify.app` address. (Cloudflare Pages also works: upload `dist`.)
To update later, build again and drag the new `dist` folder onto your site's *Deploys* page.

**Install on the iPhone**: open the address in **Safari** → Share button → **Add to Home Screen**.
Always open the app from that Home Screen icon.

**Move your data from the Expo Go version**: in the old app go to More → Backup & data → Create backup,
send the file to yourself, then in the web app use the same screen to restore it.

**Differences from the native app**
- No Face ID (PIN lock only) and no reminders while the app is closed; the Home screen still shows recurring items that are due.
- Data lives inside Safari on that phone. Clearing Safari website data, deleting the Home Screen app, or
  not using it for a long time can erase it, so **make a backup every week**.
- The PIN is stored in the browser, so it keeps casual viewers out but is weaker than the iPhone Keychain.

Developer notes: expo-sqlite web support is alpha; it needs the `Cross-Origin-Opener-Policy` /
`Cross-Origin-Embedder-Policy` headers (set in `metro.config.js` and `public/_headers`), and `Alert` goes through
`src/lib/alert.ts` because react-native-web's own Alert does nothing.

## Cloud sync (same data on every device)

Sync uses a free Supabase project. Your data is stored under your own login, and each login can only see its own rows.
It works in the **web app** (Safari, Chrome, tablets, Android). The Expo Go phone app does not sync.

**One-time setup (about 10 minutes)**
1. Go to https://supabase.com, sign up, and click **New project**. Name it `budget-tracker`, choose a database password
   (save it somewhere), pick the region nearest to you, and wait until it finishes.
2. Open **SQL Editor → New query**, paste the whole contents of `supabase/setup.sql` from this project, and click **Run**.
   It should say *Success*.
3. (Simplest for personal use) **Authentication → Sign In / Providers → Email**: turn **Confirm email** off and save.
4. **Project Settings → API**: copy the **Project URL** and the **anon / publishable key**.
5. In the project folder create a file named `.env` (in Notepad choose *Save as*, set *Save as type* to *All files*) containing:
   ```
   EXPO_PUBLIC_SUPABASE_URL=https://YOUR-PROJECT.supabase.co
   EXPO_PUBLIC_SUPABASE_ANON_KEY=YOUR-KEY
   ```
6. `npm install`, then `npm run build:web`, then upload the `dist` folder to Netlify (Deploys page) as before.
7. Open the app → **More → Cloud sync** → **Create account** → **Start syncing**. On each other device sign in with the
   same email and password. A new device can also tap *Already use this app? Sign in* on the first screen.

**Good to know**
- Changes are sent about a second after you make them and other devices update within moments, and the app still works offline.
- If two devices edit the same entry, the later edit wins. Deleting on one device deletes everywhere.
- When both a device and the cloud already hold data you are asked which one to keep; they are never merged.
- Erase all data, Restore backup and Load sample data are blocked while sync is on (sign out of sync first).
- Free Supabase projects pause after a week of no use. Your data is kept; press *Restore* in the Supabase dashboard.
- Keep making backups. Sync copies mistakes too.
