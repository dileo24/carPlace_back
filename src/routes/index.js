const express = require("express");
const router = express.Router();

const Admin = require("./admin");
const Autos = require("./autos");
const files = require("./uploadFiles");
const usersRouter = require("./users");
const crmCalendario = require("./crmCalendario");
const sendCarFormEmail = require("../middlewares/emails/compramos_email");
const ventas = require("./ventas");
const backupRouter = require("./backup");
const tareasRouter = require("./tareas");
const consultasRouter = require("./consultas");
const conversacionesRouter = require("./conversaciones");
const dashboardRouter = require("./dashboard");
const reportesRouter = require("./reportes");
const sidebarRouter = require("./sidebar");
const configuracionesRouter = require("./configuraciones");
const marcasRouter = require("./marcas");
const mercadolibreRouter = require("./mercadolibre");
const publicacionesRouter = require("./publicaciones");
const cuentasRouter = require("./cuentas");

router.use(express.json());
router.use(express.urlencoded({ extended: true }));

router.use("/admin", Admin);
router.use("/autos", Autos);
router.use("/files", files);
router.use("/eventos", crmCalendario);
router.use("/users", usersRouter);
router.use("/ventas", ventas);
router.use("/backup", backupRouter);
router.use("/tareas", tareasRouter);
router.use("/consultas", consultasRouter);
router.use("/conversaciones", conversacionesRouter);
router.use("/dashboard", dashboardRouter);
router.use("/reportes", reportesRouter);
router.use("/sidebar", sidebarRouter);
router.use("/configuracion", configuracionesRouter);
router.use("/marcas", marcasRouter);
router.use("/mercadolibre", mercadolibreRouter);
router.use("/publicaciones", publicacionesRouter);
router.use("/cuentas", cuentasRouter);

router.post("/compramos-tu-auto", sendCarFormEmail, async (req, res) => {
  try {
    res.status(200).json({
      status: 200,
      message: "Solicitud procesada correctamente",
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      status: 500,
      error: "Error al guardar los datos",
    });
  }
});

router.all("*", (req, res) => {
  res.status(404).json({
    status: 404,
    error: "Ruta no encontrada",
    path: req.originalUrl,
  });
});

module.exports = router;
