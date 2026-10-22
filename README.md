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
