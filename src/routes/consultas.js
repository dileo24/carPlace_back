// routes/consultas.js
const { Router } = require("express");
const { authMiddleware, requireRole } = require("../middlewares/admin/authMiddleware");
const getConsultas = require("../middlewares/crm/consultas/getConsultas");
const getConsultaById = require("../middlewares/crm/consultas/getConsultaById");
const createConsulta = require("../middlewares/crm/consultas/createConsulta");
const updateConsulta = require("../middlewares/crm/consultas/updateConsulta");
const deleteConsulta = require("../middlewares/crm/consultas/deleteConsulta");
const getMetricasConsultas = require("../middlewares/crm/consultas/getMetricasConsultas");
const createConsultaHistorial = require("../middlewares/crm/consultas/createConsultaHistorial");
const updateConsultaHistorial = require("../middlewares/crm/consultas/updateConsultaHistorial");
const deleteConsultaHistorial = require("../middlewares/crm/consultas/deleteConsultaHistorial");

const router = Router();

// El socio no tiene acceso a Consultas (ver requerimiento del perfil "socio").
router.use(authMiddleware, requireRole("admin", "supervisor", "vendedor", "publicador_vendedor"));

// ── Consultas ──────────────────────────────────────────────────
router.get("/metricas", getMetricasConsultas); // antes del :id
router.get("/", getConsultas);
router.get("/:id", getConsultaById);
router.post("/", createConsulta);
router.put("/:id", updateConsulta);
router.delete("/:id", deleteConsulta); // solo admin (verificar en middleware)

// ── Historial ──────────────────────────────────────────────────
router.post("/:id/historial", createConsultaHistorial);
router.put("/:id/historial/:entradaId", updateConsultaHistorial);
router.delete("/:id/historial/:entradaId", deleteConsultaHistorial);

module.exports = router;
