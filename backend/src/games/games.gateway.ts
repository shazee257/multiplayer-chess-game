import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer
} from "@nestjs/websockets";
import { Server, Socket } from "socket.io";
import { AuthService } from "../auth/auth.service";
import { AuthUser } from "../common/decorators/current-user.decorator";
import { GamesService } from "./games.service";

type AuthenticatedSocket = Socket & {
  data: {
    user: AuthUser;
  };
};

@WebSocketGateway({
  namespace: "games",
  cors: {
    origin: "*"
  }
})
export class GamesGateway implements OnGatewayConnection {
  @WebSocketServer()
  private readonly server!: Server;

  constructor(
    private readonly authService: AuthService,
    private readonly gamesService: GamesService
  ) {}

  handleConnection(client: Socket) {
    const token = this.extractToken(client);
    if (!token) {
      client.disconnect(true);
      return;
    }

    try {
      const payload = this.authService.verifyToken(token);
      client.data.user = {
        id: payload.sub,
        email: payload.email,
        username: payload.username
      };
    } catch {
      client.disconnect(true);
    }
  }

  @SubscribeMessage("room:join")
  async joinRoom(@ConnectedSocket() client: AuthenticatedSocket, @MessageBody() body: { code: string }) {
    try {
      const code = body.code.toUpperCase();
      await this.gamesService.getState(code, client.data.user.id);
      await client.join(code);
      await this.broadcastRoomState(code);
    } catch (error) {
      this.emitError(client, error);
    }
  }

  @SubscribeMessage("move:make")
  async makeMove(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() body: { code: string; from: string; to: string; promotion?: string }
  ) {
    try {
      await this.gamesService.makeMove(client.data.user.id, body);
      await this.broadcastRoomState(body.code.toUpperCase());
    } catch (error) {
      this.emitError(client, error);
    }
  }

  @SubscribeMessage("game:resign")
  async resign(@ConnectedSocket() client: AuthenticatedSocket, @MessageBody() body: { code: string }) {
    try {
      await this.gamesService.resign(body.code, client.data.user.id);
      await this.broadcastRoomState(body.code.toUpperCase());
    } catch (error) {
      this.emitError(client, error);
    }
  }

  private extractToken(client: Socket) {
    const authToken = client.handshake.auth?.token;
    if (typeof authToken === "string") {
      return authToken;
    }

    const queryToken = client.handshake.query.token;
    return typeof queryToken === "string" ? queryToken : undefined;
  }

  private emitError(client: Socket, error: unknown) {
    const message = error instanceof Error ? error.message : "Something went wrong";
    client.emit("game:error", { message });
  }

  private async broadcastRoomState(code: string) {
    const sockets = await this.server.in(code).fetchSockets();

    await Promise.all(
      sockets.map(async (socket) => {
        const user = (socket.data as { user?: AuthUser }).user;
        if (!user) {
          return;
        }

        const state = await this.gamesService.getState(code, user.id);
        socket.emit("game:state", state);
      })
    );
  }
}
