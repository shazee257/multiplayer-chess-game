import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { AuthModule } from "./auth/auth.module";
import { GamesModule } from "./games/games.module";
import { LeaderboardModule } from "./leaderboard/leaderboard.module";
import { PrismaModule } from "./prisma/prisma.module";
import { RoomsModule } from "./rooms/rooms.module";
import { UsersModule } from "./users/users.module";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    UsersModule,
    AuthModule,
    RoomsModule,
    GamesModule,
    LeaderboardModule
  ]
})
export class AppModule {}
