# Htracker

A simple, self-hosted household expense tracker. Single login, color-coded calendar view, and a dashboard of totals — built to run on a small Ubuntu VPS behind nginx.

## Features

- Track recurring and one-off expenses: name, category, amount, payment type (direct debit / subscription / standing order / manual), and frequency (weekly / monthly / yearly / one-off).
- Full cost history per expense — record scheduled price increases ahead of time and see them reflected automatically once they take effect.
- Color-coded calendar showing every payment due each month.
- Dashboard with total monthly spend, breakdowns by category and payment type, upcoming payments (next 30 days), and upcoming cost increases.
- Single secure login (bcrypt-hashed password, server-side sessions persisted in SQLite).

## Stack

Node.js + Express + SQLite (via Node's built-in `node:sqlite` — no native build step required). Vanilla HTML/CSS/JS frontend, no build tooling.

## Local development

```
npm install
npm run init-db        # creates data/htracker.db
npm run create-admin    # interactive prompt to set your login (run in a real terminal)
cp .env.example .env     # then edit SESSION_SECRET
npm start
```

Visit `http://localhost:3000`.

## Production deployment

See `DEPLOY.md` for the full nginx + systemd setup for an Ubuntu server.
