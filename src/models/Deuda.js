// models/Deuda.js
// Cuenta corriente: quién le debe a quién, cuánto y por qué. Puede ser interna
// (entre los socios, usuarios con rol admin), de empresa (la empresa con un
// tercero) o un préstamo de la empresa cargado desde Ventas. Una deuda nunca se
// borra: solo se salda (total o, en las internas, parcialmente).
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
      // Nulos cuando esa punta es un tercero ajeno al sistema ("Otro") — en
      // ese caso van completos deudorNombre/deudorTelefono (o los de
      // acreedor, según cuál punta sea el tercero).
      deudorId: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      deudorNombre: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      deudorTelefono: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      acreedorId: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      acreedorNombre: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      acreedorTelefono: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      // "interna": ambas puntas son socios. "empresa": una punta es la empresa
      // o un tercero. "prestamo": la empresa le prestó plata a alguien (ver
      // createPrestamo.js).
      tipo: {
        type: DataTypes.ENUM("interna", "empresa", "prestamo"),
        allowNull: false,
        defaultValue: "interna",
      },
      // La punta es la empresa misma (no un socio puntual ni un tercero).
      deudorEmpresa: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      acreedorEmpresa: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      // Cuánto del monto ya se saldó (las deudas internas admiten pagos
      // parciales). Saldada = montoSaldado >= monto.
      montoSaldado: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      saldada: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      saldadaEn: {
        type: DataTypes.DATEONLY,
        allowNull: true,
      },
      // [{ fecha, monto, metodo, comentario, porId }] — un item por cada pago.
      pagos: {
        type: DataTypes.JSON,
        allowNull: true,
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
