# Multiplayer Chess Game

A full-stack chess app with:

- Nest.js backend with JWT authentication, Socket.IO realtime play, Prisma, and PostgreSQL
- Next.js frontend with login/signup, room creation, invite-code joining, an interactive chess board, and leaderboard
- Dockerized PostgreSQL for local development

## Quick Start

```bash
npm install
cp backend/.env.example backend/.env
cp frontend/.env.local.example frontend/.env.local
npm run db:up
npm run db:migrate
npm run dev:backend
npm run dev:frontend
```

If your Docker install does not include the Compose plugin, create the same container with:

```bash
npm run db:run
```

Backend: http://localhost:4000

Frontend: http://localhost:3000

## Flow

1. Sign up or log in.
2. Create a room to get an invite code.
3. Share the code or invite link with another logged-in user.
4. Only two participants can join a room.
5. Moves are validated on the backend and broadcast in realtime.
6. Completed games update wins, losses, draws, and rating.
