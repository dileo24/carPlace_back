const http = require("http");
const { init: initSocket } = require("./src/bot/socket");
require("dotenv").config();
const fs = require("fs");
const path = require("path");

const logFile = path.join(__dirname, "startup.log");
const log = msg => {
  fs.appendFileSync(logFile, `${new Date().toISOString()} - ${msg}\n`);
};

const server = require("./src/app.js");
const { conn } = require("./src/db.js");
const { fnCategorias, fnAutos, fnAdmin } = require("./src/loadDB.js");
const { Categoria, Admin } = require("./src/db.js");

log("Iniciando servidor...");

const CATEGORIAS_ESPERADAS = [
  "SUV",
  "Pick Up",
  "5 Puertas",
  "4 Puertas",
  "3 Puertas",
  "Utilitario",
  "Clásicos",
  "0km",
  "Moto",
];
const PORT = process.env.PORT || 3001;
const ffmpegPath = require("ffmpeg-static");
try {
  fs.chmodSync(ffmpegPath, 0o755);
  log("✅ ffmpeg permisos OK: " + ffmpegPath);
} catch (e) {
  log("⚠️ ffmpeg chmod falló: " + e.message);
}
conn
  .sync()
  .then(async () => {
    require("./src/cronjobs/rotarPrecioInfo.js");
    log("Cron de rotación de precios iniciado");
    require("./src/cronjobs/limpiarTareas.js");
    log("Cron de limpieza de tareas iniciado");
    require("./src/cronjobs/limpiarConsultas.js");
    log("Cron de limpieza de consultas iniciado");
    require("./src/cronjobs/recuperarMensajes.js");
    log("Cron de recuperación de mensajes iniciado");
    require("./src/cronjobs/backupSemanalEmail.js");
    log("Cron de backup semanal por mail iniciado");
    require("./src/cronjobs/expirarPublicaciones.js");
    log("Cron de expiración de publicaciones iniciado");
    require("./src/cronjobs/recordatorioCuotaExcepcional.js");
    log("Cron de recordatorio de cuota excepcional iniciado (temporal, ver archivo)");
    const { iniciarCron } = require("./src/cronjobs/recordatorioVisitas.js");
    await iniciarCron();
    log("Cron de recordatorio de visitas iniciado");

    const { iniciarCronInactividad, iniciarCronSeguimiento7Dias } = require("./src/cronjobs/inactividadConversaciones.js");
    iniciarCronInactividad();
    log("Cron de inactividad en conversaciones iniciado");
    iniciarCronSeguimiento7Dias();
    log("Cron de seguimiento de 7 días iniciado");
    const httpServer = http.createServer(server);
    initSocket(httpServer);
    httpServer.listen(PORT, async () => {
      log("Server escuchando en " + PORT);
      try {
        const categoriasExistentes = await Categoria.findAll({ attributes: ["categ"] });
        const nombresExistentes = categoriasExistentes.map(cat => cat.categ);
        const categoriasFaltantes = CATEGORIAS_ESPERADAS.filter(
          n => !nombresExistentes.includes(n),
        );
        if (categoriasFaltantes.length > 0) await fnCategorias();
        if ((await Admin.count()) === 0) await fnAdmin();
        log("Arranque completo OK");
      } catch (err) {
        log("ERROR post-listen: " + err.message + "\n" + err.stack);
      }
    });
  })
  .catch(err => {
    console.error("ERROR sync:", err);
    log("ERROR en sync: " + err.message + "\n" + err.stack);
    process.exit(1);
  });
