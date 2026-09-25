const { DataTypes } = require("sequelize");

module.exports = sequelize => {
  sequelize.define(
    "EventoCalendario",
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },

      titulo: {
        type: DataTypes.STRING,
        allowNull: false,
      },

      tipo: {
        type: DataTypes.ENUM(
          "visita",
          "llamada",
          "reunion",
          "entrega",
          "mecanico",
          "inspeccion",
          "otro",
        ),
        allowNull: false,
        defaultValue: "visita",
      },

      // Solo cuando tipo === "otro"
      tipoPersonalizado: {
        type: DataTypes.STRING,
        allowNull: true,
      },

      fecha: {
        type: DataTypes.DATEONLY,
        allowNull: false,
      },

      horaInicio: {
        type: DataTypes.STRING, // "HH:MM"
        allowNull: false,
      },

      estado: {
        type: DataTypes.ENUM("pendiente", "confirmada", "realizada", "cancelada"),
        defaultValue: "pendiente",
      },

      // Datos del cliente
      clienteNombre: {
        type: DataTypes.STRING,
        allowNull: true,
      },

      clienteApellido: {
        type: DataTypes.STRING,
        allowNull: true,
      },

      clienteTelefono: {
        type: DataTypes.STRING,
        allowNull: true,
      },

      vehiculo: {
        type: DataTypes.STRING,
        allowNull: true,
      },

      // Responsable del evento (vendedor o supervisor — siempre un User)
      usuarioId: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },

      usuarioNombre: {
        type: DataTypes.STRING,
        allowNull: true,
      },

      // IDs de usuarios invitados — array serializado: [1, 3]
      invitadosIds: {
        type: DataTypes.TEXT,
        allowNull: true,
        defaultValue: "[]",
        get() {
          const raw = this.getDataValue("invitadosIds");
          try {
            return JSON.parse(raw);
          } catch {
            return [];
          }
        },
        set(val) {
          this.setDataValue(
            "invitadosIds",
            JSON.stringify(Array.isArray(val) ? val.map(Number) : []),
          );
        },
      },

      notas: {
        type: DataTypes.TEXT,
        allowNull: true,
      },

      notasFinalizacion: {
        type: DataTypes.TEXT,
        allowNull: true,
      },

      // Quién creó el evento
      creadoPorId: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },

      creadoPorRol: {
        type: DataTypes.ENUM("admin", "supervisor", "vendedor", "publicador_vendedor", "socio"),
        allowNull: false,
        defaultValue: "vendedor",
      },

      // FK opcional hacia Consulta — null si el evento no viene de una consulta
      consultaId: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },

      // FK opcional hacia Conversacion — null si todavía no hay chat de WhatsApp
      // para el teléfono del cliente. A diferencia de consultaId (que solo se
      // completa cuando se generó una Consulta formal), esto se linkea apenas
      // existe una conversación real, para que "ver chat" sea confiable.
      conversacionId: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },

      esperandoConfirmacion: {
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
