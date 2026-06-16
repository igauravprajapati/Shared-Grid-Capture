# Real-Time Shared Grid

A full-stack assignment project: a clean, interactive shared board where many users can claim cells and see everyone else's moves instantly.

## Tech Choices

- **Frontend:** React + Vite for a fast, focused interactive UI.
- **Backend:** Node.js + Express for the API/server shell.
- **Realtime:** Socket.IO for WebSocket-based bidirectional updates and reconnection support.
- **State:** In-memory board state for a simple assignment-friendly setup. The server is the source of truth and resolves conflicts atomically.

## Features

- Hundreds of clickable cells on a shared board.
- Anonymous users get a generated name and color.
- Player identity, color, and selected block persist across browser refreshes.
- Claiming a cell broadcasts instantly to all connected clients.
- Conflict handling: already-owned cells cannot be overwritten.
- Cooldown to prevent spam clicking.
- Live player count, leaderboard, activity feed, and board stats.
- Smooth hover/claim animations and responsive layout.

## Run Locally

```bash
npm install
npm run install:all
npm run dev
```

Then open:

- Frontend: http://localhost:5173
- Backend health check: http://localhost:3001/health

You can also run each side separately:

```bash
npm run server
npm run client
```

## Deploy

### Important Hosting Note

Vercel is excellent for the React frontend, but this app uses Socket.IO WebSockets, so the backend should run on a persistent Node server. Use:

- **Frontend:** Vercel
- **Backend:** Render, Railway, Fly.io, or any VPS/Node host

### 1. Deploy Backend First

Deploy the `server` folder to a long-running Node host.

For Render:

1. Create a new **Web Service**.
2. Set the root directory to `server`.
3. Build command:

```bash
npm install
```

4. Start command:

```bash
npm start
```

5. Add environment variables:

```text
PORT=3001
CLIENT_ORIGIN=https://your-vercel-app.vercel.app
```

Render will also work with the included `server/render.yaml`.

After deployment, copy the backend URL, for example:

```text
https://shared-grid-server.onrender.com
```

### 2. Deploy Frontend To Vercel

Deploy the `client` folder to Vercel.

Vercel settings:

```text
Framework Preset: Vite
Root Directory: client
Build Command: npm run build
Output Directory: dist
```

Add this frontend environment variable in Vercel:

```text
VITE_SERVER_URL=https://your-backend-url.onrender.com
```

Then redeploy the frontend.

### 3. Update Backend CORS

Once Vercel gives you the final frontend URL, update the backend environment variable:

```text
CLIENT_ORIGIN=https://your-vercel-app.vercel.app
```

Redeploy or restart the backend after changing it.

You can allow multiple frontend URLs by separating them with commas:

```text
CLIENT_ORIGIN=http://localhost:5173,https://your-vercel-app.vercel.app
```

### Why Not Backend On Vercel?

Vercel serverless functions are not a good fit for Socket.IO because WebSocket connections need a persistent process. The backend in this project keeps live socket connections and in-memory board state, so it should run as a normal Node server.

## How Realtime Conflicts Are Handled

The backend owns the board state. When a user clicks a cell, the client sends `claimCell` with the cell id. The server checks:

1. Is the cell id valid?
2. Is the user past the click cooldown?
3. Is the cell still unclaimed?

Only then does the server assign ownership and broadcast `cellClaimed`. If two users click the same cell at the same time, Node handles one event first; the second request sees the cell is already owned and receives `claimRejected`.

## Project Structure

```text
client/
  src/
    App.jsx
    main.jsx
    styles.css
server/
  src/
    index.js
```

## Notes For Reviewers

This version intentionally keeps persistence in memory so the realtime architecture is easy to inspect. For production, the board state could move to Redis or Postgres, with Socket.IO's Redis adapter for multiple Node instances.
