"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { Chess, Square } from "chess.js";
import { io, Socket } from "socket.io-client";
import { apiRequest, AuthResponse, ChatMessage, GameState, MoveRecord, Room, SOCKET_URL, User } from "@/lib/api";

type AuthMode = "login" | "signup";
type ThemeMode = "light" | "dark";

const files = ["a", "b", "c", "d", "e", "f", "g", "h"];
const pieceGlyphs: Record<string, string> = {
  wp: "♙",
  wn: "♘",
  wb: "♗",
  wr: "♖",
  wq: "♕",
  wk: "♔",
  bp: "♟",
  bn: "♞",
  bb: "♝",
  br: "♜",
  bq: "♛",
  bk: "♚"
};

function formatChatTime(sentAt: string) {
  const sentDate = new Date(sentAt);

  if (Number.isNaN(sentDate.getTime())) {
    return "";
  }

  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit"
  }).format(sentDate);
}

export function ChessApp() {
  const socketRef = useRef<Socket | null>(null);
  const [authMode, setAuthMode] = useState<AuthMode>("login");
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [roomCode, setRoomCode] = useState("");
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [leaderboard, setLeaderboard] = useState<User[]>([]);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatDraft, setChatDraft] = useState("");
  const [selectedSquare, setSelectedSquare] = useState<Square | null>(null);
  const [theme, setTheme] = useState<ThemeMode>("light");
  const [statusMessage, setStatusMessage] = useState("Create or join a room to start playing.");
  const [error, setError] = useState("");
  const [origin, setOrigin] = useState("");

  const room = gameState?.room ?? null;
  const game = room?.game ?? null;
  const chess = useMemo(() => new Chess(game?.fen), [game?.fen]);
  const playerColor = gameState?.player.color;
  const opponent = user && room ? (room.hostId === user.id ? room.guest : room.host) : null;
  const inviteUrl = room && origin ? `${origin}?room=${room.code}` : "";

  useEffect(() => {
    const storedToken = window.localStorage.getItem("chess_token");
    const storedUser = window.localStorage.getItem("chess_user");
    const storedTheme = window.localStorage.getItem("chess_theme") as ThemeMode | null;
    const inviteCode = new URLSearchParams(window.location.search).get("room");

    setOrigin(window.location.origin);

    if (storedToken && storedUser) {
      setToken(storedToken);
      setUser(JSON.parse(storedUser) as User);
    }

    if (storedTheme === "light" || storedTheme === "dark") {
      setTheme(storedTheme);
    } else if (window.matchMedia("(prefers-color-scheme: dark)").matches) {
      setTheme("dark");
    }

    if (inviteCode) {
      setRoomCode(inviteCode.toUpperCase());
    }

    void loadLeaderboard();
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    window.localStorage.setItem("chess_theme", theme);
  }, [theme]);

  useEffect(() => {
    return () => {
      socketRef.current?.disconnect();
    };
  }, []);

  async function loadLeaderboard() {
    const data = await apiRequest<User[]>("/leaderboard").catch(() => []);
    setLeaderboard(data);
  }

  async function handleAuth(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");

    try {
      const path = authMode === "login" ? "/auth/login" : "/auth/signup";
      const body = authMode === "login" ? { email, password } : { email, username, password };
      const response = await apiRequest<AuthResponse>(path, {
        method: "POST",
        body: JSON.stringify(body)
      });

      setToken(response.accessToken);
      setUser(response.user);
      window.localStorage.setItem("chess_token", response.accessToken);
      window.localStorage.setItem("chess_user", JSON.stringify(response.user));
      setStatusMessage("You are signed in. Create a room or join with an invite code.");
    } catch (authError) {
      setError(authError instanceof Error ? authError.message : "Could not sign in");
    }
  }

  async function createRoom() {
    if (!token) return;
    setError("");

    try {
      const createdRoom = await apiRequest<Room>("/rooms", { method: "POST" }, token);
      connectToRoom(createdRoom.code);
      setStatusMessage("Room created. Share the invite code with your opponent.");
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Could not create room");
    }
  }

  async function joinRoom(code = roomCode) {
    if (!token || !code.trim()) return;
    setError("");

    try {
      const joinedRoom = await apiRequest<Room>(`/rooms/join/${code.trim().toUpperCase()}`, { method: "POST" }, token);
      connectToRoom(joinedRoom.code);
      setStatusMessage("Joined room. The game will update in realtime.");
    } catch (joinError) {
      setError(joinError instanceof Error ? joinError.message : "Could not join room");
    }
  }

  function connectToRoom(code: string) {
    if (!token) return;

    socketRef.current?.disconnect();
    setChatMessages([]);
    const socket = io(`${SOCKET_URL}/games`, {
      auth: { token }
    });

    socket.on("connect", () => {
      socket.emit("room:join", { code });
    });

    socket.on("game:state", (state: GameState) => {
      setGameState(state);
      setSelectedSquare(null);
      setRoomCode(state.room.code);
      void loadLeaderboard();
    });

    socket.on("game:error", (payload: { message: string }) => {
      setError(payload.message);
    });

    socket.on("chat:message", (message: ChatMessage) => {
      setChatMessages((currentMessages) => [...currentMessages, message].slice(-100));
    });

    socketRef.current = socket;
  }

  function logout() {
    socketRef.current?.disconnect();
    window.localStorage.removeItem("chess_token");
    window.localStorage.removeItem("chess_user");
    setToken(null);
    setUser(null);
    setGameState(null);
    setChatMessages([]);
    setChatDraft("");
    setStatusMessage("Signed out.");
  }

  function toggleTheme() {
    setTheme((currentTheme) => (currentTheme === "light" ? "dark" : "light"));
  }

  function handleSquareClick(square: Square) {
    if (!game || !room || room.status !== "ACTIVE" || game.status !== "IN_PROGRESS") return;

    if (selectedSquare && selectedSquare !== square) {
      const legalTargets = legalMovesFor(selectedSquare).map((move) => move.to);
      if (legalTargets.includes(square)) {
        socketRef.current?.emit("move:make", {
          code: room.code,
          from: selectedSquare,
          to: square,
          promotion: "q"
        });
        return;
      }
    }

    const piece = chess.get(square);
    const ownPiece = piece && ((piece.color === "w" && playerColor === "white") || (piece.color === "b" && playerColor === "black"));
    const isYourTurn = (chess.turn() === "w" && playerColor === "white") || (chess.turn() === "b" && playerColor === "black");
    setSelectedSquare(ownPiece && isYourTurn ? square : null);
  }

  function legalMovesFor(square: Square) {
    return chess.moves({ square, verbose: true });
  }

  function resign() {
    if (room) {
      socketRef.current?.emit("game:resign", { code: room.code });
    }
  }

  function sendChatMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!room || !chatDraft.trim()) return;

    socketRef.current?.emit("chat:send", {
      code: room.code,
      message: chatDraft
    });
    setChatDraft("");
  }

  return (
    <main className="shell">
      <section className="topbar" aria-label="Application header">
        <div className="brand-block">
          <div className="brand-mark" aria-hidden="true">♞</div>
          <div>
            <p className="eyebrow">Live match room</p>
            <h1>Realtime Chess</h1>
          </div>
        </div>
        <p className="status-pill">{statusMessage}</p>
        <div className="topbar-actions">
          <button
            type="button"
            className="theme-toggle"
            onClick={toggleTheme}
            aria-pressed={theme === "dark"}
            aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
          >
            {theme === "dark" ? "Light theme" : "Dark theme"}
          </button>
          {user ? (
            <div className="account">
              <span className="avatar" aria-hidden="true">{user.username.slice(0, 1).toUpperCase()}</span>
              <span>{user.username}</span>
              <button type="button" onClick={logout}>Sign out</button>
            </div>
          ) : null}
        </div>
      </section>

      {error ? <div className="alert">{error}</div> : null}

      {!user || !token ? (
        <AuthPanel
          authMode={authMode}
          email={email}
          username={username}
          password={password}
          setAuthMode={setAuthMode}
          setEmail={setEmail}
          setUsername={setUsername}
          setPassword={setPassword}
          onSubmit={handleAuth}
        />
      ) : (
        <div className="app-grid">
          <section className="controls-panel">
            <div className="panel-heading">
              <p className="eyebrow">Command</p>
              <h2>Play Control</h2>
            </div>

            <div className="profile-card">
              <span className="avatar large" aria-hidden="true">{user.username.slice(0, 1).toUpperCase()}</span>
              <div>
                <strong>{user.username}</strong>
                <span>{user.rating} rating</span>
              </div>
            </div>

            <div className="record-grid" aria-label="Player record">
              <Stat label="Wins" value={user.wins} />
              <Stat label="Draws" value={user.draws} />
              <Stat label="Losses" value={user.losses} />
            </div>

            <div className="room-actions">
              <button type="button" className="primary" onClick={createRoom}>Create room</button>
              <div className="join-row">
                <input value={roomCode} onChange={(event) => setRoomCode(event.target.value.toUpperCase())} placeholder="Invite code" />
                <button type="button" onClick={() => joinRoom()}>Join</button>
              </div>
            </div>

            {room ? (
              <div className="room-card">
                <div className="room-code">
                  <span className="label">Room code</span>
                  <strong>{room.code}</strong>
                </div>
                <div className="room-meta">
                  <span className="label">Players</span>
                  <p>{room.host.username} vs {room.guest?.username ?? "Waiting for opponent"}</p>
                </div>
                <label>
                  <span className="label">Invite link</span>
                  <input readOnly value={inviteUrl} onFocus={(event) => event.currentTarget.select()} />
                </label>
                <button type="button" className="danger-button" disabled={game?.status !== "IN_PROGRESS"} onClick={resign}>Resign game</button>
              </div>
            ) : null}

            <Leaderboard users={leaderboard} />
          </section>

          <section className="board-panel">
            <div className="board-header">
              <GameStatus state={gameState} />
              <span className="turn-badge">{playerColor ? `You play ${playerColor}` : "Spectator setup"}</span>
            </div>
            <PlayerStrip
              label="Opponent"
              name={opponent?.username ?? "Waiting for opponent"}
              rating={opponent?.rating}
              muted={!opponent}
            />
            <div className="board-frame">
              <ChessBoard
                chess={chess}
                selectedSquare={selectedSquare}
                playerColor={playerColor ?? "white"}
                legalTargets={selectedSquare ? legalMovesFor(selectedSquare).map((move) => move.to) : []}
                onSquareClick={handleSquareClick}
              />
            </div>
            <PlayerStrip
              label="You"
              name={user.username}
              rating={user.rating}
              color={playerColor}
            />
          </section>

          <aside className="side-panel">
            <ChatPanel
              currentUserId={user.id}
              messages={chatMessages}
              value={chatDraft}
              disabled={!room}
              onChange={setChatDraft}
              onSubmit={sendChatMessage}
            />
            <MoveList moves={game?.moves ?? []} />
          </aside>
        </div>
      )}
    </main>
  );
}

