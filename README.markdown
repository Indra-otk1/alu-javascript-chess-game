# AI Chess Game

An API-powered chess game where the player controls White, a Groq model plays Black, and a Lichess-powered review panel explains the current position below the board.

## Project Purpose

This project is designed for the APIs assignment. It provides a meaningful use of external APIs by combining:

- a playable chess experience against an AI opponent
- lightweight position review for the player after each move
- secure server-side handling of API keys

The frontend board design from the original project is intentionally preserved.

## APIs Used

### Groq

- Purpose: generate the AI opponent move
- Access method: direct HTTP request from the Node server
- Docs: [Groq Docs](https://console.groq.com/docs/overview)

### Lichess

- Purpose: provide position review, suggested moves, and opening context
- Access method: direct HTTP request from the Node server
- Docs: [Lichess API](https://lichess.org/api)

## Tech Stack

- HTML
- CSS
- JavaScript
- Node.js
- Express
- `chess.js`

## Local Setup

### 1. Clone the repository

```bash
git clone https://github.com/Indra-otk1/alu-javascript-chess-game
cd alu-javascript-chess-game
```

### 2. Install dependencies

```bash
npm install
```

### 3. Create your environment file

Copy `.env.example` to `.env` and fill in your values:

```env
PORT=3002
GROQ_API_KEY=your_groq_key_here
GROQ_MODEL=llama-3.1-8b-instant
LICHESS_API_TOKEN=
```

Notes:

- `GROQ_API_KEY` is required for AI moves.
- `GROQ_MODEL` is optional and defaults to `llama-3.1-8b-instant`.
- `LICHESS_API_TOKEN` is optional for the current setup.

### 4. Start the app

```bash
npm start
```

Then open:

```text
http://localhost:3002
```

## How It Works

1. The player clicks a White piece and chooses a legal destination.
2. The browser sends the move to `POST /api/game/move`.
3. The server validates the move with `chess.js`.
4. If the game is still active, the browser requests `POST /api/game/ai-move`.
5. The server sends the current FEN and legal moves to Groq, validates the returned move, and applies it.
6. The browser requests `POST /api/game/explorer` to refresh the Lichess review panel.

## API Security

- API keys are never exposed in frontend JavaScript.
- Groq and Lichess requests are made by the Node server only.
- `.env` is ignored by Git through `.gitignore`.
- Only `.env.example` is committed.

## Available Routes

- `GET /`
  - serves the frontend
- `GET /api/health`
  - health check endpoint for deployment and load balancer checks
- `POST /api/game/move`
  - validates and applies the player move
- `POST /api/game/ai-move`
  - asks Groq for the AI move and validates it
- `POST /api/game/explorer`
  - fetches normalized position review data from Lichess

## Deployment Guide

Deployment is already configured:

- the app is running on `web-01` and `web02`
- `lb-01` forwards traffic to those two backend servers
- the domain `elvistanguy.tech` points to `lb-01`

The sections below describe the expected setup and verification steps for that deployment.

### On Web01 and Web02

1. SSH into the server.
2. Install Node.js if it is not already installed.
3. Clone the repository into a deployment directory.
4. Create a production `.env` file with the Groq key and optional Lichess token.
5. Install dependencies:

```bash
npm install --omit=dev
```

6. Start the app:

```bash
npm start
```

7. Verify locally on each server:

```bash
curl http://127.0.0.1:3000/api/health
```

Expected response:

```json
{"ok":true}
```

### Optional process management

For persistence after logout or reboot, run the app with a process manager such as `pm2` or a `systemd` service. Example `systemd` service fields should include:

- working directory pointing to the project folder
- `ExecStart=/usr/bin/node server.js`
- restart policy set to `always`
- environment variables loaded from the deployment environment

### On Lb01

Configure the load balancer to forward traffic to:

- `Web01:3000`
- `Web02:3000`

Recommended checks:

- use `GET /api/health` as the health check path
- confirm both backends return `{"ok":true}`
- verify requests are distributed across both servers

## Testing Checklist

- The app starts with `npm start`.
- Legal White moves work.
- Illegal moves are rejected.
- The AI responds with a valid move when `GROQ_API_KEY` is configured.
- If Groq is unavailable, the UI shows a readable error.
- The Lichess review panel updates after moves.
- If Lichess is unavailable, the panel falls back gracefully.
- `GET /api/health` returns `{"ok":true}`.

## Demo Video

https://youtu.be/XoDqwtaU4eI

## Challenges and Solutions

- The original project used a custom move engine with major correctness bugs.
  - Solution: replaced move validation with `chess.js`.
- API keys needed to stay private.
  - Solution: moved all external API calls to the Node backend.
- The assignment needed API value without redesigning the interface.
  - Solution: preserved the board design and added only a minimal review section below it.

## Credits

- Original project and board UI by Kanamugire Elvis
- Chess rules library: [chess.js](https://github.com/jhlywa/chess.js)
- AI provider: [Groq](https://console.groq.com/)
- Analysis provider: [Lichess](https://lichess.org/)
