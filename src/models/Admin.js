const { DataTypes } = require("sequelize");
module.exports = sequelize => {
  sequelize.define(
    "Admin",
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        unique: true,
        autoIncrement: true,
      },
      email: {
        type: DataTypes.STRING,
        unique: true,
        allowNull: false,
      },
      pass: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      name: { type: DataTypes.STRING, allowNull: true },
    },
    {
      timestamps: false,
    },
  );
};
