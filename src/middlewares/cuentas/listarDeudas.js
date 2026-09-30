// controllers/cuentas/listarDeudas.js
const { Deuda } = require("../../db");
const { pendienteDe, nombreDePunta, mapaNombresAdmins } = require("../../services/cuentasHelper");

// GET /cuentas — historial completo (incluye las saldadas) + saldo pendiente
// neto por socio y moneda, para que el frontend pinte en verde/rojo según
// quién esté logueado. Los saldos y totales solo cuentan lo que falta pagar.
const listarDeudas = async (req, res) => {
  try {
    const [deudas, { admins, nombrePorId }] = await Promise.all([
      Deuda.findAll({ order: [["fecha", "DESC"], ["id", "DESC"]] }),
      mapaNombresAdmins(),
    ]);

    const deudasResp = deudas.map(d => {
      const plain = d.toJSON();
      return {
        ...plain,
        pendiente: pendienteDe(plain),
        deudorNombre: nombreDePunta(plain.deudorEmpresa, plain.deudorId, plain.deudorNombre, nombrePorId),
        acreedorNombre: nombreDePunta(plain.acreedorEmpresa, plain.acreedorId, plain.acreedorNombre, nombrePorId),
      };
    });

    // Saldo pendiente por socio y moneda: positivo = le deben (a favor),
    // negativo = debe. La empresa y los terceros no tienen saldo propio.
    const saldos = {};
    for (const admin of admins) saldos[admin.id] = { ARS: 0, USD: 0 };

    for (const d of deudas) {
      if (d.saldada) continue;
      const pendiente = pendienteDe(d);
      if (d.deudorId) {
        if (!saldos[d.deudorId]) saldos[d.deudorId] = { ARS: 0, USD: 0 };
        saldos[d.deudorId][d.moneda] -= pendiente;
      }
      if (d.acreedorId) {
        if (!saldos[d.acreedorId]) saldos[d.acreedorId] = { ARS: 0, USD: 0 };
        saldos[d.acreedorId][d.moneda] += pendiente;
      }
    }

    res.status(200).json({ status: 200, resp: { deudas: deudasResp, admins, saldos } });
  } catch (error) {
    console.error(error);
    res.status(500).json({ status: 500, error: error.message });
  }
};

module.exports = listarDeudas;
