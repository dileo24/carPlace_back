const { Router } = require("express");
const { authMiddleware, requireRole } = require("../middlewares/admin/authMiddleware");
const getConversaciones = require("../middlewares/crm/conversaciones/getConversaciones");
const getConversacionById = require("../middlewares/crm/conversaciones/getConversacionById");
const updateEstado = require("../middlewares/crm/conversaciones/updateEstado");
const marcarLeido = require("../middlewares/crm/conversaciones/marcarLeido");
const generarConsulta = require("../middlewares/crm/conversaciones/generarConsulta");
const webhookWhatsApp = require("../middlewares/crm/conversaciones/webhookWhatsApp");
const enviarMensaje = require("../middlewares/crm/conversaciones/enviarMensaje");
const tomarConversacion = require("../middlewares/crm/conversaciones/tomarConversacion");
const enviarAudio = require("../middlewares/crm/conversaciones/enviarAudio");
const enviarMedia = require("../middlewares/crm/conversaciones/enviarMedia");
const eliminarConversacion = require("../middlewares/crm/conversaciones/eliminarConversacion");
const multer = require("multer");
const iniciarConversacion = require("../middlewares/crm/conversaciones/iniciarConversacion");
const soltarConversacion = require("../middlewares/crm/conversaciones/soltarConversacion");
const toggleOcultoMensaje = require("../middlewares/crm/conversaciones/toggleOcultoMensaje");
const createConversacionNota = require("../middlewares/crm/conversaciones/createConversacionNota");
const updateConversacionNota = require("../middlewares/crm/conversaciones/updateConversacionNota");
const deleteConversacionNota = require("../middlewares/crm/conversaciones/deleteConversacionNota");
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });
const router = Router();

// ── WhatsApp webhook (NO requiere auth — Meta lo llama directamente) ──
router.get("/webhook/whatsapp", webhookWhatsApp.verify);
router.post("/webhook/whatsapp", webhookWhatsApp.receive);

// ── CRM interno ───────────────────────────────────────────────────────
// El socio no tiene acceso a Conversaciones (ver requerimiento del perfil "socio").
router.use(authMiddleware, requireRole("admin", "supervisor", "vendedor", "publicador_vendedor"));

router.get("/", getConversaciones);
router.get("/:id", getConversacionById);
router.patch("/:id/tomar", tomarConversacion);
router.patch("/:id/estado", updateEstado); // tomar control / devolver bot / cerrar
router.patch("/:id/leido", marcarLeido);
router.post("/:id/mensaje", enviarMensaje); // asesor envía desde el CRM
router.post("/:id/consulta", generarConsulta); // botón "Generar consulta"
router.post("/:id/audio", upload.single("audio"), enviarAudio);
router.post("/:id/media", upload.single("file"), enviarMedia);
router.delete("/:id", eliminarConversacion);
router.post("/iniciar", iniciarConversacion); // botón "Empezar chat"
router.patch("/:id/soltar", soltarConversacion);
router.patch("/:id/mensaje/:mensajeId/ocultar", toggleOcultoMensaje);
router.post("/:id/notas", createConversacionNota);
router.put("/:id/notas/:notaId", updateConversacionNota);
router.delete("/:id/notas/:notaId", deleteConversacionNota);

router.patch("/:id/no-leido", async (req, res) => {
  try {
    const { Conversacion } = require("../db");
    const { getIO } = require("../bot/socket");
    const conv = await Conversacion.findByPk(req.params.id);
    if (!conv) return res.status(404).json({ error: "No encontrada" });

    await conv.update({ noLeido: 1, adminNoLeido: true });

    try {
      getIO().emit("conversacion:actualizada", {
        conversacionId: conv.id,
        noLeido: 1,
        adminNoLeido: true,
      });
    } catch (_) {}
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.post("/:id/generar-resumen", async (req, res) => {
  try {
    const { Conversacion, Consulta } = require("../db");
    const generarResumen = require("../bot/generarResumen");
    const { buscarConsultaActiva } = require("../services/consultasHelper");
    const normalizarTelefono = require("../services/normalizarTelefono");

    const resumen = await generarResumen(req.params.id);

    const conversacion = await Conversacion.findByPk(req.params.id);
    if (!conversacion.consultaId) {
      if (conversacion.telefono) {
        const consultaExistente = await buscarConsultaActiva(conversacion.telefono);
        if (consultaExistente) {
          return res.status(409).json({
            error: `Ya existe una consulta activa (#${consultaExistente.id}) con ese teléfono.`,
          });
        }
      }

      let perfil = conversacion.perfil || {};
      if (typeof perfil === "string") {
        try {
          perfil = JSON.parse(perfil);
        } catch {
          perfil = {};
        }
      }

      const consulta = await Consulta.create({
        nombre: conversacion.contactoNombre,
        apellido: conversacion.contactoApellido,
        telefono: normalizarTelefono(conversacion.telefono),
        vehiculo: perfil.vehiculo?.modelo || null,
        categoria: perfil.vehiculo?.categoria || null,
        origen: conversacion.canal,
        estado: "nuevo",
        cargadoPor: "bot",
        asesorId: conversacion.asesorId || null,
        asesorNombre: conversacion.asesorNombre || null,
        asesorApellido: conversacion.asesorApellido || null,
        notas: resumen,
        estadoCambiadoEn: new Date(),
      });
      await conversacion.update({ consultaId: consulta.id });

      try {
        const { backfillNotasConversacion } = require("../services/backfillNotasConversacion");
        await backfillNotasConversacion(conversacion.id, consulta.id);
      } catch (_) {}

      try {
        const { getIO } = require("../bot/socket");
        getIO().emit("conversacion:actualizada", {
          conversacionId: conversacion.id,
          consultaId: consulta.id,
        });
      } catch (_) {}
    }

    res.json({ ok: true, resumen });
  } catch (err) {
    console.error("Error generando resumen:", err);
    res.status(500).json({ error: "No se pudo generar el resumen" });
  }
});

module.exports = router;
