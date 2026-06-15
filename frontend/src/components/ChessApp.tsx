"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { Chess, Square } from "chess.js";
import { io, Socket } from "socket.io-client";
import { apiRequest, AuthResponse, ChatMessage, GameState, MoveRecord, Room, SOCKET_URL, User } from "@/lib/api";

type AuthMode = "login" | "signup";

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
  const [statusMessage, setStatusMessage] = useState("Create or join a room to start playing.");
  const [error, setError] = useState("");

  const room = gameState?.room ?? null;
  const game = room?.game ?? null;
  const chess = useMemo(() => new Chess(game?.fen), [game?.fen]);
  const playerColor = gameState?.player.color;
  const inviteUrl = room ? `${window.location.origin}?room=${room.code}` : "";

  useEffect(() => {
    const storedToken = window.localStorage.getItem("chess_token");
    const storedUser = window.localStorage.getItem("chess_user");
    const inviteCode = new URLSearchParams(window.location.search).get("room");

    if (storedToken && storedUser) {
      setToken(storedToken);
      setUser(JSON.parse(storedUser) as User);
    }

    if (inviteCode) {
      setRoomCode(inviteCode.toUpperCase());
    }

    void loadLeaderboard();
  }, []);

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
      <section className="topbar">
        <div>
          <h1>Realtime Chess</h1>
          <p>{statusMessage}</p>
        </div>
        {user ? (
          <div className="account">
            <span>{user.username}</span>
            <button type="button" onClick={logout}>Sign out</button>
          </div>
        ) : null}
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
            <h2>Room</h2>
            <button type="button" className="primary" onClick={createRoom}>Create room</button>
            <div className="join-row">
              <input value={roomCode} onChange={(event) => setRoomCode(event.target.value.toUpperCase())} placeholder="Invite code" />
              <button type="button" onClick={() => joinRoom()}>Join</button>
            </div>
            {room ? (
              <div className="room-card">
                <span className="label">Code</span>
                <strong>{room.code}</strong>
                <span className="label">Players</span>
                <p>{room.host.username} vs {room.guest?.username ?? "Waiting..."}</p>
                <span className="label">Invite</span>
                <input readOnly value={inviteUrl} onFocus={(event) => event.currentTarget.select()} />
                <button type="button" disabled={game?.status !== "IN_PROGRESS"} onClick={resign}>Resign</button>
              </div>
            ) : null}
          </section>

          <section className="board-panel">
            <GameStatus state={gameState} />
            <ChessBoard
              chess={chess}
              selectedSquare={selectedSquare}
              playerColor={playerColor ?? "white"}
              legalTargets={selectedSquare ? legalMovesFor(selectedSquare).map((move) => move.to) : []}
              onSquareClick={handleSquareClick}
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
            <Leaderboard users={leaderboard} />
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
    <section className="auth-panel">
      <div className="tabs">
        <button type="button" className={props.authMode === "login" ? "active" : ""} onClick={() => props.setAuthMode("login")}>Login</button>
        <button type="button" className={props.authMode === "signup" ? "active" : ""} onClick={() => props.setAuthMode("signup")}>Sign up</button>
      </div>
      <form onSubmit={props.onSubmit}>
        <label>
          Email
          <input type="email" value={props.email} onChange={(event) => props.setEmail(event.target.value)} required />
        </label>
        {props.authMode === "signup" ? (
          <label>
            Username
            <input value={props.username} onChange={(event) => props.setUsername(event.target.value)} minLength={3} required />
          </label>
        ) : null}
        <label>
          Password
          <input type="password" value={props.password} onChange={(event) => props.setPassword(event.target.value)} minLength={8} required />
        </label>
        <button type="submit" className="primary">{props.authMode === "login" ? "Login" : "Create account"}</button>
      </form>
    </section>
  );
}

function GameStatus({ state }: { state: GameState | null }) {
  if (!state?.room.game) {
    return <div className="game-status">No active room</div>;
  }

  const game = state.room.game;
  const turn = new Chess(game.fen).turn() === "w" ? "White" : "Black";
  const text = game.status === "IN_PROGRESS" ? `${turn} to move. You are ${state.player.color}.` : `Game finished: ${game.status.replace("_", " ").toLowerCase()}`;
  return <div className="game-status">{text}{game.resultReason ? ` (${game.resultReason})` : ""}</div>;
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
    <section>
      <h2>Moves</h2>
      <ol className="moves">
        {moves.map((move) => (
          <li key={move.id}>{move.ply}. {move.san}</li>
        ))}
      </ol>
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
      <h2>Chat</h2>
      <div className="chat-messages" aria-live="polite">
        {messages.length ? (
          messages.map((message) => {
            const isMine = message.sender.id === currentUserId;

            return (
              <div key={message.id} className={`chat-message ${isMine ? "mine" : ""}`}>
                <span>{isMine ? "You" : message.sender.username}</span>
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
    <section>
      <h2>Leaderboard</h2>
      <div className="leaderboard">
        {users.map((entry, index) => (
          <div key={entry.id} className="leader-row">
            <span>{index + 1}. {entry.username}</span>
            <strong>{entry.rating}</strong>
          </div>
        ))}
      </div>
    </section>
  );
}
