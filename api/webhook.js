const cfg = require('./config.js');
const API = "https://api.telegram.org/bot" + cfg.BOT_TOKEN;

// Estado de conversación por chat_id (en memoria, se resetea al redeploy)
const estados = {};

const PASOS = ["nombre", "correo", "url", "problema", "foto"];

async function enviar(chat_id, texto, extras) {
  const body = Object.assign({ chat_id, text: texto, parse_mode: "HTML" }, extras || {});
  await fetch(API + "/sendMessage", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}

async function enviarGrupo(token) {
  const msg = "🆕 <b>NUEVO REPORTE</b>\n<b>Código:</b> " + token;
  await fetch(API + "/sendMessage", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: cfg.CHAT_SISTEMA, text: msg, parse_mode: "HTML" })
  });
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(200).json({ ok: true });

  try {
    // Config: reportes van a REPORTES + COPIA + privado admin
    const update = req.body || {};
    const msg = update.message;
    if (!msg) return res.status(200).json({ ok: true });

    const chat_id = msg.chat.id;
    const texto = (msg.text || "").trim();
    const foto = msg.photo;

    // /start o /reporte → iniciar flujo
    if (texto === "/start" || texto === "/reporte" || texto.startsWith("/start ")) {
      // Extraer token de /start TOKEN
      let token = "";
      if (texto.startsWith("/start ")) {
        token = texto.replace("/start", "").trim().toUpperCase();
      }
      estados[chat_id] = { paso: 0, datos: { token_inicial: token } };
      await enviar(chat_id, "👋 <b>Hola, soy el asistente de soporte.</b>\n\n" +
        "Vamos a levantar tu reporte paso a paso.\n\n" +
        "1️⃣ ¿Cuál es tu <b>nombre completo</b>?");
      return res.status(200).json({ ok: true });
    }

    const estado = estados[chat_id];
    if (!estado) {
      await enviar(chat_id, "Escribe /reporte para iniciar un nuevo reporte, o /cancelar para cancelar.");
      return res.status(200).json({ ok: true });
    }

    // Cancelar
    if (texto === "/cancelar") {
      delete estados[chat_id];
      await enviar(chat_id, "❌ Reporte cancelado. Escribe /reporte cuando quieras.");
      return res.status(200).json({ ok: true });
    }

    const paso = PASOS[estado.paso];

    // Guardar según el paso
    if (paso === "nombre") {
      if (!texto) return res.status(200).json({ ok: true });
      estado.datos.nombre = texto;
      estado.paso++;
      await enviar(chat_id, "2️⃣ ¿Cuál es tu <b>correo electrónico</b>?");
    }
    else if (paso === "correo") {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(texto)) {
        await enviar(chat_id, "⚠️ Ese correo no parece válido. Mándalo de nuevo:");
        return res.status(200).json({ ok: true });
      }
      estado.datos.correo = texto;
      estado.paso++;
      await enviar(chat_id, "3️⃣ ¿Cuál es tu <b>URL asignada</b> (el código de tu página)?" +
        (estado.datos.token_inicial ? "\n\nEjemplo: <code>" + estado.datos.token_inicial + "</code>" : ""));
    }
    else if (paso === "url") {
      if (!texto) return res.status(200).json({ ok: true });
      estado.datos.url = texto.toUpperCase();
      estado.paso++;
      await enviar(chat_id, "4️⃣ Describe el <b>problema</b> que tienes:");
    }
    else if (paso === "problema") {
      if (!texto || texto.length < 5) {
        await enviar(chat_id, "⚠️ Describe un poco más el problema:");
        return res.status(200).json({ ok: true });
      }
      estado.datos.problema = texto;
      estado.paso++;
      await enviar(chat_id, "5️⃣ <b>Manda una foto</b> del error (obligatoria):");
    }
    else if (paso === "foto") {
      if (!foto) {
        await enviar(chat_id, "⚠️ Necesito una <b>foto</b> del error. Mándala como imagen:");
        return res.status(200).json({ ok: true });
      }
      // Reporte completo
      const ahora = new Date();
      const token = (estado.datos.url || "SIN-ID") + "-" + ahora.getTime().toString(36).toUpperCase();
      const d = estado.datos;
      const textoReporte =
        "📋 <b>REPORTE " + token + "</b>\n" +
        "━━━━━━━━━━━━━━━━━━\n" +
        "👤 <b>Nombre:</b> " + d.nombre + "\n" +
        "📧 <b>Correo:</b> " + d.correo + "\n" +
        "🔗 <b>URL:</b> " + d.url + "\n" +
        "📱 <b>Telegram:</b> @" + (msg.from.username || "(sin username)") + "\n" +
        "🆔 <b>Chat ID:</b> " + chat_id + "\n" +
        "━━━━━━━━━━━━━━━━━━\n" +
        "📝 <b>Problema:</b>\n" + d.problema + "\n" +
        "━━━━━━━━━━━━━━━━━━\n" +
        "🕐 <b>Fecha:</b> " + ahora.toLocaleString("es-MX");

      // Enviar texto a REPORTES + COPIA + privado admin
      for (const chat of [cfg.CHAT_REPORTES, cfg.CHAT_COPIA, cfg.ADMIN_ID]) {
        await enviar(chat, textoReporte);
      }

      // Reenviar la foto a REPORTES + COPIA + ADMIN
      const largest = foto[foto.length - 1];
      for (const chat of [cfg.CHAT_REPORTES, cfg.CHAT_COPIA, cfg.ADMIN_ID]) {
        await fetch(API + "/sendPhoto", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: chat,
            photo: largest.file_id,
            caption: "📷 Foto del reporte " + token,
            parse_mode: "HTML"
          })
        });
      }

      // Confirmación al cliente
      await enviar(chat_id, "✅ <b>Reporte " + token + " recibido.</b>\n" +
        "Te responderemos a la brevedad.\n\n" +
        "Si quieres otro reporte, escribe /reporte.");

      // Log interno
      await enviarGrupo(token);

      delete estados[chat_id];
    }

    return res.status(200).json({ ok: true });
  } catch (e) {
    try {
      await fetch(API + "/sendMessage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: cfg.CHAT_SISTEMA, text: "⚠️ Error webhook: " + e.message, parse_mode: "HTML" })
      });
    } catch (_) {}
    return res.status(200).json({ ok: false, error: e.message });
  }
}
