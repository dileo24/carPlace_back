module.exports = sequelize => {
  const { DataTypes } = require("sequelize");

  sequelize.define(
    "Configuracion",
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      clave: { type: DataTypes.STRING, allowNull: false, unique: true },
      valor: { type: DataTypes.JSON, allowNull: true },
    },
    {
      timestamps: true,
    },
  );
};
