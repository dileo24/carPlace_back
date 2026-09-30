const { DataTypes } = require("sequelize");

module.exports = sequelize => {
  sequelize.define(
    "Auto",
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        unique: true,
        autoIncrement: true,
      },
      marca: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      modelo: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      patente: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      motor: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      anio: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      km: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      transmision: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      combustible: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      moneda: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      // Nullable a propósito: un 0km sin precio cargado muestra "Consultar
      // precio" en el sitio público en vez de romper con un valor inventado.
      precio: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      destacar: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      oferta: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      oferta_reventa: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      notas_reventa: {
        type: DataTypes.TEXT,
        allowNull: true,
        defaultValue: null,
      },
      precio_oferta: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      color: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      precio_contado: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      en_alistaje: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      img: {
        type: DataTypes.JSON,
        allowNull: true,
        defaultValue: [],
      },
      visible: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },
      tipo: {
        type: DataTypes.ENUM("patrimonio", "consignacion", "consignacion_online"),
        allowNull: true,
      },
      estado: {
        type: DataTypes.ENUM("disponible", "senado", "vendido", "no_disponible"),
        allowNull: false,
        defaultValue: "disponible",
      },
      fecha_recepcion: {
        type: DataTypes.DATEONLY,
        allowNull: true,
      },
      precio_info_mes_anterior: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      precio_info_mes_actual: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      // Cuándo se cargó/confirmó precio_info_mes_actual por última vez — el
      // cron de rotación (rotarPrecioInfo.js) lo usa para no pisar un valor
      // que el admin ya cargó este mes cuando el catch-up dispara tarde.
      precio_info_actualizado_en: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      precio_cliente: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      // STRING (no ENUM): puede guardar más de una tracción combinada
      // (ej. "4x4 + 4x2"), igual que combustible/transmisión.
      traccion: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      notas: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      // Posición fija dentro del catálogo público — se asigna una sola vez
      // (al crear el auto, o en el backfill inicial) y nunca se recalcula,
      // para que el orden "aleatorio" del catálogo no cambie en cada visita.
      orden_aleatorio: {
        type: DataTypes.FLOAT,
        allowNull: true,
      },
      fecha_compra: {
        type: DataTypes.DATEONLY,
        allowNull: true,
      },
      precio_compra: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      // Quién es dueño del auto a efectos de ganancia/patrimonio: la agencia,
      // un socio (100%), o compartido 50/50 entre agencia y socio.
      propietario: {
        type: DataTypes.ENUM("agencia", "socio", "compartido"),
        allowNull: false,
        defaultValue: "agencia",
      },
    },
    {
      timestamps: false,
    },
  );
};
