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

    const deudasResp = deudas.map(d => ({
      ...d.toJSON(),
      deudorNombre: nombrePorId.get(d.deudorId) ?? "—",
      acreedorNombre: nombrePorId.get(d.acreedorId) ?? "—",
    }));

    // Saldo neto por admin y moneda: positivo = le deben (a favor), negativo = debe.
    const saldos = {};
    for (const admin of admins) {
      saldos[admin.id] = { ARS: 0, USD: 0 };
    }
    for (const d of deudas) {
      if (!saldos[d.deudorId]) saldos[d.deudorId] = { ARS: 0, USD: 0 };
      if (!saldos[d.acreedorId]) saldos[d.acreedorId] = { ARS: 0, USD: 0 };
      saldos[d.deudorId][d.moneda] -= d.monto;
      saldos[d.acreedorId][d.moneda] += d.monto;
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
