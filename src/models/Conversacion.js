// models/conversacion.js
module.exports = sequelize => {
  const { DataTypes } = require("sequelize");

  sequelize.define(
    "Conversacion",
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },

      // Contacto
      telefono: { type: DataTypes.STRING, allowNull: false },
      contactoNombre: { type: DataTypes.STRING, allowNull: true },
      contactoApellido: { type: DataTypes.STRING, allowNull: true },

      // Canal
      canal: {
        type: DataTypes.ENUM("WhatsApp", "Instagram"),
        allowNull: false,
        defaultValue: "WhatsApp",
      },

      // Estado del flujo
      estado: {
        type: DataTypes.ENUM("bot", "asesor", "cerrada"),
        allowNull: false,
        defaultValue: "bot",
      },

      // Asesor que tomó control (si aplica)
      asesorId: { type: DataTypes.INTEGER, allowNull: true },
      asesorNombre: { type: DataTypes.STRING, allowNull: true },
      asesorApellido: { type: DataTypes.STRING, allowNull: true },

      // WhatsApp Cloud API — necesitamos esto para enviar mensajes de vuelta
      waContactId: { type: DataTypes.STRING, allowNull: true }, // wa_id del contacto

      // Perfil construido por el bot (JSON)
      perfil: { type: DataTypes.JSON, allowNull: true },

      // Resumen generado por IA
      resumenIA: { type: DataTypes.TEXT, allowNull: true },

      // Si ya se generó una Consulta a partir de esta conversación
      consultaId: { type: DataTypes.INTEGER, allowNull: true },

      // Mensajes no leídos
      noLeido: { type: DataTypes.INTEGER, defaultValue: 0 },
      adminNoLeido: { type: DataTypes.BOOLEAN, defaultValue: false },

      ultimoMensaje: { type: DataTypes.TEXT, allowNull: true },
      ultimaActividad: { type: DataTypes.DATE, allowNull: true },
      reactivacionEnviada: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      seguimiento7DiasEnviado: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      // true mientras se espera la respuesta del cliente al mensaje de
      // seguimiento de 7 días — le permite al bot procesar esa respuesta
      // puntual aunque la conversación esté asignada a un asesor.
      esperandoRespuestaSeguimiento7Dias: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      origen: {
        type: DataTypes.ENUM(
          "WhatsApp",
          "Instagram",
          "Facebook",
          "Web",
          "Teléfono",
          "Presencial",
          "Referido",
          "MercadoLibre",
          "Otro",
        ),
        allowNull: true,
        defaultValue: null,
      },
      resumenIAUpdatedAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
    },
    {
      timestamps: true,
    },
  );
};
