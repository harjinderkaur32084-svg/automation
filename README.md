# Table Master – Learn Maths Easily

A colorful, responsive multiplication learning app for Classes 1–12, built with HTML, CSS, and vanilla JavaScript.

## Run locally

Open `index.html` in a modern browser. Students start at the sign-in screen. A parent can select **Parent? Set up Google Sheets** to configure cloud sync or enter the classroom for local-only use.

## Features

- Multiplication tables from 1 to 100, with lessons through ×20
- Class-based recommendations, daily challenge, search, printable worksheets, and voice reading
- Six interactive maths games, quizzes, memorization tricks, progress dashboard, rewards, and parent view
- Local progress storage, light/dark theme, and English/Hindi controls
- Student sign-in and account creation, with learning progress synced to Google Sheets through Google Apps Script

## Google Sheets sync

See [GOOGLE-SHEETS-SETUP.md](./GOOGLE-SHEETS-SETUP.md) for deployment instructions. Configure your own Apps Script deployment in Parent view before enabling cloud sync. `Code.gs` intentionally contains a placeholder Sheet ID; do not publish your private Sheet ID, deployment URL, or student records to a public repository.

Keep the spreadsheet private. Do not commit student records, PINs, or personal spreadsheet IDs to a public repository.

## Project files

- `index.html` — app structure and pages
- `favicon.svg` — browser tab and bookmark icon
- `favicon.svg` — browser tab and bookmark icon
- `style.css` — responsive layout, themes, and animations
- `script.js` — learning features, games, quizzes, and local/cloud progress
- `Code.gs` — Google Apps Script backend
- `GOOGLE-SHEETS-SETUP.md` — cloud setup guide
