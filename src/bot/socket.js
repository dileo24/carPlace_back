let _io = null;

const init = server => {
  const { Server } = require("socket.io");
  const allowedOrigins = (process.env.FRONTEND_URLS || "http://localhost:3000")
    .split(",")
    .map(url => url.trim());

  _io = new Server(server, {
    cors: {
      origin: allowedOrigins,
      methods: ["GET", "POST"],
      credentials: true,
    },
  });

  _io.on("connection", socket => {
    socket.on("disconnect", () => {});
  });

  return _io;
};

const getIO = () => {
  if (!_io) throw new Error("Socket.io no inicializado");
  return _io;
};

module.exports = { init, getIO };
