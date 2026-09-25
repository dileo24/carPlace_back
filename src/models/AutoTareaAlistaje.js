const { DataTypes } = require("sequelize");

module.exports = sequelize => {
  sequelize.define(
    "AutoTareaAlistaje",
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      autoId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: {
          model: "Autos",
          key: "id",
        },
      },
      texto: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      hecha: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      orden: {
        type: DataTypes.INTEGER,
        allowNull: true,
        defaultValue: 0, // para mantener el orden en el front
      },
      // Costo opcional de esta tarea — si se carga, cuenta como "gasto" del
      // auto (ver Venta.gastos/gastosDetalle, calculado al vender).
      precio: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
    },
    {
      timestamps: false,
    },
  );
};
