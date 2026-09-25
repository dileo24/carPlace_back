const https = require("https");
const http = require("http");

const URL_REGEX = /https?:\/\/[^\s]+/i;

function fetchHtml(url) {
  return new Promise((resolve) => {
    const client = url.startsWith("https") ? https : http;
    const req = client.get(url, { 
      headers: { "User-Agent": "Mozilla/5.0" },
      timeout: 5000 
    }, (res) => {
      let data = "";
      res.on("data", (chunk) => { data += chunk; });
      res.on("end", () => resolve(data));
    });
    req.on("error", () => resolve(null));
    req.on("timeout", () => { req.destroy(); resolve(null); });
  });
}

function extraerMetaTags(html) {
  const get = (pattern) => {
    const match = html.match(pattern);
    return match ? match[1].trim() : null;
  };

  const titulo =
    get(/<meta[^>]*property="og:title"[^>]*content="([^"]+)"/i) ||
    get(/<meta[^>]*content="([^"]+)"[^>]*property="og:title"/i) ||
    get(/<title>([^<]+)<\/title>/i);

  const descripcion =
    get(/<meta[^>]*property="og:description"[^>]*content="([^"]+)"/i) ||
    get(/<meta[^>]*content="([^"]+)"[^>]*property="og:description"/i) ||
    get(/<meta[^>]*name="description"[^>]*content="([^"]+)"/i);

  return { titulo, descripcion };
}

async function enriquecerTextoConUrl(texto) {
  const match = texto.match(URL_REGEX);
  if (!match) return texto; // no hay URL, devolver tal cual

  const url = match[0];
  const resto = texto.replace(url, "").trim();

  try {
    const html = await fetchHtml(url);
    if (!html) throw new Error("sin respuesta");

    const { titulo, descripcion } = extraerMetaTags(html);

    if (!titulo && !descripcion) throw new Error("sin meta tags");

    const contexto = [titulo, descripcion].filter(Boolean).join(" — ");
    const prefijo = resto ? `${resto}\n` : "";
    return `${prefijo}[El cliente mandó este link: ${url}\nContenido: ${contexto}]`;

  } catch (_) {
    const prefijo = resto ? `${resto}\n` : "";
    return `${prefijo}[El cliente mandó un link que no pude leer: ${url}. Pedile que te cuente qué auto le interesa.]`;
  }
}

module.exports = { enriquecerTextoConUrl };