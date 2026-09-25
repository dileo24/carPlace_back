// models/consultaHistorial.js
const { DataTypes } = require("sequelize");

module.exports = sequelize => {
  sequelize.define(
    "ConsultaHistorial",
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      tipo: {
        type: DataTypes.ENUM(
          "whatsapp",
          "llamada",
          "visita",
          "respuesta",
          "facebook",
          "instagram",
          "sistema", // cambios de estado automáticos
          "otro",
        ),
        allowNull: false,
      },
      texto: {
        type: DataTypes.TEXT,
        allowNull: false,
      },
      creadoPorId: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      // FK a Consulta — definida en db.js con hasMany/belongsTo
      // FK opcional a Conversacion — permite notas cargadas desde el perfil de
      // una conversación, aunque todavía no exista (o nunca exista) una
      // consulta vinculada. Si ambas existen, se llenan las dos FK y la nota
      // queda visible desde los dos lados.
      conversacionId: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
    },
    {
      timestamps: true,
    },
  );
};
