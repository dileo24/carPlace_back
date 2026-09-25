const { Router } = require("express");
const { authMiddleware, optionalAuth, requireRole } = require("../middlewares/admin/authMiddleware");
const allAutos = require("../middlewares/autos/allAutos");
const { Sequelize } = require("sequelize");
const createAuto = require("../middlewares/autos/createAuto");
const deleteAuto = require("../middlewares/autos/deleteAuto");
const updateAuto = require("../middlewares/autos/updateAuto");
const getAutosDestacados = require("../middlewares/autos/getAutosDestacados");
const getAutoById = require("../middlewares/autos/getAutoByID");
const getAutosByCategoria = require("../middlewares/autos/getAutoByCateg");
const { Auto } = require("../db");
const getTareasAlistaje = require("../middlewares/autos/tareas/getTareasAlistaje");
const createTareaAlistaje = require("../middlewares/autos/tareas/createTareaAlistaje");
const updateTareaAlistaje = require("../middlewares/autos/tareas/updateTareaAlistaje");
const deleteTareaAlistaje = require("../middlewares/autos/tareas/deleteTareaAlistaje");
const syncTareasAlistaje = require("../middlewares/autos/tareas/syncTareasAlistaje");

const router = Router();

router.get("/", optionalAuth, allAutos);

router.get("/destacados", getAutosDestacados);

router.get("/marcas", async (req, res) => {
  try {
    const marcas = await Auto.findAll({
      attributes: [[Sequelize.fn("DISTINCT", Sequelize.col("marca")), "marca"]],
      order: [["marca", "ASC"]],
    });
    res.json(marcas.map(item => item.marca));
  } catch (error) {
    console.error(error);
    res.status(500).json(error);
  }
});

router.post("/relacionados", getAutosByCategoria);

router.get("/:id", optionalAuth, getAutoById);

// Crear auto: admin y publicador_vendedor (igual que /nuevo_auto en App.jsx)
router.post("/", authMiddleware, requireRole("admin", "publicador_vendedor"), createAuto);

// Editar/eliminar: admin únicamente (igual que /catalogo/:id/editar en App.jsx).
// Si en algún momento publicador_vendedor también debería poder editar autos
// ya publicados (hoy solo puede crear nuevos), avisame y lo ampliamos acá.
router.delete("/:id", authMiddleware, requireRole("admin"), deleteAuto);
router.put("/:id", authMiddleware, requireRole("admin"), updateAuto);

// Tareas de alistaje: mismo criterio que crear autos (se usan también al
// cargar un auto nuevo desde /nuevo_auto).
router.get("/:id/tareas", authMiddleware, requireRole("admin", "publicador_vendedor"), getTareasAlistaje);
router.post("/:id/tareas", authMiddleware, requireRole("admin", "publicador_vendedor"), createTareaAlistaje);
router.put("/:id/tareas/sync", authMiddleware, requireRole("admin", "publicador_vendedor"), syncTareasAlistaje);
router.patch("/:id/tareas/:tareaId", authMiddleware, requireRole("admin", "publicador_vendedor"), updateTareaAlistaje);
router.delete("/:id/tareas/:tareaId", authMiddleware, requireRole("admin", "publicador_vendedor"), deleteTareaAlistaje);

module.exports = router;
