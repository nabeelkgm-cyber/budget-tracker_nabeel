# Budget Tracker (personal, offline, iPhone)

Expense tracking and monthly budget planning. React Native + Expo (TypeScript), data stored on the phone in SQLite. No backend, no login.

## Run it on your iPhone (Expo Go)

One-time:
1. Install **Node.js (LTS)** on your computer from https://nodejs.org.
2. Install **Expo Go** on your iPhone from the App Store.

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
