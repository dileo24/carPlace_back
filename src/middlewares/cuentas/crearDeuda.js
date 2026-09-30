// controllers/cuentas/crearDeuda.js
const { Deuda, User } = require("../../db");
const hoyArgentina = require("../../services/hoyArgentina");
const { NOMBRE_EMPRESA, formatoMonto, nombreDePunta, mapaNombresAdmins, notificarMovimiento } = require("../../services/cuentasHelper");

// POST /cuentas — carga una nueva deuda. Cada punta (deudor/acreedor) puede
// ser un socio del sistema (deudorId/acreedorId), la empresa misma
// (deudorEmpresa/acreedorEmpresa) o un tercero ajeno ("Otro"), identificado
// solo por nombre y teléfono. Si las dos puntas son socios la deuda es
// "interna"; en cualquier otro caso es "de empresa".
const crearDeuda = async (req, res) => {
  try {
    const {
      monto,
      moneda,
      motivo,
      deudorId,
      deudorNombre,
      deudorTelefono,
      deudorEmpresa,
      acreedorId,
      acreedorNombre,
      acreedorTelefono,
      acreedorEmpresa,
      fecha,
    } = req.body;

    if (!monto || Number(monto) <= 0) {
      return res.status(400).json({ status: 400, error: "El monto debe ser mayor a 0" });
    }
    if (!motivo?.trim()) {
      return res.status(400).json({ status: 400, error: "El motivo es requerido" });
    }

    const esEmpresaDeudor = Boolean(deudorEmpresa);
    const esEmpresaAcreedor = Boolean(acreedorEmpresa);
    if (esEmpresaDeudor && esEmpresaAcreedor) {
      return res.status(400).json({ status: 400, error: "La empresa no puede deberse a sí misma" });
    }

    const esOtroDeudor = !esEmpresaDeudor && !deudorId;
    const esOtroAcreedor = !esEmpresaAcreedor && !acreedorId;

    if (esOtroDeudor && (!deudorNombre?.trim() || !deudorTelefono?.trim())) {
      return res.status(400).json({ status: 400, error: "Completá nombre y teléfono de quién debe" });
    }
    if (esOtroAcreedor && (!acreedorNombre?.trim() || !acreedorTelefono?.trim())) {
      return res.status(400).json({ status: 400, error: "Completá nombre y teléfono de a quién le debe" });
    }

    const esSocioDeudor = !esEmpresaDeudor && !esOtroDeudor;
    const esSocioAcreedor = !esEmpresaAcreedor && !esOtroAcreedor;

    if (esSocioDeudor && esSocioAcreedor && Number(deudorId) === Number(acreedorId)) {
      return res.status(400).json({ status: 400, error: "El deudor y el acreedor no pueden ser el mismo" });
    }
    if (esSocioDeudor && !(await User.findByPk(deudorId))) {
      return res.status(404).json({ status: 404, error: "Usuario no encontrado (deudor)" });
    }
    if (esSocioAcreedor && !(await User.findByPk(acreedorId))) {
      return res.status(404).json({ status: 404, error: "Usuario no encontrado (acreedor)" });
    }

    const esInterna = esSocioDeudor && esSocioAcreedor;

    const deuda = await Deuda.create({
      monto: Math.round(Number(monto)),
      moneda: moneda === "USD" ? "USD" : "ARS",
      motivo: motivo.trim(),
      tipo: esInterna ? "interna" : "empresa",
      deudorEmpresa: esEmpresaDeudor,
      acreedorEmpresa: esEmpresaAcreedor,
      deudorId: esSocioDeudor ? Number(deudorId) : null,
      deudorNombre: esOtroDeudor ? deudorNombre.trim() : null,
      deudorTelefono: esOtroDeudor ? deudorTelefono.trim() : null,
      acreedorId: esSocioAcreedor ? Number(acreedorId) : null,
      acreedorNombre: esOtroAcreedor ? acreedorNombre.trim() : null,
      acreedorTelefono: esOtroAcreedor ? acreedorTelefono.trim() : null,
      creadoPorId: req.user?.id ?? null,
      fecha: fecha || hoyArgentina(),
    });

    const { nombrePorId } = await mapaNombresAdmins();
    const deudorTxt = nombreDePunta(esEmpresaDeudor, deuda.deudorId, deuda.deudorNombre, nombrePorId);
    const acreedorTxt = nombreDePunta(esEmpresaAcreedor, deuda.acreedorId, deuda.acreedorNombre, nombrePorId);
    notificarMovimiento(
      `💸 Nueva deuda ${esInterna ? "interna" : `de ${NOMBRE_EMPRESA}`}\n${deudorTxt} le debe ${deuda.moneda} ${formatoMonto(deuda.monto)} a ${acreedorTxt}\nMotivo: ${deuda.motivo}`,
    );

    res.status(201).json({ status: 201, resp: deuda });
  } catch (error) {
    console.error(error);
    res.status(500).json({ status: 500, error: error.message });
  }
};

module.exports = crearDeuda;
