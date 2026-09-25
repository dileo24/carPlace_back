const express = require("express");
const router = express.Router();
const { exec } = require("child_process");
const path = require("path");
const fs = require("fs");
const os = require("os");
const { authMiddleware, requireRole } = require("../middlewares/admin/authMiddleware");
require("dotenv").config();

router.get("/", authMiddleware, requireRole("admin"), (req, res) => {
    const { DB_USER, DB_PASSWORD, DB_HOST, DB_PORT, DB_NAME } = process.env;
    const fecha = new Date().toISOString().slice(0, 10);
    const filename = `backup_${DB_NAME}_${fecha}.sql`;
    const filepath = path.join(os.tmpdir(), filename);

    const cmd = `mysqldump -h ${DB_HOST} -P ${DB_PORT || 3306} -u ${DB_USER} ${DB_NAME} > "${filepath}"`;

    // La contraseña va por env (MYSQL_PWD), no como argumento del proceso,
    // para que no quede visible en la lista de procesos del servidor.
    exec(cmd, { env: { ...process.env, MYSQL_PWD: DB_PASSWORD } }, (err) => {
        if (err) {
            console.error("Error al generar backup:", err);
            return res.status(500).json({ error: "No se pudo generar el backup." });
        }

        res.download(filepath, filename, (downloadErr) => {
            if (downloadErr) console.error("Error al enviar backup:", downloadErr);
            fs.unlink(filepath, () => {});
        });
    });
});

module.exports = router;