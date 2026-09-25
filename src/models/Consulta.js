// models/consulta.js
const { DataTypes } = require("sequelize");

module.exports = sequelize => {
  sequelize.define(
    "Consulta",
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },

      // ── Datos del cliente ──────────────────────────────────────
      nombre: {
        type: DataTypes.STRING,
        allowNull: true, // puede venir vacío si lo cargó el bot
      },
      apellido: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      telefono: {
        type: DataTypes.STRING,
        allowNull: true,
      },

      // ── Interés comercial ──────────────────────────────────────
      vehiculo: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      categoria: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      presupuesto: {
        type: DataTypes.INTEGER,
        allowNull: true,
        defaultValue: 0,
      },
      moneda: {
        type: DataTypes.ENUM("USD", "ARS"),
        allowNull: false,
        defaultValue: "USD",
      },
      formaPago: {
        type: DataTypes.JSON,
        allowNull: false,
        defaultValue: ["a_definir"],
      },

      // ── Canal de origen ────────────────────────────────────────
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
        allowNull: false,
        defaultValue: "WhatsApp",
      },
      origenTexto: {
        // Solo se usa cuando origen === "Otro"
        type: DataTypes.STRING,
        allowNull: true,
      },

      // ── Etapa en el pipeline ───────────────────────────────────
      // nuevo → calificado → con_oferta → seguimiento → cerrado
      estado: {
        type: DataTypes.ENUM("nuevo", "con_oferta", "seguimiento", "cerrado", "perdido"),
        allowNull: false,
        defaultValue: "nuevo",
      },

      // Fecha en que cambió de estado por última vez — para el cron de 3 meses
      estadoCambiadoEn: {
        type: DataTypes.DATE,
        allowNull: true,
      },

      // ── Quién cargó la consulta ────────────────────────────────
      // "bot"     → creada automáticamente desde conversación
      // "usuario" → cargada manualmente por un vendedor/asesor
      // "admin"   → cargada por admin
      cargadoPor: {
        type: DataTypes.ENUM("bot", "usuario", "admin"),
        allowNull: false,
        defaultValue: "bot",
      },

      // ── Asesor asignado ────────────────────────────────────────
      asesorId: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      asesorNombre: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      asesorApellido: {
        type: DataTypes.STRING,
        allowNull: true,
      },

      // ── Datos extra ────────────────────────────────────────────
      motivo: {
        // Por qué se descartó o cerró
        type: DataTypes.TEXT,
        allowNull: true,
      },
      notas: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      calificado: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
    },
    {
      timestamps: true,
    },
  );
};
