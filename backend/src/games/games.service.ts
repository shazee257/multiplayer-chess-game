import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { Chess } from "chess.js";
import { GameStatus, Prisma, RoomStatus } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";

interface MoveInput {
  code: string;
  from: string;
  to: string;
  promotion?: string;
}

type TurnColor = "w" | "b";

const publicUserSelect = {
  id: true,
  email: true,
  username: true,
  wins: true,
  losses: true,
  draws: true,
  rating: true
} satisfies Prisma.UserSelect;

const gameRoomInclude = {
  host: { select: publicUserSelect },
  guest: { select: publicUserSelect },
  game: {
    include: {
      moves: {
        orderBy: { ply: "asc" }
      },
      whitePlayer: { select: publicUserSelect },
      blackPlayer: { select: publicUserSelect },
      winner: { select: publicUserSelect }
    }
  }
} satisfies Prisma.RoomInclude;

@Injectable()
export class GamesService {
  constructor(private readonly prisma: PrismaService) {}

  async getState(code: string, userId: string) {
    const room = await this.getPlayableRoom(code, userId);
    return this.toState(room, userId);
  }

  async makeMove(userId: string, input: MoveInput) {
    const room = await this.getPlayableRoom(input.code, userId);
    const game = room.game;

    if (!game) {
      throw new NotFoundException("Game not found");
    }

    if (game.status !== GameStatus.IN_PROGRESS) {
      throw new ConflictException("This game has already finished");
    }

    if (!game.blackPlayerId) {
      throw new BadRequestException("Waiting for a second player");
    }

    const chess = new Chess(game.fen);
    const movingColor = chess.turn() as TurnColor;
    this.ensureUsersTurn(movingColor, room.hostId, room.guestId, userId);

    const move = this.applyMove(chess, input);
    const outcome = this.resolveOutcome(chess, movingColor, room.hostId, room.guestId);
    const ply = game.moves.length + 1;

    await this.prisma.$transaction(async (tx) => {
      const updated = await tx.game.updateMany({
        where: {
          id: game.id,
          status: GameStatus.IN_PROGRESS,
          fen: game.fen
        },
        data: {
          fen: chess.fen(),
          pgn: chess.pgn(),
          status: outcome.status,
          winnerId: outcome.winnerId,
          resultReason: outcome.reason,
          endedAt: outcome.status === GameStatus.IN_PROGRESS ? null : new Date()
        }
      });

      if (updated.count !== 1) {
        throw new ConflictException("Game state changed; refresh and try again");
      }

      await tx.move.create({
        data: {
          gameId: game.id,
          from: move.from,
          to: move.to,
          san: move.san,
          fen: chess.fen(),
          ply
        }
      });

      if (outcome.status !== GameStatus.IN_PROGRESS) {
        await tx.room.update({
          where: { id: room.id },
          data: { status: RoomStatus.FINISHED }
        });
        await this.applyLeaderboardResult(tx, room.hostId, room.guestId, outcome.status);
      }
    });

    return this.getState(input.code, userId);
  }

  async resign(code: string, userId: string) {
    const room = await this.getPlayableRoom(code, userId);
    const game = room.game;

    if (!game || game.status !== GameStatus.IN_PROGRESS) {
      throw new ConflictException("This game is not active");
    }

    if (!room.guestId) {
      throw new BadRequestException("Waiting for a second player");
    }

    const status = userId === room.hostId ? GameStatus.BLACK_WON : GameStatus.WHITE_WON;
    const winnerId = userId === room.hostId ? room.guestId : room.hostId;

    await this.prisma.$transaction(async (tx) => {
      const updated = await tx.game.updateMany({
        where: { id: game.id, status: GameStatus.IN_PROGRESS },
        data: {
          status,
          winnerId,
          resultReason: "resignation",
          endedAt: new Date()
        }
      });

      if (updated.count !== 1) {
        throw new ConflictException("This game has already finished");
      }

      await tx.room.update({
        where: { id: room.id },
        data: { status: RoomStatus.FINISHED }
      });
      await this.applyLeaderboardResult(tx, room.hostId, room.guestId, status);
    });

    return this.getState(code, userId);
  }

