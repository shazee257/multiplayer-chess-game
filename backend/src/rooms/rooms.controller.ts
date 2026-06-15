import { Controller, Get, Param, Post, UseGuards } from "@nestjs/common";
import { AuthUser, CurrentUser } from "../common/decorators/current-user.decorator";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { RoomsService } from "./rooms.service";

@Controller("rooms")
@UseGuards(JwtAuthGuard)
export class RoomsController {
  constructor(private readonly roomsService: RoomsService) {}

  @Post()
  create(@CurrentUser() user: AuthUser) {
    return this.roomsService.createRoom(user.id);
  }

  @Post("join/:code")
  join(@Param("code") code: string, @CurrentUser() user: AuthUser) {
    return this.roomsService.joinRoom(code, user.id);
  }

  @Get(":code")
  get(@Param("code") code: string, @CurrentUser() user: AuthUser) {
    return this.roomsService.getRoomForUser(code, user.id);
  }
}
