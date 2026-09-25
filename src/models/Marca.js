const { DataTypes } = require("sequelize");

module.exports = sequelize => {
  sequelize.define(
    "Marca",
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      nombre: {
        type: DataTypes.STRING,
        allowNull: false,
        unique: true,
      },
      fotoUrl: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      // public_id de Cloudinary (sin el prefijo de carpeta) — para poder
      // borrar la foto vieja de Cloudinary al reemplazarla o al borrar la marca.
      fotoPublicId: {
        type: DataTypes.STRING,
        allowNull: true,
      },
    },
    {
      timestamps: true,
    },
  );
};