  private async getPlayableRoom(code: string, userId: string) {
    const room = await this.prisma.room.findUnique({
      where: { code: code.toUpperCase() },
      include: gameRoomInclude
    });

    if (!room) {
      throw new NotFoundException("Room not found");
    }

    if (room.hostId !== userId && room.guestId !== userId) {
      throw new ForbiddenException("Join the room before playing");
    }

    return room;
  }

  private toState(room: Prisma.RoomGetPayload<{ include: typeof gameRoomInclude }>, userId: string) {
    const color = room.hostId === userId ? "white" : "black";
    return {
      room,
      player: {
        id: userId,
        color
      }
    };
  }

  private ensureUsersTurn(turn: TurnColor, whitePlayerId: string, blackPlayerId: string | null, userId: string) {
    const expectedUserId = turn === "w" ? whitePlayerId : blackPlayerId;
    if (expectedUserId !== userId) {
      throw new ForbiddenException("It is not your turn");
    }
  }

  private applyMove(chess: Chess, input: MoveInput) {
    try {
      const move = chess.move({
        from: input.from,
        to: input.to,
        promotion: input.promotion ?? "q"
      });

      if (!move) {
        throw new BadRequestException("Illegal move");
      }

      return move;
    } catch {
      throw new BadRequestException("Illegal move");
    }
  }

  private resolveOutcome(chess: Chess, movingColor: TurnColor, whitePlayerId: string, blackPlayerId: string | null) {
    if (chess.isCheckmate()) {
      const whiteWon = movingColor === "w";
      return {
        status: whiteWon ? GameStatus.WHITE_WON : GameStatus.BLACK_WON,
        winnerId: whiteWon ? whitePlayerId : blackPlayerId,
        reason: "checkmate"
      };
    }

    if (chess.isStalemate()) {
      return { status: GameStatus.DRAW, winnerId: undefined, reason: "stalemate" };
    }

    if (chess.isThreefoldRepetition()) {
      return { status: GameStatus.DRAW, winnerId: undefined, reason: "threefold repetition" };
    }

    if (chess.isInsufficientMaterial()) {
      return { status: GameStatus.DRAW, winnerId: undefined, reason: "insufficient material" };
    }

    if (chess.isDraw()) {
      return { status: GameStatus.DRAW, winnerId: undefined, reason: "draw" };
    }

    return { status: GameStatus.IN_PROGRESS, winnerId: undefined, reason: undefined };
  }

  private async applyLeaderboardResult(
    tx: Prisma.TransactionClient,
    whitePlayerId: string,
    blackPlayerId: string | null,
    status: GameStatus
  ) {
    if (!blackPlayerId) {
      return;
    }

    const [white, black] = await Promise.all([
      tx.user.findUniqueOrThrow({ where: { id: whitePlayerId } }),
      tx.user.findUniqueOrThrow({ where: { id: blackPlayerId } })
    ]);

    const whiteScore = status === GameStatus.WHITE_WON ? 1 : status === GameStatus.DRAW ? 0.5 : 0;
    const blackScore = status === GameStatus.BLACK_WON ? 1 : status === GameStatus.DRAW ? 0.5 : 0;
    const whiteRating = this.nextRating(white.rating, black.rating, whiteScore);
    const blackRating = this.nextRating(black.rating, white.rating, blackScore);

    await Promise.all([
      tx.user.update({
        where: { id: whitePlayerId },
        data: {
          wins: { increment: status === GameStatus.WHITE_WON ? 1 : 0 },
          losses: { increment: status === GameStatus.BLACK_WON ? 1 : 0 },
          draws: { increment: status === GameStatus.DRAW ? 1 : 0 },
          rating: whiteRating
        }
      }),
      tx.user.update({
        where: { id: blackPlayerId },
        data: {
          wins: { increment: status === GameStatus.BLACK_WON ? 1 : 0 },
          losses: { increment: status === GameStatus.WHITE_WON ? 1 : 0 },
          draws: { increment: status === GameStatus.DRAW ? 1 : 0 },
          rating: blackRating
        }
      })
    ]);
  }

  private nextRating(playerRating: number, opponentRating: number, score: number) {
    const expected = 1 / (1 + 10 ** ((opponentRating - playerRating) / 400));
    return Math.round(playerRating + 32 * (score - expected));
  }
}
