# Crous Automation

React + Node automation for watching Crous housing search URLs and sending alerts by WhatsApp and email.

The old Discord bot logic has been kept as the source behavior:

- poll a Crous search URL every minute;
- scrape housing cards from `trouverunlogement.lescrous.fr`;
- compare current listings with the last seen snapshot;
- notify only when new listings appear.

## Local Setup

```bash
npm run install:all
npm run dev
```

Local URLs:

- Frontend: http://localhost:5173
- Backend: http://localhost:4100/api
- Health: http://localhost:4100/api/health

## Environment

Use one root `.env` file. Copy `.env.example` and fill the SMTP values.

```bash
cp .env.example .env
```

The app stores watches, logs, settings, and WhatsApp auth under `data/`.

## Features

- Crous watch management from the UI
- WhatsApp device connection by phone number + QR code
- SMTP email notifications
- Manual WhatsApp/email message composer
- Live logs
- Deploy helper script for `automation.al-shifae.ma`

## Deploy

Set up the project at `/var/www/automation.al-shifae.ma`, configure `.env`, then run:

```bash
npm run deploy
```

The deploy script builds the frontend and starts/restarts the backend with PM2. It also prints the Nginx reverse proxy block for `automation.al-shifae.ma`.
