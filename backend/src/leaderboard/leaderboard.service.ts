import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class LeaderboardService {
  constructor(private readonly prisma: PrismaService) {}

  list() {
    return this.prisma.user.findMany({
      orderBy: [
        { rating: "desc" },
        { wins: "desc" },
        { draws: "desc" }
      ],
      take: 25,
      select: {
        id: true,
        username: true,
        rating: true,
        wins: true,
        losses: true,
        draws: true
      }
    });
  }
}
