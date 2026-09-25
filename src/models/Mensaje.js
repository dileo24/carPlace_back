// models/mensaje.js
module.exports = sequelize => {
  const { DataTypes } = require("sequelize");

  sequelize.define(
    "Mensaje",
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },

      conversacionId: { type: DataTypes.INTEGER, allowNull: false },

      tipo: {
        type: DataTypes.ENUM("entrante", "saliente"),
        allowNull: false,
      },
      autor: {
        type: DataTypes.ENUM("contacto", "bot", "asesor"),
        allowNull: false,
      },

      texto: { type: DataTypes.TEXT, allowNull: false },

      // ID del mensaje en WhatsApp (para no procesar duplicados)
      waMsgId: { type: DataTypes.STRING, allowNull: true, unique: true },
      referenciadoMsgId: {
        type: DataTypes.STRING,
        allowNull: true,
        defaultValue: null,
      },
      userId: {
        type: DataTypes.INTEGER,
        allowNull: true, // null cuando autor es "bot" o "contacto"
      },
      autorNombre: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      procesado: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      // Marca el mensaje de seguimiento a los 7 días de inactividad, para poder
      // identificarlo y borrarlo si un vendedor retoma la conversación después.
      esSeguimiento7Dias: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      // El admin puede ocultar cualquier mensaje puntual (enviado o recibido)
      // para que no lo vea el vendedor, sin borrarlo — a diferencia de
      // esSeguimiento7Dias, que lo pone el sistema, este lo activa una persona.
      ocultoManual: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      mediaUrl: { type: DataTypes.STRING, allowNull: true },
      mediaType: { type: DataTypes.ENUM("image", "video", "audio", "documento"), allowNull: true },
      // public_id y resource_type de Cloudinary, para poder borrar el archivo
      // remoto al eliminar el mensaje/la conversación. Nulos en mensajes viejos
      // (previos a este campo) — para esos casos hay un fallback que parsea mediaUrl.
      mediaPublicId: { type: DataTypes.STRING, allowNull: true },
      mediaResourceType: { type: DataTypes.STRING, allowNull: true },
      timestamp: { type: DataTypes.DATE, allowNull: false },
    },
    {
      timestamps: true,
    },
  );
};
