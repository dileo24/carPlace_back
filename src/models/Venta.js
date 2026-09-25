const { DataTypes } = require("sequelize");

module.exports = sequelize => {
  sequelize.define(
    "Venta",
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      vehiculoVendido: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      fechaVenta: {
        type: DataTypes.DATEONLY,
        allowNull: false,
      },
      nombre: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      apellido: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      telefono: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      recibioPago: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      autoRecibido: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      precioVendido: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      moneda: {
        type: DataTypes.ENUM("ARS", "USD"),
        allowNull: false,
        defaultValue: "ARS",
      },
      // A partir de acá: snapshot de datos del Auto tomado en el momento de la
      // venta (createVenta.js), porque el auto se destruye al vender — sin
      // FK porque para cuando se lee este dato la fila de Autos ya no existe.
      autoId: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      propietarioAuto: {
        type: DataTypes.ENUM("agencia", "socio", "compartido"),
        allowNull: false,
        defaultValue: "agencia",
      },
      fechaCompra: {
        type: DataTypes.DATEONLY,
        allowNull: true,
      },
      precioCompra: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      // Suma de los precios de las tareas de alistaje del auto al momento de
      // la venta.
      gastos: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      // Desglose de esas tareas: [{ texto, precio }], para poder abrir el
      // detalle de qué compuso "gastos" más adelante.
      gastosDetalle: {
        type: DataTypes.JSON,
        allowNull: true,
      },
      // precioVendido - gastos - precioCompra. Null si no se cargó precio de
      // compra (ej. autos de consignación).
      ganancia: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
    },
    {
      timestamps: false,
    },
  );
};
