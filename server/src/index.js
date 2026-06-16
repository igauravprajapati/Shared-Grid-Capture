import express from "express";
import cors from "cors";
import { createServer } from "http";
import { Server } from "socket.io";

const PORT = process.env.PORT || 3001;
const CLIENT_ORIGINS = (
  process.env.CLIENT_ORIGIN || "https://shared-grid-capture.vercel.app"
)
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
const BOARD_COLUMNS = 28;
const BOARD_ROWS = 18;
const TOTAL_CELLS = BOARD_COLUMNS * BOARD_ROWS;
const CLAIM_COOLDOWN_MS = 900;

const names = [
  "Nova",
  "Pixel",
  "Orbit",
  "Echo",
  "Maple",
  "Comet",
  "Flux",
  "Indigo",
  "Sol",
  "Mica",
  "Vivid",
  "Tempo",
];

const palette = [
  "#ef476f",
  "#f78c6b",
  "#ffd166",
  "#06d6a0",
  "#2ec4b6",
  "#118ab2",
  "#6c63ff",
  "#9b5de5",
  "#f15bb5",
  "#00bbf9",
];

const app = express();
app.use(cors({ origin: CLIENT_ORIGINS }));
app.use(express.json());

const server = createServer(app);
const io = new Server(server, {
  cors: {
    origin: CLIENT_ORIGINS,
    methods: ["GET", "POST"],
  },
});

const board = Array.from({ length: TOTAL_CELLS }, (_, id) => ({
  id,
  ownerId: null,
  ownerName: null,
  ownerColor: null,
  claimedAt: null,
}));

const players = new Map();
const recentEvents = [];

function pick(list) {
  return list[Math.floor(Math.random() * list.length)];
}

function createPlayer(socketId, providedName, providedClientId, providedColor) {
  const readableName = String(providedName || "")
    .trim()
    .slice(0, 18);
  const stableId = String(providedClientId || "")
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, "")
    .slice(0, 48);
  const playerId = stableId || socketId;
  const stableColor = palette.includes(providedColor)
    ? providedColor
    : pick(palette);

  return {
    id: playerId,
    socketId,
    name: readableName || `${pick(names)}-${socketId.slice(0, 4)}`,
    color: stableColor,
    score: board.filter((cell) => cell.ownerId === playerId).length,
    connectedAt: Date.now(),
    lastClaimAt: 0,
  };
}

function leaderboard() {
  return [...players.values()]
    .map((player) => ({
      id: player.id,
      name: player.name,
      color: player.color,
      score: player.score,
    }))
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
    .slice(0, 10);
}

function boardStats() {
  const claimed = board.filter((cell) => cell.ownerId).length;
  return {
    total: TOTAL_CELLS,
    claimed,
    unclaimed: TOTAL_CELLS - claimed,
    claimedPercent: Math.round((claimed / TOTAL_CELLS) * 100),
  };
}

function pushEvent(event) {
  recentEvents.unshift(event);
  recentEvents.splice(12);
}

function broadcastSnapshot() {
  io.emit("playersUpdated", {
    onlineCount: players.size,
    leaderboard: leaderboard(),
    stats: boardStats(),
  });
}

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    cells: TOTAL_CELLS,
    online: players.size,
    claimed: boardStats().claimed,
  });
});

io.on("connection", (socket) => {
  const requestedName = socket.handshake.auth?.name;
  const requestedClientId = socket.handshake.auth?.clientId;
  const requestedColor = socket.handshake.auth?.color;
  const existingPlayer = players.get(requestedClientId);
  const player =
    existingPlayer ||
    createPlayer(socket.id, requestedName, requestedClientId, requestedColor);

  player.socketId = socket.id;
  player.score = board.filter((cell) => cell.ownerId === player.id).length;
  if (requestedName && !existingPlayer) {
    player.name = String(requestedName).trim().slice(0, 18);
  }

  players.set(player.id, player);

  socket.emit("init", {
    player,
    board,
    boardConfig: {
      columns: BOARD_COLUMNS,
      rows: BOARD_ROWS,
      total: TOTAL_CELLS,
    },
    onlineCount: players.size,
    leaderboard: leaderboard(),
    stats: boardStats(),
    events: recentEvents,
  });

  pushEvent({
    id: `${Date.now()}-${socket.id}`,
    type: "join",
    message: `${player.name} joined`,
    color: player.color,
    at: Date.now(),
  });

  broadcastSnapshot();
  socket.broadcast.emit("activity", recentEvents[0]);

  socket.on("rename", (name, ack) => {
    const nextName = String(name || "")
      .trim()
      .slice(0, 18);
    if (!nextName) {
      ack?.({ ok: false, reason: "Name cannot be empty." });
      return;
    }

    player.name = nextName;
    board.forEach((cell) => {
      if (cell.ownerId === player.id) {
        cell.ownerName = player.name;
        cell.ownerColor = player.color;
      }
    });

    ack?.({ ok: true, player });
    socket.emit("playerUpdated", player);
    io.emit("playerTerritoryUpdated", {
      playerId: player.id,
      name: player.name,
      color: player.color,
    });
    broadcastSnapshot();
  });

  socket.on("claimCell", (cellId, ack) => {
    const id = Number(cellId);
    const now = Date.now();

    if (!Number.isInteger(id) || id < 0 || id >= TOTAL_CELLS) {
      ack?.({ ok: false, reason: "That cell does not exist." });
      return;
    }

    if (now - player.lastClaimAt < CLAIM_COOLDOWN_MS) {
      ack?.({
        ok: false,
        reason: "Slow down for a moment.",
        retryAfterMs: CLAIM_COOLDOWN_MS - (now - player.lastClaimAt),
      });
      return;
    }

    const cell = board[id];
    if (cell.ownerId) {
      ack?.({
        ok: false,
        reason:
          cell.ownerId === player.id
            ? "You already own this block."
            : `${cell.ownerName} already owns this block.`,
        cell,
      });
      return;
    }

    player.lastClaimAt = now;
    player.score += 1;
    cell.ownerId = player.id;
    cell.ownerName = player.name;
    cell.ownerColor = player.color;
    cell.claimedAt = now;

    const event = {
      id: `${now}-${id}`,
      type: "claim",
      message: `${player.name} captured block ${id + 1}`,
      color: player.color,
      cellId: id,
      at: now,
    };

    pushEvent(event);

    io.emit("cellClaimed", { cell, playerId: player.id });
    io.emit("activity", event);
    broadcastSnapshot();
    ack?.({ ok: true, cell });
  });

  socket.on("disconnect", () => {
    const activePlayer = players.get(player.id);
    if (activePlayer?.socketId === socket.id) {
      players.delete(player.id);
    }
    pushEvent({
      id: `${Date.now()}-${socket.id}`,
      type: "leave",
      message: `${player.name} left`,
      color: player.color,
      at: Date.now(),
    });
    broadcastSnapshot();
    socket.broadcast.emit("activity", recentEvents[0]);
  });
});

server.listen(PORT, () => {
  console.log(`Realtime grid server running on http://localhost:${PORT}`);
});
