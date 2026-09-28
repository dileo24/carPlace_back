// cronjobs/backupSemanalEmail.js
const cron = require("node-cron");
const { exec } = require("child_process");
const path = require("path");
const fs = require("fs");
const zlib = require("zlib");
const os = require("os");
const nodemailer = require("nodemailer");
const { logCron } = require("../services/cronLog");
const { User } = require("../db");
require("dotenv").config();

const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST,
  port: process.env.EMAIL_PORT,
  secure: true,
  auth: {
    user: process.env.EMAIL_FROM,
    pass: process.env.EMAIL_PASS,
  },
});

// Mismo dump que el botón manual de /backup (routes/backup.js), pero
// comprimido con zlib (built-in de Node, no depende de que el server tenga
// un binario `gzip` en el PATH) — más liviano para mandar por mail y menos
// chance de que algún filtro antispam lo bloquee por ser un .sql "suelto".
async function generarYEnviarBackup() {
  const { DB_USER, DB_PASSWORD, DB_HOST, DB_PORT, DB_NAME } = process.env;
  const fecha = new Date().toISOString().slice(0, 10);
  const sqlPath = path.join(os.tmpdir(), `backup_${DB_NAME}_${fecha}.sql`);
  const gzFilename = `backup_${DB_NAME}_${fecha}.sql.gz`;
  const gzPath = path.join(os.tmpdir(), gzFilename);

  const cmd = `mysqldump -h ${DB_HOST} -P ${DB_PORT || 3306} -u ${DB_USER} ${DB_NAME} > "${sqlPath}"`;

  await new Promise((resolve, reject) => {
    exec(cmd, { env: { ...process.env, MYSQL_PWD: DB_PASSWORD } }, err => {
      if (err) return reject(err);
      resolve();
    });
  });

  await new Promise((resolve, reject) => {
    fs.createReadStream(sqlPath)
      .pipe(zlib.createGzip())
      .pipe(fs.createWriteStream(gzPath))
      .on("finish", resolve)
      .on("error", reject);
  });
  fs.unlink(sqlPath, () => {});

  const admins = await User.findAll({ where: { rol: "admin" }, attributes: ["email"] });
  const destinatarios = admins.map(a => a.email).join(",");

  await transporter.sendMail({
    from: process.env.EMAIL_FROM,
    to: destinatarios,
    subject: `Backup semanal — ${DB_NAME} (${fecha})`,
    text: `Backup automático de la base de datos generado el ${fecha}. Se adjunta comprimido (.sql.gz).`,
    attachments: [{ filename: gzFilename, path: gzPath }],
  });

  fs.unlink(gzPath, () => {});
}

cron.schedule(
  "0 4 * * 0", // domingos a las 4am
  async () => {
    console.log("[CRON] Generando y enviando backup semanal por mail...");
    try {
      await generarYEnviarBackup();
      console.log("[CRON] Backup semanal enviado por mail.");
      await logCron("backup_semanal", "ok", "Backup enviado por mail correctamente.");
    } catch (err) {
      console.error("[CRON] Error al generar/enviar backup semanal:", err.message);
      await logCron("backup_semanal", "error", "Error al generar o enviar el backup semanal", err.message);
    }
  },
  { timezone: "America/Argentina/Cordoba" },
);
