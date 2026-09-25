const { DataTypes } = require("sequelize");

module.exports = sequelize => {
  sequelize.define(
    "User",
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      name: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      email: {
        type: DataTypes.STRING,
        allowNull: false,
        unique: true,
      },
      pass: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      rol: {
        type: DataTypes.ENUM("admin", "supervisor", "vendedor", "publicador_vendedor", "socio"),
        allowNull: false,
      },
      // Color hex asignado por el admin (ej. para el socio) — usado para
      // distinguir sus eventos en el calendario compartido del equipo.
      color: {
        type: DataTypes.STRING,
        allowNull: true,
      },
    },
    {
      timestamps: true,
    },
  );
};
