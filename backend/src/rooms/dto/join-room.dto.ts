import { IsString, Length, Matches } from "class-validator";

export class JoinRoomDto {
  @IsString()
  @Length(6, 6)
  @Matches(/^[A-Z0-9]+$/)
  code!: string;
}
