import { ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma, RoomStatus } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";

const publicUserSelect = {
  id: true,
  email: true,
  username: true,
  wins: true,
  losses: true,
  draws: true,
  rating: true
} satisfies Prisma.UserSelect;

const roomInclude = {
  host: { select: publicUserSelect },
  guest: { select: publicUserSelect },
  game: {
    include: {
      moves: {
        orderBy: { ply: "asc" }
      }
    }
  }
} satisfies Prisma.RoomInclude;

@Injectable()
export class RoomsService {
  constructor(private readonly prisma: PrismaService) {}

  async createRoom(hostId: string) {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        return await this.prisma.room.create({
          data: {
            code: this.generateRoomCode(),
            hostId,
            game: {
              create: {
                whitePlayerId: hostId
              }
            }
          },
          include: roomInclude
        });
      } catch (error) {
        if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") {
          throw error;
        }
      }
    }

    throw new ConflictException("Could not generate a unique room code");
  }

  async joinRoom(code: string, userId: string) {
    const room = await this.findRoom(code);

    if (room.status === RoomStatus.FINISHED) {
      throw new ConflictException("This room has already finished");
    }

    if (room.hostId === userId || room.guestId === userId) {
      return room;
    }

    if (room.guestId) {
      throw new ConflictException("This room already has two participants");
    }

    return this.prisma.room.update({
      where: { id: room.id },
      data: {
        guestId: userId,
        status: RoomStatus.ACTIVE,
        game: {
          update: {
            blackPlayerId: userId
          }
        }
      },
      include: roomInclude
    });
  }

  async getRoomForUser(code: string, userId: string) {
    const room = await this.findRoom(code);
    if (room.hostId !== userId && room.guestId !== userId) {
      throw new ForbiddenException("Join the room before viewing it");
    }

    return room;
  }

  findRoom(code: string) {
    return this.prisma.room.findUnique({
      where: { code: code.toUpperCase() },
      include: roomInclude
    }).then((room) => {
      if (!room) {
        throw new NotFoundException("Room not found");
      }

      return room;
    });
  }

  private generateRoomCode() {
    const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    return Array.from({ length: 6 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join("");
  }
}
