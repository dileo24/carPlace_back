// models/tarea.js
const { DataTypes } = require("sequelize");

module.exports = sequelize => {
  sequelize.define(
    "Tarea",
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },

      titulo: {
        type: DataTypes.STRING(255),
        allowNull: false,
      },

      tipo: {
        type: DataTypes.ENUM(
          "papeles",
          "administrativo",
          "alistaje",
          "fotos_publicar",
          "contactar",
          "seguimiento",
        ),
        allowNull: false,
      },

      prioridad: {
        type: DataTypes.ENUM("alta", "media", "baja"),
        allowNull: false,
        defaultValue: "media",
      },

      estado: {
        type: DataTypes.ENUM("pendiente", "en_progreso", "completada", "cancelada"),
        allowNull: false,
        defaultValue: "pendiente",
      },

      descripcion: {
        type: DataTypes.TEXT,
        allowNull: true,
      },

      creadoPor: {
        type: DataTypes.ENUM("usuario", "bot"),
        allowNull: false,
        defaultValue: "usuario",
      },
      
      creadoPorId: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },

      notas: {
        type: DataTypes.JSON,
        allowNull: false,
        defaultValue: [],
        get() {
          const raw = this.getDataValue("notas");
          if (!raw) return [];
          if (typeof raw === "string") {
            try {
              return JSON.parse(raw);
            } catch {
              return [];
            }
          }
          return raw;
        },
      },
    },
    {
      timestamps: true,
      createdAt: "creadoEn",
      updatedAt: "actualizadoEn",
    },
  );
};
