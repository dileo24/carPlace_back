const { Venta } = require("../../db");

const ROLES_SIN_ACCESO = ["supervisor"]; // ideal: constants.js compartido

const updateVenta = async (req, res) => {
  try {
    const rol = req.user?.rol || "";
    if (ROLES_SIN_ACCESO.includes(rol)) {
      return res.status(403).json({ status: "403", resp: "No tenés permiso para editar ventas." });
    }

    const { id } = req.params;
    const { vehiculoVendido, fechaVenta, nombre, apellido, telefono, recibioPago, autoRecibido, precioVendido, moneda } =
      req.body;

    const venta = await Venta.findByPk(id);
    if (!venta) return res.status(404).json({ status: "404", resp: `Venta ${id} no encontrada.` });

    // Si se corrige el precio de venta, la ganancia (que se calculó y guardó
    // al momento de la venta) queda desactualizada — se recalcula acá con los
    // mismos gastos/precioCompra ya guardados (esos no se editan desde acá).
    let ganancia = venta.ganancia;
    if (precioVendido !== undefined && venta.precioCompra != null) {
      const precioVendidoNum = parseInt(String(precioVendido ?? "").replace(/\./g, ""), 10);
      ganancia = Number.isNaN(precioVendidoNum) ? null : precioVendidoNum - (venta.gastos || 0) - venta.precioCompra;
    }

    await venta.update({
      ...(vehiculoVendido !== undefined && { vehiculoVendido: vehiculoVendido.trim() }),
      ...(fechaVenta !== undefined && { fechaVenta }),
      ...(nombre !== undefined && { nombre: nombre.trim() }),
      ...(apellido !== undefined && { apellido: apellido.trim() }),
      ...(telefono !== undefined && { telefono: telefono.trim() }),
      ...(recibioPago !== undefined && { recibioPago }),
      ...(precioVendido !== undefined && { precioVendido, ganancia }),
      ...(moneda !== undefined && { moneda }),
      autoRecibido: recibioPago && autoRecibido ? autoRecibido.trim() : null,
    });

    return res.status(200).json({ status: 200, resp: venta });
  } catch (error) {
    return res.status(500).json({ status: "500", resp: error.message });
  }
};

module.exports = updateVenta;