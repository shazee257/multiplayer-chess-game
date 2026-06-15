import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { GamesGateway } from "./games.gateway";
import { GamesService } from "./games.service";

@Module({
  imports: [AuthModule],
  providers: [GamesGateway, GamesService],
  exports: [GamesService]
})
export class GamesModule {}
