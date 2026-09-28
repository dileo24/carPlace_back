// models/Gasto.js
// Gastos generales del negocio (alquiler, sueldos, servicios, etc.) — no
// confundir con los gastos de alistaje de un auto puntual (AutoTareaAlistaje),
// que ya se descuentan en Venta.gastos/ganancia. Esto es para Facturación.
const { DataTypes } = require("sequelize");

module.exports = sequelize => {
  sequelize.define(
    "Gasto",
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      monto: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      moneda: {
        type: DataTypes.ENUM("ARS", "USD"),
        allowNull: false,
        defaultValue: "ARS",
      },
      categoria: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      descripcion: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      fecha: {
        type: DataTypes.DATEONLY,
        allowNull: false,
      },
      creadoPorId: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
    },
    {
      timestamps: true,
      createdAt: "creadoEn",
      updatedAt: "actualizadoEn",
    },
  );
};
