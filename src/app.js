const express = require("express");
const cookieParser = require("cookie-parser");
const bodyParser = require("body-parser");
const morgan = require("morgan");
const routes = require("./routes/index.js");
const cors = require("cors");
require("dotenv").config();

require("./db.js");

const server = express();

server.name = "API";

server.disable("etag");

// ── Cache ─────────────────────────────────────────────────────
server.use((req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  next();
});

// ── Parsers ───────────────────────────────────────────────────
server.use(bodyParser.urlencoded({ extended: true, limit: "50mb" }));
server.use(bodyParser.json({ limit: "50mb" }));
server.use(cookieParser());

// ── Logs ──────────────────────────────────────────────────────
server.use(morgan("dev"));

server.use((req, res, next) => {
  const ignorar = ["/sidebar", "/socket.io", "/dolar"];

  const ignorarGet = [
    "/conversaciones",
    "/configuracion/mensajes_predefinidos",
    "/autos/",
    "/consultas",
    "/tareas",
    "/ventas",
    "/reportes",
    "/calendario",
    "/cuentas",
    "/cronlogs",
  ];

  if (ignorar.some(p => req.originalUrl.startsWith(p))) return next();
  if (req.method === "GET" && ignorarGet.some(p => req.originalUrl.startsWith(p))) return next();
  if (req.method === "OPTIONS") return next();

  // Headers y body incluyen credenciales (Authorization, passwords de login) —
  // no loguear en producción.
  if (process.env.NODE_ENV === "development") {
    console.log("━━━━━━━━━━━━━━");
    console.log(req.method, req.originalUrl);
    if (Object.keys(req.headers).length) console.log("HEADERS:", JSON.stringify(req.headers));
    if (Object.keys(req.query).length) console.log("QUERY:", req.query);
    if (req.body && Object.keys(req.body).length) console.log("BODY:", req.body);
  }
  next();
});

// ── CORS ──────────────────────────────────────────────────────
server.use(
  cors({
    origin: function (origin, callback) {
      const allowedOrigins = (process.env.FRONTEND_URLS || "")
        .split(",")
        .map(url => url.trim())
        .filter(Boolean);

      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error("Not allowed by CORS"));
      }
    },

    credentials: true,

    methods: ["GET", "POST", "OPTIONS", "PUT", "DELETE", "PATCH"],

    allowedHeaders: ["Origin", "X-Requested-With", "Content-Type", "Accept", "Authorization"],

    exposedHeaders: ["X-Refreshed-Token", "Content-Disposition"],
  }),
);

// ── Routes ────────────────────────────────────────────────────
server.use("/", routes);

// ── Error handler ─────────────────────────────────────────────
server.use((err, req, res, next) => {
  const status = err.status || 500;
  const isDev = process.env.NODE_ENV === "development";

  console.error("ERROR:");
  console.error(err);

  res.status(status).json({
    status,
    error: isDev ? err.message || String(err) : "Error interno del servidor",
  });
});

module.exports = server;