interface AuthPanelProps {
  authMode: AuthMode;
  email: string;
  username: string;
  password: string;
  setAuthMode: (mode: AuthMode) => void;
  setEmail: (value: string) => void;
  setUsername: (value: string) => void;
  setPassword: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}

function AuthPanel(props: AuthPanelProps) {
  return (
    <section className="auth-layout">
      <div className="auth-copy">
        <p className="eyebrow">Play together</p>
        <h2>Sign in, create a room, and start a live board.</h2>
        <div className="auth-highlights">
          <span>Private invite rooms</span>
          <span>Realtime moves</span>
          <span>Chat and ratings</span>
        </div>
      </div>

      <div className="auth-panel">
        <div className="tabs" role="tablist" aria-label="Authentication mode">
          <button type="button" className={props.authMode === "login" ? "active" : ""} onClick={() => props.setAuthMode("login")}>Login</button>
          <button type="button" className={props.authMode === "signup" ? "active" : ""} onClick={() => props.setAuthMode("signup")}>Sign up</button>
        </div>
        <form onSubmit={props.onSubmit}>
          <label>
            <span>Email</span>
            <input type="email" value={props.email} onChange={(event) => props.setEmail(event.target.value)} required />
          </label>
          {props.authMode === "signup" ? (
            <label>
              <span>Username</span>
              <input value={props.username} onChange={(event) => props.setUsername(event.target.value)} minLength={3} required />
            </label>
          ) : null}
          <label>
            <span>Password</span>
            <input type="password" value={props.password} onChange={(event) => props.setPassword(event.target.value)} minLength={8} required />
          </label>
          <button type="submit" className="primary">{props.authMode === "login" ? "Login" : "Create account"}</button>
        </form>
      </div>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="stat">
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

function GameStatus({ state }: { state: GameState | null }) {
  if (!state?.room.game) {
    return (
      <div className="game-status">
        <span>No active room</span>
        <strong>Ready</strong>
      </div>
    );
  }

  const game = state.room.game;
  const turn = new Chess(game.fen).turn() === "w" ? "White" : "Black";
  const statusText = game.status === "IN_PROGRESS" ? `${turn} to move` : game.status.replace("_", " ").toLowerCase();

  return (
    <div className="game-status">
      <span>{game.status === "IN_PROGRESS" ? "Game in progress" : "Game finished"}</span>
      <strong>{statusText}{game.resultReason ? ` (${game.resultReason})` : ""}</strong>
    </div>
  );
}

function PlayerStrip({
  label,
  name,
  rating,
  color,
  muted = false
}: {
  label: string;
  name: string;
  rating?: number;
  color?: "white" | "black";
  muted?: boolean;
}) {
  return (
    <div className={`player-strip ${muted ? "muted" : ""}`}>
      <div>
        <span>{label}</span>
        <strong>{name}</strong>
      </div>
      <div className="player-meta">
        {color ? <span>{color}</span> : null}
        {rating ? <span>{rating}</span> : null}
      </div>
    </div>
  );
}

interface ChessBoardProps {
  chess: Chess;
  selectedSquare: Square | null;
  playerColor: "white" | "black";
  legalTargets: string[];
  onSquareClick: (square: Square) => void;
}

function ChessBoard({ chess, selectedSquare, playerColor, legalTargets, onSquareClick }: ChessBoardProps) {
  const ranks = playerColor === "white" ? [8, 7, 6, 5, 4, 3, 2, 1] : [1, 2, 3, 4, 5, 6, 7, 8];
  const boardFiles = playerColor === "white" ? files : [...files].reverse();

  return (
    <div className="board" aria-label="Chess board">
      {ranks.flatMap((rank) =>
        boardFiles.map((file) => {
          const square = `${file}${rank}` as Square;
          const piece = chess.get(square);
          const isLight = (files.indexOf(file) + rank) % 2 === 1;
          const isSelected = selectedSquare === square;
          const isTarget = legalTargets.includes(square);

          return (
            <button
              type="button"
              key={square}
              className={`square ${isLight ? "light" : "dark"} ${isSelected ? "selected" : ""} ${isTarget ? "target" : ""}`}
              onClick={() => onSquareClick(square)}
              aria-label={square}
            >
              <span>{piece ? pieceGlyphs[`${piece.color}${piece.type}`] : ""}</span>
            </button>
          );
        })
      )}
    </div>
  );
}

function MoveList({ moves }: { moves: MoveRecord[] }) {
  return (
    <section className="moves-panel">
      <div className="panel-heading compact">
        <p className="eyebrow">Notation</p>
        <h2>Moves</h2>
      </div>
      <ol className="moves">
        {moves.map((move) => (
          <li key={move.id}>{move.ply}. {move.san}</li>
        ))}
      </ol>
      {!moves.length ? <p className="empty-note">Moves will appear after the first turn.</p> : null}
    </section>
  );
}

interface ChatPanelProps {
  currentUserId: string;
  messages: ChatMessage[];
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}

function ChatPanel({ currentUserId, messages, value, disabled, onChange, onSubmit }: ChatPanelProps) {
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ block: "end" });
  }, [messages]);

  return (
    <section className="chat-panel">
      <div className="chat-header">
        <div className="panel-heading compact">
          <p className="eyebrow">Room</p>
          <h2>Chat</h2>
        </div>
        <span>{messages.length ? `${messages.length} message${messages.length === 1 ? "" : "s"}` : "Ready"}</span>
      </div>
      <div className="chat-messages" aria-live="polite">
        {messages.length ? (
          messages.map((message) => {
            const isMine = message.sender.id === currentUserId;
            const sentTime = formatChatTime(message.sentAt);

            return (
              <div key={message.id} className={`chat-message ${isMine ? "mine" : ""}`}>
                <div className="chat-meta">
                  <span>{isMine ? "You" : message.sender.username}</span>
                  {sentTime ? <time dateTime={message.sentAt}>{sentTime}</time> : null}
                </div>
                <p>{message.message}</p>
              </div>
            );
          })
        ) : (
          <p className="chat-empty">No messages yet.</p>
        )}
        <div ref={messagesEndRef} />
      </div>
      <form className="chat-form" onSubmit={onSubmit}>
        <input
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={disabled ? "Join a room to chat" : "Message opponent"}
          maxLength={500}
          disabled={disabled}
        />
        <button type="submit" disabled={disabled || !value.trim()}>Send</button>
      </form>
    </section>
  );
}

function Leaderboard({ users }: { users: User[] }) {
  return (
    <section className="leaderboard-panel">
      <div className="panel-heading compact">
        <p className="eyebrow">Rankings</p>
        <h2>Leaderboard</h2>
      </div>
      <div className="leaderboard">
        {users.map((entry, index) => (
          <div key={entry.id} className="leader-row">
            <span><b>{index + 1}</b> {entry.username}</span>
            <strong>{entry.rating}</strong>
          </div>
        ))}
      </div>
      {!users.length ? <p className="empty-note">No ranked players yet.</p> : null}
    </section>
  );
}
