// Migración manual, de un solo uso, para el perfil "socio" (Carlos).
// No hay tooling de migraciones en este proyecto (ver src/index.js: conn.sync()
// crea tablas nuevas pero nunca altera las existentes), así que este script usa
// queryInterface directamente. Es idempotente: cada paso chequea el estado
// actual de la tabla antes de tocarla, así se puede correr más de una vez sin
// romper nada si se corta a mitad de camino.
//
// Uso: node scripts/migrate-socio-feature.js

const { conn } = require("../src/db");

const ENUM_PROPIETARIO = "ENUM('agencia','socio','compartido')";

async function run() {
  const qi = conn.getQueryInterface();

  const autosDesc = await qi.describeTable("Autos");
  if (!autosDesc.fecha_compra) {
    console.log("Autos.fecha_compra: agregando...");
    await qi.addColumn("Autos", "fecha_compra", { type: "DATE" });
  } else {
    console.log("Autos.fecha_compra: ya existe, salteo.");
  }
  if (!autosDesc.precio_compra) {
    console.log("Autos.precio_compra: agregando...");
    await qi.addColumn("Autos", "precio_compra", { type: "INTEGER" });
  } else {
    console.log("Autos.precio_compra: ya existe, salteo.");
  }
  if (!autosDesc.propietario) {
    console.log("Autos.propietario: agregando...");
    await qi.sequelize.query(
      `ALTER TABLE Autos ADD COLUMN propietario ${ENUM_PROPIETARIO} NOT NULL DEFAULT 'agencia'`,
    );
  } else {
    console.log("Autos.propietario: ya existe, salteo.");
  }

  const alistajeDesc = await qi.describeTable("AutoTareaAlistajes");
  if (!alistajeDesc.precio) {
    console.log("AutoTareaAlistajes.precio: agregando...");
    await qi.addColumn("AutoTareaAlistajes", "precio", { type: "INTEGER" });
  } else {
    console.log("AutoTareaAlistajes.precio: ya existe, salteo.");
  }

  const ventasDesc = await qi.describeTable("Venta");
  if (!ventasDesc.autoId) {
    console.log("Ventas.autoId: agregando...");
    await qi.addColumn("Venta", "autoId", { type: "INTEGER" });
  } else {
    console.log("Ventas.autoId: ya existe, salteo.");
  }
  if (!ventasDesc.propietarioAuto) {
    console.log("Ventas.propietarioAuto: agregando...");
    await qi.sequelize.query(
      `ALTER TABLE Venta ADD COLUMN propietarioAuto ${ENUM_PROPIETARIO} NOT NULL DEFAULT 'agencia'`,
    );
  } else {
    console.log("Ventas.propietarioAuto: ya existe, salteo.");
  }
  if (!ventasDesc.fechaCompra) {
    console.log("Ventas.fechaCompra: agregando...");
    await qi.addColumn("Venta", "fechaCompra", { type: "DATE" });
  } else {
    console.log("Ventas.fechaCompra: ya existe, salteo.");
  }
  if (!ventasDesc.precioCompra) {
    console.log("Ventas.precioCompra: agregando...");
    await qi.addColumn("Venta", "precioCompra", { type: "INTEGER" });
  } else {
    console.log("Ventas.precioCompra: ya existe, salteo.");
  }
  if (!ventasDesc.gastos) {
    console.log("Ventas.gastos: agregando...");
    await qi.addColumn("Venta", "gastos", { type: "INTEGER" });
  } else {
    console.log("Ventas.gastos: ya existe, salteo.");
  }
  if (!ventasDesc.gastosDetalle) {
    console.log("Ventas.gastosDetalle: agregando...");
    await qi.addColumn("Venta", "gastosDetalle", { type: "JSON" });
  } else {
    console.log("Ventas.gastosDetalle: ya existe, salteo.");
  }
  if (!ventasDesc.ganancia) {
    console.log("Ventas.ganancia: agregando...");
    await qi.addColumn("Venta", "ganancia", { type: "INTEGER" });
  } else {
    console.log("Ventas.ganancia: ya existe, salteo.");
  }

  const usersDesc = await qi.describeTable("Users");
  if (!usersDesc.color) {
    console.log("Users.color: agregando...");
    await qi.addColumn("Users", "color", { type: "VARCHAR(255)" });
  } else {
    console.log("Users.color: ya existe, salteo.");
  }
  // rol es un ENUM que ya existe: agregar un valor nuevo requiere redefinir
  // la columna entera (MODIFY COLUMN), no un addColumn.
  if (!usersDesc.rol.type.includes("socio")) {
    console.log("Users.rol: agregando 'socio' al ENUM...");
    await qi.sequelize.query(
      `ALTER TABLE Users MODIFY COLUMN rol ENUM('supervisor','vendedor','publicador_vendedor','socio') NOT NULL`,
    );
  } else {
    console.log("Users.rol: 'socio' ya está en el ENUM, salteo.");
  }

  const eventosDesc = await qi.describeTable("EventoCalendarios");
  if (!eventosDesc.creadoPorRol.type.includes("socio")) {
    console.log("EventoCalendarios.creadoPorRol: agregando 'socio' al ENUM...");
    await qi.sequelize.query(
      `ALTER TABLE EventoCalendarios MODIFY COLUMN creadoPorRol ENUM('admin','supervisor','vendedor','publicador_vendedor','socio') NOT NULL DEFAULT 'vendedor'`,
    );
  } else {
    console.log("EventoCalendarios.creadoPorRol: 'socio' ya está en el ENUM, salteo.");
  }

  console.log("Listo.");
}

run()
  .catch(err => {
    console.error("Migración falló:", err);
    process.exitCode = 1;
  })
  .finally(() => conn.close());
