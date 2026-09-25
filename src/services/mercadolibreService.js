const axios = require("axios");
const jwt = require("jsonwebtoken");
const { MercadoLibreCuenta } = require("../db");

// Dominio de login/autorización (por país) vs. dominio de la API (siempre
// api.mercadolibre.com sin importar el país del vendedor).
const AUTH_URL = "https://auth.mercadolibre.com.ar/authorization";
const TOKEN_URL = "https://api.mercadolibre.com/oauth/token";

const CLIENT_ID = process.env.ML_CLIENT_ID;
const CLIENT_SECRET = process.env.ML_CLIENT_SECRET;
const REDIRECT_URI = process.env.ML_REDIRECT_URI;

// El callback de ML lo pega el navegador directo (redirect), sin el header
// Authorization que usa el resto del panel admin — por eso el "state" viaja
// como JWT propio: lo firmamos al armar la URL de autorización y lo
// verificamos al volver, para confirmar que el callback corresponde a un
// intento de conexión que arrancó un admin autenticado, sin necesitar guardar
// nada en el medio (ni sesión, ni tabla temporal).
const STATE_PURPOSE = "ml_oauth_state";

function getAuthUrl() {
  const state = jwt.sign({ purpose: STATE_PURPOSE }, process.env.JWT_SECRET, {
    expiresIn: "10m",
  });

  const params = new URLSearchParams({
    response_type: "code",
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    state,
  });

  return `${AUTH_URL}?${params.toString()}`;
}

function verificarState(state) {
  try {
    const decoded = jwt.verify(state, process.env.JWT_SECRET);
    return decoded.purpose === STATE_PURPOSE;
  } catch {
    return false;
  }
}

// Guarda (o actualiza) la cuenta conectada a partir de la respuesta de ML,
// que es el mismo shape tanto para el alta (authorization_code) como para el
// refresh (refresh_token).
async function obtenerNickname(accessToken) {
  try {
    const { data } = await axios.get("https://api.mercadolibre.com/users/me", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    return data.nickname || null;
  } catch {
    // No es crítico — si falla, seguimos sin nickname y no rompemos la conexión.
    return null;
  }
}

async function guardarTokens(data) {
  const expiraEn = new Date(Date.now() + data.expires_in * 1000);
  const nickname = await obtenerNickname(data.access_token);

  const [cuenta] = await MercadoLibreCuenta.findOrCreate({
    where: { mlUserId: String(data.user_id) },
    defaults: {
      mlUserId: String(data.user_id),
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      scope: data.scope || null,
      nickname,
      expiraEn,
    },
  });

  await cuenta.update({
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    scope: data.scope || null,
    nickname: nickname || cuenta.nickname,
    expiraEn,
  });

  return cuenta;
}

async function intercambiarCodigoPorToken(code) {
  const { data } = await axios.post(
    TOKEN_URL,
    new URLSearchParams({
      grant_type: "authorization_code",
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      code,
      redirect_uri: REDIRECT_URI,
    }),
    { headers: { "Content-Type": "application/x-www-form-urlencoded" } },
  );

  return guardarTokens(data);
}

async function refrescarToken(cuenta) {
  const { data } = await axios.post(
    TOKEN_URL,
    new URLSearchParams({
      grant_type: "refresh_token",
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      refresh_token: cuenta.refreshToken,
    }),
    { headers: { "Content-Type": "application/x-www-form-urlencoded" } },
  );

  return guardarTokens(data);
}

// Punto de entrada que va a usar el resto del código (publicar, actualizar,
// pausar) para conseguir un access_token vigente sin preocuparse por el
// vencimiento — refresca solo si falta menos de 5 minutos para que expire.
async function obtenerAccessTokenValido() {
  const cuenta = await MercadoLibreCuenta.findOne({ order: [["id", "DESC"]] });
  if (!cuenta) return null;

  const faltaPoco = cuenta.expiraEn.getTime() - Date.now() < 5 * 60 * 1000;
  if (!faltaPoco) return cuenta.accessToken;

  const actualizada = await refrescarToken(cuenta);
  return actualizada.accessToken;
}

async function obtenerEstadoConexion() {
  const cuenta = await MercadoLibreCuenta.findOne({ order: [["id", "DESC"]] });
  if (!cuenta) return { conectado: false };

  return {
    conectado: true,
    mlUserId: cuenta.mlUserId,
    nickname: cuenta.nickname,
    conectadoDesde: cuenta.createdAt,
  };
}

// Borra la cuenta conectada (sistema mono-cuenta, así que es simplemente
// vaciar la tabla). No revoca el permiso del lado de ML — eso lo puede hacer
// el propio vendedor desde su cuenta si quiere, pero no es necesario para
// que nuestro sistema quede "desconectado".
async function desconectarCuenta() {
  await MercadoLibreCuenta.destroy({ where: {} });
}

module.exports = {
  getAuthUrl,
  verificarState,
  intercambiarCodigoPorToken,
  obtenerAccessTokenValido,
  obtenerEstadoConexion,
  desconectarCuenta,
};
