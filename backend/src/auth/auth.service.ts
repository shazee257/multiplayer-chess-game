import { ConflictException, Injectable, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { Prisma } from "@prisma/client";
import * as bcrypt from "bcryptjs";
import { UsersService } from "../users/users.service";
import { LoginDto, SignupDto } from "./dto/auth.dto";

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService
  ) {}

  async signup(dto: SignupDto) {
    const passwordHash = await bcrypt.hash(dto.password, 12);

    try {
      const user = await this.usersService.create({
        email: dto.email.toLowerCase(),
        username: dto.username,
        passwordHash
      });

      return this.withToken(user);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new ConflictException("Email or username is already in use");
      }

      throw error;
    }
  }

  async login(dto: LoginDto) {
    const user = await this.usersService.findByEmail(dto.email.toLowerCase());
    if (!user) {
      throw new UnauthorizedException("Invalid email or password");
    }

    const passwordMatches = await bcrypt.compare(dto.password, user.passwordHash);
    if (!passwordMatches) {
      throw new UnauthorizedException("Invalid email or password");
    }

    const { passwordHash: _passwordHash, ...publicUser } = user;
    return this.withToken(publicUser);
  }

  async me(userId: string) {
    const user = await this.usersService.findPublicById(userId);
    if (!user) {
      throw new UnauthorizedException("User not found");
    }

    return user;
  }

  verifyToken(token: string) {
    return this.jwtService.verify<{ sub: string; email: string; username: string }>(token);
  }

  private withToken(user: { id: string; email: string; username: string }) {
    return {
      user,
      accessToken: this.jwtService.sign({
        sub: user.id,
        email: user.email,
        username: user.username
      })
    };
  }
}
