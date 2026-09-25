const { Router } = require("express");
const { authMiddleware, requireRole } = require("../middlewares/admin/authMiddleware");
const {
  getAuthUrl,
  verificarState,
  intercambiarCodigoPorToken,
  obtenerEstadoConexion,
  desconectarCuenta,
} = require("../services/mercadolibreService");

const router = Router();

const frontendUrl = (process.env.FRONTEND_URLS || "").split(",")[0]?.trim() || "";

// Estado de la conexión (para que el admin vea si ya hay una cuenta de ML
// conectada, y cuál). Solo admin.
router.get("/estado", authMiddleware, requireRole("admin"), async (req, res) => {
  try {
    const estado = await obtenerEstadoConexion();
    res.status(200).json({ status: 200, resp: estado });
  } catch (error) {
    console.error(error);
    res.status(500).json({ status: 500, error: error.message });
  }
});

// Devuelve la URL de autorización de ML — el frontend hace el redirect del
// navegador a esta URL (no se puede pedir por axios y redirigir solo, porque
// el login de ML necesita ser una navegación real). Solo admin.
router.get("/auth-url", authMiddleware, requireRole("admin"), (req, res) => {
  try {
    res.status(200).json({ status: 200, resp: { url: getAuthUrl() } });
  } catch (error) {
    console.error(error);
    res.status(500).json({ status: 500, error: error.message });
  }
});

// Desconecta la cuenta actual (ej: se conectó por error la cuenta
// equivocada). Solo admin.
router.delete("/desconectar", authMiddleware, requireRole("admin"), async (req, res) => {
  try {
    await desconectarCuenta();
    res.status(200).json({ status: 200, resp: { desconectado: true } });
  } catch (error) {
    console.error(error);
    res.status(500).json({ status: 500, error: error.message });
  }
});

// Callback de ML — lo pega el navegador directo después de que el vendedor
// autoriza, sin el header Authorization del resto del panel (por eso no lleva
// authMiddleware). La verificación de que este intento arrancó de un admin
// autenticado la hace el "state" firmado (ver mercadolibreService).
router.get("/callback", async (req, res) => {
  const { code, state, error } = req.query;

  if (error) {
    return res.redirect(`${frontendUrl}/crm?ml=error`);
  }

  if (!code || !state || !verificarState(state)) {
    return res.redirect(`${frontendUrl}/crm?ml=error`);
  }

  try {
    await intercambiarCodigoPorToken(code);
    res.redirect(`${frontendUrl}/crm?ml=conectado`);
  } catch (err) {
    console.error("Error conectando MercadoLibre:", err.response?.data || err.message);
    res.redirect(`${frontendUrl}/crm?ml=error`);
  }
});

module.exports = router;
