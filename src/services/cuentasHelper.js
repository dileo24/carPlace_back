// services/cuentasHelper.js
// Lógica compartida de Cuentas: nombre visible de cada punta, monto pendiente
// y notificación automática por WhatsApp de cada movimiento (alta o saldado).
const { User } = require("../db");
const { notificarAdmin } = require("./notificacionAdmin");

const NOMBRE_EMPRESA = "Car Place";

const formatoMonto = n => Number(n).toLocaleString("es-AR");

const pendienteDe = deuda => Math.max(0, deuda.monto - (deuda.montoSaldado || 0));

// Nombre de una punta: empresa, usuario del sistema (por id) o tercero ("Otro").
const nombreDePunta = (esEmpresa, id, nombreOtro, nombrePorId) => {
  if (esEmpresa) return NOMBRE_EMPRESA;
  if (id) return nombrePorId.get(id) ?? "—";
  return nombreOtro || "—";
};

const mapaNombresAdmins = async () => {
  const admins = await User.findAll({ where: { rol: "admin" }, attributes: ["id", "name", "email"] });
  return { admins, nombrePorId: new Map(admins.map(a => [a.id, a.name || a.email])) };
};

// Un fallo del WhatsApp nunca debe romper la operación de cuentas (la deuda
// ya quedó guardada), así que se traga el error y solo lo loguea.
const notificarMovimiento = async texto => {
  try {
    await notificarAdmin(texto);
  } catch (err) {
    console.error("No se pudo notificar el movimiento de cuentas por WhatsApp:", err.message);
  }
};

module.exports = { NOMBRE_EMPRESA, formatoMonto, pendienteDe, nombreDePunta, mapaNombresAdmins, notificarMovimiento };
