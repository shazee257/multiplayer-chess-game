import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PassportStrategy } from "@nestjs/passport";
import { ExtractJwt, Strategy } from "passport-jwt";
import { AuthUser } from "../common/decorators/current-user.decorator";

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(configService: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.get<string>("JWT_SECRET") ?? "dev-secret-change-me"
    });
  }

  validate(payload: { sub: string; email: string; username: string }): AuthUser {
    return {
      id: payload.sub,
      email: payload.email,
      username: payload.username
    };
  }
}
