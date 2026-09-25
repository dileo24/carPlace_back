const { DataTypes } = require("sequelize");

// Registro de cada publicación externa (por ahora solo MercadoLibre) hecha
// desde un auto del stock. "plataforma" queda como string libre (no ENUM) a
// propósito, para poder sumar otras plataformas más adelante sin migración.
module.exports = sequelize => {
  sequelize.define(
    "Publicacion",
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      // Nullable a propósito: si se borra el auto del stock y la publicación
      // en MercadoLibre no se pudo eliminar (ej. ML caído en ese momento),
      // esta fila queda viva igual (con autoId en null) en vez de perderse
      // en cascada — así sigue apareciendo en el CRM y se puede gestionar.
      autoId: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      plataforma: {
        type: DataTypes.STRING,
        allowNull: false,
        defaultValue: "mercadolibre",
      },
      externalId: {
        // ID del item en la plataforma externa (ej. "MLA2060424517")
        type: DataTypes.STRING,
        allowNull: true,
      },
      permalink: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      // "cerrada" = finalizada en ML (status:closed, queda como "Inactiva" en
      // su panel, se puede seguir viendo en el historial). "eliminada" =
      // además marcada deleted:true, sale del todo del listado de ML. Son
      // dos acciones distintas que el admin puede elegir por separado.
      estado: {
        type: DataTypes.ENUM("publicada", "pausada", "cerrada", "eliminada", "error"),
        allowNull: false,
        defaultValue: "publicada",
      },
      tituloUsado: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      // Descripción tal cual la dejó/editó el admin — nunca se pisa sola con
      // una sincronización automática (ver mercadolibreListingsService.js).
      descripcionUsada: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      publicadoEn: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      // publicadoEn + 60 días — el cronjob de expiración se guía por esto.
      expiraEn: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      ultimoErrorMensaje: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
    },
    {
      timestamps: true,
    },
  );
};
