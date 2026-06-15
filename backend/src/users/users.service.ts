import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";

const publicUserSelect = {
  id: true,
  email: true,
  username: true,
  wins: true,
  losses: true,
  draws: true,
  rating: true,
  createdAt: true
} satisfies Prisma.UserSelect;

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  findByEmail(email: string) {
    return this.prisma.user.findUnique({ where: { email } });
  }

  findPublicById(id: string) {
    return this.prisma.user.findUnique({
      where: { id },
      select: publicUserSelect
    });
  }

  create(data: { email: string; username: string; passwordHash: string }) {
    return this.prisma.user.create({
      data,
      select: publicUserSelect
    });
  }
}
