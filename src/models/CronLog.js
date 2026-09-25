module.exports = sequelize => {
  const { DataTypes } = require("sequelize");
  sequelize.define(
    "CronLog",
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      tipo: { type: DataTypes.STRING, allowNull: false },
      estado: { type: DataTypes.ENUM("ok", "error"), allowNull: false },
      mensaje: { type: DataTypes.TEXT, allowNull: true },
      detalle: { type: DataTypes.TEXT, allowNull: true },
    },
    { timestamps: true, updatedAt: false },
  );
};
