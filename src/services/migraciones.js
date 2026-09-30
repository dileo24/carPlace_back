// services/migraciones.js
// conn.sync() crea tablas nuevas pero nunca altera las existentes, y este
// proyecto no tiene tooling de migraciones. Este módulo agrega, al arrancar,
// las columnas nuevas de modelos que ya tenían tabla. Es idempotente: cada
// columna se chequea con describeTable antes de tocarla.
const { conn } = require("../db");

// Devuelve true si la columna tuvo que crearse en esta corrida.
async function asegurarColumna(modelName, atributo, log) {
  const modelo = conn.models[modelName];
  const tabla = modelo.getTableName();
  const qi = conn.getQueryInterface();
  const existentes = await qi.describeTable(tabla);
  if (existentes[atributo]) return false;

  await qi.addColumn(tabla, atributo, modelo.rawAttributes[atributo]);
  log(`Migración: ${tabla}.${atributo} agregada`);
  return true;
}

async function migrar(log = console.log) {
  // Stock: patente de cada auto.
  await asegurarColumna("Auto", "patente", log);

  // Ventas: snapshot del auto vendido (el Auto se destruye al vender).
  await asegurarColumna("Venta", "autoDatos", log);

  // Cuentas: tipos de deuda, punta "empresa", pagos parciales y saldado.
  const tipoNueva = await asegurarColumna("Deuda", "tipo", log);
  for (const atributo of [
    "deudorEmpresa",
    "acreedorEmpresa",
    "montoSaldado",
    "saldada",
    "saldadaEn",
    "pagos",
  ]) {
    await asegurarColumna("Deuda", atributo, log);
  }
  // Las deudas previas a esta migración con un tercero en alguna punta eran
  // "con terceros" → pasan a ser de empresa; las de socio a socio quedan internas.
  if (tipoNueva) {
    const tabla = conn.models.Deuda.getTableName();
    await conn.query(`UPDATE \`${tabla}\` SET tipo = 'empresa' WHERE deudorId IS NULL OR acreedorId IS NULL`);
  }
}

module.exports = { migrar };
