import { useEffect, useMemo, useState } from "react";
import { io } from "socket.io-client";
import {
  Activity,
  Crown,
  Edit3,
  Grid3X3,
  Radio,
  Sparkles,
  Users
} from "lucide-react";

const SERVER_URL = import.meta.env.VITE_SERVER_URL || "http://localhost:3001";

function getStoredName() {
  return localStorage.getItem("shared-grid-name") || "";
}

function timeAgo(timestamp) {
  if (!timestamp) return "just now";
  const seconds = Math.max(1, Math.floor((Date.now() - timestamp) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ago`;
}

export default function App() {
  const [socket, setSocket] = useState(null);
  const [connected, setConnected] = useState(false);
  const [player, setPlayer] = useState(null);
  const [nameInput, setNameInput] = useState(getStoredName);
  const [board, setBoard] = useState([]);
  const [boardConfig, setBoardConfig] = useState({ columns: 28, rows: 18 });
  const [onlineCount, setOnlineCount] = useState(0);
  const [leaderboard, setLeaderboard] = useState([]);
  const [stats, setStats] = useState({ total: 0, claimed: 0, unclaimed: 0, claimedPercent: 0 });
  const [events, setEvents] = useState([]);
  const [selectedCell, setSelectedCell] = useState(null);
  const [toast, setToast] = useState("");
  const [pendingCell, setPendingCell] = useState(null);

  useEffect(() => {
    const nextSocket = io(SERVER_URL, {
      auth: { name: getStoredName() }
    });

    nextSocket.on("connect", () => setConnected(true));
    nextSocket.on("disconnect", () => setConnected(false));

    nextSocket.on("init", (payload) => {
      setPlayer(payload.player);
      setBoard(payload.board);
      setBoardConfig(payload.boardConfig);
      setOnlineCount(payload.onlineCount);
      setLeaderboard(payload.leaderboard);
      setStats(payload.stats);
      setEvents(payload.events);
      if (!getStoredName()) {
        setNameInput(payload.player.name);
        localStorage.setItem("shared-grid-name", payload.player.name);
      }
    });

    nextSocket.on("playerUpdated", (updatedPlayer) => {
      setPlayer(updatedPlayer);
      setNameInput(updatedPlayer.name);
      localStorage.setItem("shared-grid-name", updatedPlayer.name);
    });

    nextSocket.on("cellClaimed", ({ cell }) => {
      setBoard((current) => current.map((item) => (item.id === cell.id ? cell : item)));
      setSelectedCell(cell);
    });

    nextSocket.on("playersUpdated", (payload) => {
      setOnlineCount(payload.onlineCount);
      setLeaderboard(payload.leaderboard);
      setStats(payload.stats);
    });

    nextSocket.on("activity", (event) => {
      setEvents((current) => [event, ...current].slice(0, 12));
    });

    setSocket(nextSocket);

    return () => {
      nextSocket.disconnect();
    };
  }, []);

  useEffect(() => {
    if (!toast) return undefined;
    const timeout = window.setTimeout(() => setToast(""), 2600);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  const ownedByMe = useMemo(
    () => board.filter((cell) => cell.ownerId === player?.id).length,
    [board, player]
  );

  const topPlayer = leaderboard[0];

  function claimCell(cell) {
    if (!socket || !connected || pendingCell !== null) return;

    setSelectedCell(cell);

    if (cell.ownerId) {
      setToast(
        cell.ownerId === player?.id
          ? "You already control this block."
          : `${cell.ownerName} already controls this block.`
      );
      return;
    }

    setPendingCell(cell.id);
    socket.emit("claimCell", cell.id, (response) => {
      setPendingCell(null);
      if (!response?.ok) {
        setToast(response?.reason || "Could not claim that block.");
      } else {
        setToast("Block captured.");
      }
    });
  }

  function saveName(event) {
    event.preventDefault();
    const cleanName = nameInput.trim();
    if (!socket || !cleanName) return;

    socket.emit("rename", cleanName, (response) => {
      if (!response?.ok) {
        setToast(response?.reason || "Could not update name.");
        return;
      }
      localStorage.setItem("shared-grid-name", cleanName);
      setPlayer(response.player);
      setToast("Name updated.");
    });
  }

  return (
    <main className="app-shell">
      <section className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">
              <Radio size={15} />
              {connected ? "Live board online" : "Connecting to realtime server"}
            </p>
            <h1>Shared Grid Capture</h1>
          </div>
          <div className="connection-pill" data-connected={connected}>
            <span />
            {connected ? "Connected" : "Offline"}
          </div>
        </header>

        <div className="stats-strip">
          <Metric icon={<Grid3X3 />} label="Blocks" value={`${stats.claimed}/${stats.total || board.length}`} />
          <Metric icon={<Sparkles />} label="Your captures" value={ownedByMe} accent={player?.color} />
          <Metric icon={<Users />} label="Online" value={onlineCount} />
          <Metric icon={<Crown />} label="Leader" value={topPlayer?.name || "No leader"} accent={topPlayer?.color} />
        </div>

        <section className="board-panel" aria-label="Shared capture grid">
          <div
            className="grid-board"
            style={{
              "--columns": boardConfig.columns
            }}
          >
            {board.map((cell) => (
              <button
                className="grid-cell"
                data-owned={Boolean(cell.ownerId)}
                data-mine={cell.ownerId === player?.id}
                data-selected={selectedCell?.id === cell.id}
                disabled={pendingCell !== null && pendingCell !== cell.id}
                key={cell.id}
                onClick={() => claimCell(cell)}
                style={{
                  "--owner-color": cell.ownerColor || "#f7fafc"
                }}
                title={
                  cell.ownerName
                    ? `Block ${cell.id + 1} owned by ${cell.ownerName}`
                    : `Claim block ${cell.id + 1}`
                }
              >
                <span>{pendingCell === cell.id ? "" : cell.id + 1}</span>
              </button>
            ))}
          </div>
        </section>
      </section>

      <aside className="side-panel">
        <section className="profile-card">
          <div className="avatar" style={{ background: player?.color }}>
            {player?.name?.slice(0, 1) || "?"}
          </div>
          <form onSubmit={saveName}>
            <label htmlFor="name">Player name</label>
            <div className="name-row">
              <input
                id="name"
                maxLength={18}
                onChange={(event) => setNameInput(event.target.value)}
                value={nameInput}
              />
              <button aria-label="Save player name" type="submit">
                <Edit3 size={17} />
              </button>
            </div>
          </form>
        </section>

        <section className="panel-section">
          <div className="section-title">
            <Crown size={18} />
            Leaderboard
          </div>
          <div className="leaderboard">
            {leaderboard.length === 0 ? (
              <p className="empty">No captures yet.</p>
            ) : (
              leaderboard.map((entry, index) => (
                <div className="leader-row" key={entry.id}>
                  <span className="rank">{index + 1}</span>
                  <span className="swatch" style={{ background: entry.color }} />
                  <span className="leader-name">{entry.name}</span>
                  <strong>{entry.score}</strong>
                </div>
              ))
            )}
          </div>
        </section>

        <section className="panel-section selected-card">
          <div className="section-title">
            <Grid3X3 size={18} />
            Selected Block
          </div>
          {selectedCell ? (
            <div className="selected-details">
              <strong>#{selectedCell.id + 1}</strong>
              <span>
                {selectedCell.ownerName
                  ? `Owned by ${selectedCell.ownerName}`
                  : "Unclaimed and ready"}
              </span>
            </div>
          ) : (
            <p className="empty">Pick a block to inspect it.</p>
          )}
        </section>

        <section className="panel-section">
          <div className="section-title">
            <Activity size={18} />
            Activity
          </div>
          <div className="activity-feed">
            {events.length === 0 ? (
              <p className="empty">The board is quiet.</p>
            ) : (
              events.map((event) => (
                <div className="event-row" key={event.id}>
                  <span style={{ background: event.color }} />
                  <p>{event.message}</p>
                  <small>{timeAgo(event.at)}</small>
                </div>
              ))
            )}
          </div>
        </section>
      </aside>

      {toast && <div className="toast">{toast}</div>}
    </main>
  );
}

function Metric({ icon, label, value, accent }) {
  return (
    <div className="metric">
      <div className="metric-icon" style={{ color: accent }}>
        {icon}
      </div>
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
      </div>
    </div>
  );
}
