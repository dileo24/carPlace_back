const { DataTypes } = require("sequelize");

// Guarda el token OAuth de la cuenta vendedora de MercadoLibre conectada.
// Es un sistema mono-cuenta (un solo concesionario) — siempre hay a lo sumo
// una fila; se resuelve por mlUserId en vez de asumir un id fijo.
module.exports = sequelize => {
  sequelize.define(
    "MercadoLibreCuenta",
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      mlUserId: {
        type: DataTypes.STRING,
        allowNull: false,
        unique: true,
      },
      nickname: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      accessToken: {
        type: DataTypes.TEXT,
        allowNull: false,
      },
      refreshToken: {
        type: DataTypes.TEXT,
        allowNull: false,
      },
      scope: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      // Momento exacto en que expira el accessToken (ML lo emite con
      // expires_in en segundos, típicamente 6hs) — se recalcula en cada
      // token/refresh nuevo.
      expiraEn: {
        type: DataTypes.DATE,
        allowNull: false,
      },
    },
    {
      timestamps: true,
    },
  );
};
