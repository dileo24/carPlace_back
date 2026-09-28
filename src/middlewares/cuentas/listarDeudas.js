// controllers/cuentas/listarDeudas.js
const { Deuda, User } = require("../../db");

// GET /cuentas — historial completo + saldo neto por socio y moneda, para que
// el frontend pinte en verde/rojo según quién esté logueado.
const listarDeudas = async (req, res) => {
  try {
    const [deudas, admins] = await Promise.all([
      Deuda.findAll({ order: [["fecha", "DESC"], ["id", "DESC"]] }),
      User.findAll({ where: { rol: "admin" }, attributes: ["id", "name", "email"] }),
    ]);

    const nombrePorId = new Map(admins.map(a => [a.id, a.name || a.email]));
    // Si la punta es un usuario (id), resuelve su nombre real; si es "Otro"
    // (sin id), usa el nombre suelto que se guardó con la deuda.
    const resolverNombre = (id, nombreOtro) => (id ? (nombrePorId.get(id) ?? "—") : nombreOtro || "—");

    const deudasResp = deudas.map(d => {
      const plain = d.toJSON();
      return {
        ...plain,
        deudorNombre: resolverNombre(plain.deudorId, plain.deudorNombre),
        acreedorNombre: resolverNombre(plain.acreedorId, plain.acreedorNombre),
      };
    });

    // Saldo neto por admin y moneda: positivo = le deben (a favor), negativo =
    // debe. Un "Otro" no tiene saldo propio (no es un usuario del sistema),
    // así que solo se acumula del lado que sí sea un admin.
    const saldos = {};
    for (const admin of admins) {
      saldos[admin.id] = { ARS: 0, USD: 0 };
    }
    for (const d of deudas) {
      if (d.deudorId) {
        if (!saldos[d.deudorId]) saldos[d.deudorId] = { ARS: 0, USD: 0 };
        saldos[d.deudorId][d.moneda] -= d.monto;
      }
      if (d.acreedorId) {
        if (!saldos[d.acreedorId]) saldos[d.acreedorId] = { ARS: 0, USD: 0 };
        saldos[d.acreedorId][d.moneda] += d.monto;
      }
    }

    res.status(200).json({
      status: 200,
      resp: {
        deudas: deudasResp,
        admins,
        saldos,
      },
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ status: 500, error: error.message });
  }
};

module.exports = listarDeudas;
