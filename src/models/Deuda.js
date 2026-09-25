// models/Deuda.js
// Cuenta corriente interna entre los socios (usuarios con rol admin): quién
// le debe a quién, cuánto y por qué. No tiene relación con Venta/Auto — es
// puramente interno.
const { DataTypes } = require("sequelize");

module.exports = sequelize => {
  sequelize.define(
    "Deuda",
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
      motivo: {
        type: DataTypes.TEXT,
        allowNull: false,
      },
      // User.id (rol admin) de quién debe y de quién tiene el dinero a favor.
      deudorId: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      acreedorId: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      creadoPorId: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      fecha: {
        type: DataTypes.DATEONLY,
        allowNull: false,
      },
    },
    {
      timestamps: true,
      createdAt: "creadoEn",
      updatedAt: "actualizadoEn",
    },
  );
};
