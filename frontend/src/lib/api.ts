export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
export const SOCKET_URL = process.env.NEXT_PUBLIC_SOCKET_URL ?? "http://localhost:4000";

export interface User {
  id: string;
  email?: string;
  username: string;
  wins: number;
  losses: number;
  draws: number;
  rating: number;
}

export interface AuthResponse {
  user: User;
  accessToken: string;
}

export interface MoveRecord {
  id: string;
  from: string;
  to: string;
  san: string;
  fen: string;
  ply: number;
}

export interface Game {
  id: string;
  status: "IN_PROGRESS" | "WHITE_WON" | "BLACK_WON" | "DRAW" | "ABORTED";
  fen: string;
  resultReason?: string | null;
  moves: MoveRecord[];
  winner?: User | null;
}

export interface Room {
  id: string;
  code: string;
  status: "WAITING" | "ACTIVE" | "FINISHED";
  hostId: string;
  guestId?: string | null;
  host: User;
  guest?: User | null;
  game?: Game | null;
}

export interface GameState {
  room: Room;
  player: {
    id: string;
    color: "white" | "black";
  };
}

export async function apiRequest<T>(path: string, options: RequestInit = {}, token?: string): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers
    }
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    const message = typeof payload.message === "string" ? payload.message : "Request failed";
    throw new Error(message);
  }

  return response.json() as Promise<T>;
}
