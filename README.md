# Password Library

Password Library is a plain local-file web app for storing password entries on your own device.

## How to use

1. Run `npm install`
2. Run `npm run build`
3. Open [index.html](./index.html) directly in your browser

No local server is required after the build finishes.

## Features

- Local-only storage with `localStorage`
- Entry fields for title, username, password, notes, and custom sections
- Password masking with per-entry eye toggle
- Excel import and export

## Files

- `index.html` - open this file directly
- `styles.css` - app styling
- `app.js` - generated from `src/app.ts`
- `vendor/xlsx.full.min.js` - local Excel library copied during build
