import http from "http";
import { Server as SocketIOServer } from "socket.io";
import app from "./app";
import { logger } from "./lib/logger";
import { seed } from "./seed";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error("PORT environment variable is required but was not provided.");
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const server = http.createServer(app);

// Socket.io for real-time vote/signature tracking
export const io = new SocketIOServer(server, {
  cors: { origin: "*", methods: ["GET", "POST"] },
});

io.on("connection", (socket) => {
  logger.info({ socketId: socket.id }, "Socket connected");

  socket.on("join:board", (boardId: string) => {
    socket.join(`board:${boardId}`);
  });

  socket.on("join:vote", (voteId: string) => {
    socket.join(`vote:${voteId}`);
  });

  socket.on("join:minutes", (minutesId: string) => {
    socket.join(`minutes:${minutesId}`);
  });

  socket.on("disconnect", () => {
    logger.info({ socketId: socket.id }, "Socket disconnected");
  });
});

server.listen(port, async () => {
  logger.info({ port }, "Server listening");

  try {
    await seed();
  } catch (err) {
    logger.error({ err }, "Seed failed — non-fatal");
  }
});
