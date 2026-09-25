const { Router } = require("express");
const { authMiddleware } = require("../middlewares/admin/authMiddleware");

const getEventos = require("../middlewares/crm/calendario/getEventos");
const getEventoById = require("../middlewares/crm/calendario/getEventoById");
const createEvento = require("../middlewares/crm/calendario/createEvento");
const updateEvento = require("../middlewares/crm/calendario/updateEvento");
const deleteEvento = require("../middlewares/crm/calendario/deleteEvento");
const buscarContactoPorTelefono = require("../middlewares/crm/calendario/buscarContactoPorTelefono");

const router = Router();

router.use(authMiddleware);

router.get("/", getEventos);
// Antes de "/:id" — si no, Express la matchea como si "contacto-por-telefono" fuera un id.
router.get("/contacto-por-telefono", buscarContactoPorTelefono);
router.get("/:id", getEventoById);
router.post("/", createEvento);
router.patch("/:id", updateEvento);
router.delete("/:id", deleteEvento);

module.exports = router;
