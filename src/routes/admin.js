const express = require("express");
const router = express.Router();
const login = require("../middlewares/admin/login");
const { authMiddleware, requireRole } = require("../middlewares/admin/authMiddleware");
const { generarMensajeReactivacion } = require("../services/generarMensajeReactivacion");

router.post("/login", login);

// Login es stateless (JWT): "cerrar sesión" es responsabilidad del cliente,
// que descarta el token. No depende de express-session (deshabilitado).
router.post("/logout", (req, res) => {
  res.status(200).json({ message: "Sesión cerrada" });
});

// POST /admin/crons/reactivacion
// Ejecuta manualmente el cron de reactivación de conversaciones inactivas
router.post("/crons/reactivacion", authMiddleware, requireRole("admin"), async (req, res) => {
  try {
    const { Conversacion, Mensaje } = require("../db");
    const { Op } = require("sequelize");
    const { sendWhatsAppMessage, sendWhatsAppTemplate } = require("../services/whatsapp");
    const { getIO } = require("../bot/socket");
    const { logCron } = require("../services/cronLog");

    const hace3Dias = new Date();
    hace3Dias.setDate(hace3Dias.getDate() - 3);

    const conversaciones = await Conversacion.findAll({
      where: {
        estado: { [Op.in]: ["bot", "asesor"] },
        ultimaActividad: { [Op.lt]: hace3Dias },
        reactivacionEnviada: false,
        createdAt: { [Op.lt]: hace3Dias },
      },
    });

    const resultados = [];

    for (const conv of conversaciones) {
      try {
        const mensaje = await generarMensajeReactivacion(conv);

        try {
          await sendWhatsAppTemplate(conv.telefono, "reactivacion_cliente", [
            {
              type: "body",
              parameters: [
                {
                  type: "text",
                  parameter_name: "customer_name",
                  text: conv.contactoNombre || "cliente",
                },
              ],
            },
          ]);
        } catch {
          await sendWhatsAppMessage(conv.telefono, mensaje);
        }

        const mensajeGuardado = await Mensaje.create({
          conversacionId: conv.id,
          tipo: "saliente",
          autor: "bot",
          texto: mensaje,
          timestamp: new Date(),
        });

        await conv.update({
          ultimoMensaje: mensaje,
          ultimaActividad: new Date(),
          reactivacionEnviada: true,
        });

        try {
          getIO().emit("conversacion:mensaje", {
            conversacionId: conv.id,
            mensaje: {
              id: mensajeGuardado.id,
              tipo: "saliente",
              autor: "bot",
              texto: mensaje,
              timestamp: mensajeGuardado.timestamp,
            },
            ultimoMensaje: mensaje,
            ultimaActividad: new Date(),
          });
        } catch (_) {}

        await logCron("reactivacion_cliente", "ok", `Reactivación manual enviada a conv ${conv.id}`);
        resultados.push({ convId: conv.id, telefono: conv.telefono, status: "ok", mensaje });
      } catch (err) {
        resultados.push({ convId: conv.id, telefono: conv.telefono, status: "error", error: err.message });
      }
    }

    res.json({
      total: conversaciones.length,
      resultados,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
