const cfg = require('./config.js');
const API = "https://api.telegram.org/bot" + cfg.BOT_TOKEN;
const CLIENTES = require('../clientes.json');

const estados = {};          // flujo de reporte por chat_id
const cerrados = {};         // reportes cerrados {codigo: {token, chatCliente}}
const tickets = {};          // token → { codigo, chatCliente, nombre, problema, fecha }

async function tg(metodo, body) {
  const r = await fetch(API + "/" + metodo, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  return r.json();
}
async function enviar(chat_id, texto, extras) {
  return tg("sendMessage", Object.assign({ chat_id, text: texto, parse_mode: "HTML" }, extras || {}));
}
async function avisarAdmin(texto) {
  await enviar(cfg.ADMIN_ID, texto);
  await enviar(cfg.CHAT_REPORTES, texto);
}
async function logSistema(texto) {
  await enviar(cfg.CHAT_SISTEMA, texto);
}
function normalizar(s) {
  return (s || "").trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(200).json({ ok: true });
  try {
    const update = req.body || {};
    const msg = update.message;
    if (!msg) return res.status(200).json({ ok: true });

    const chat_id = msg.chat.id;
    const texto = (msg.text || "").trim();
    const foto = msg.photo;

    // ===== COMANDOS DEL ADMIN =====
    if (chat_id === Number(cfg.ADMIN_ID) || String(chat_id) === String(cfg.ADMIN_ID)) {

      // /responder CODIGO texto
      if (texto.startsWith("/responder ")) {
        const resto = texto.replace("/responder", "").trim();
        const partes = resto.split(" ");
        const codigo = partes[0].toUpperCase();
        const msgTexto = resto.substring(codigo.length).trim();
        if (!CLIENTES[codigo]) { await enviar(chat_id, "⚠️ Código " + codigo + " no existe."); return res.status(200).json({ok:true}); }
        // buscar chatCliente del ticket
        let chatCliente = null;
        for (const t in tickets) {
          if (tickets[t].codigo === codigo) chatCliente = tickets[t].chatCliente;
        }
        if (!chatCliente) { await enviar(chat_id, "⚠️ No hay ticket activo de " + codigo + ". Pide al cliente que reporte primero."); return res.status(200).json({ok:true}); }
        await enviar(chatCliente, "💬 <b>Asesor:</b>\n" + msgTexto);
        await enviar(chat_id, "✅ Enviado a " + codigo);
        await logSistema("💬 Respuesta a " + codigo + ": " + msgTexto.substring(0, 50));
        return res.status(200).json({ ok: true });
      }

      // /cerrar CODIGO
      if (texto.startsWith("/cerrar ")) {
        const codigo = texto.replace("/cerrar", "").trim().toUpperCase();
        let chatCliente = null, token = null;
        for (const t in tickets) {
          if (tickets[t].codigo === codigo) { chatCliente = tickets[t].chatCliente; token = t; }
        }
        if (!chatCliente) { await enviar(chat_id, "⚠️ No hay ticket abierto de " + codigo + "."); return res.status(200).json({ok:true}); }
        await enviar(chatCliente,
          "✅ <b>Tu caso ha sido cerrado.</b>\n\n" +
          "¡Gracias por tu reporte!\n\n" +
          "Si vuelves a tener problemas, escribe /reporte.");
        await enviar(chat_id, "✅ Ticket " + token + " cerrado.");
        await logSistema("✅ Caso " + codigo + " cerrado (" + token + ")");
        // borrar
        for (const t in tickets) { if (tickets[t].codigo === codigo) delete tickets[t]; }
        return res.status(200).json({ ok: true });
      }

      // /tickets (ver activos)
      if (texto === "/tickets") {
        const list = Object.keys(tickets).map(function(k){
          const t = tickets[k];
          return "• " + t.codigo + " (" + t.nombre + ") — " + t.fecha;
        });
        await enviar(chat_id, "📋 <b>Tickets activos:</b>\n" + (list.length ? list.join("\n") : "_ sin tickets"));
        return res.status(200).json({ ok: true });
      }
    }

    // ===== ENCUESTA (respuesta 1-5 después de un reporte) =====
    const estActual = estados[chat_id];
    if (estActual && estActual.encuesta && /^[1-5]$/.test(texto)) {
      const estrellas = "⭐".repeat(Number(texto));
      await logSistema("⭐ <b>Encuesta</b> de " + estActual.encuesta.nombre + "\n" + estrellas + " (" + texto + "/5)");
      await enviar(chat_id, "🙏 ¡Gracias por tu calificación!");
      delete estados[chat_id];
      return res.status(200).json({ ok: true });
    }

    // ===== /start =====
    if (texto === "/start" || texto.startsWith("/start ")) {
      const token = texto.startsWith("/start ") ? texto.replace("/start", "").trim().toUpperCase() : "";
      if (token && CLIENTES[token]) {
        const c = CLIENTES[token];
        estados[chat_id] = { paso: 0, datos: { codigo: token }, en_flujo: true };
        await enviar(chat_id,
          "👋 <b>Hola, " + c.nombre.split(" ")[0] + "</b>\n\n" +
          "Para validar tu identidad, escribe tu <b>nombre completo</b> tal como te registraste:");
      } else if (token && !CLIENTES[token]) {
        await enviar(chat_id, "⚠️ El link no está registrado. Contacta a tu proveedor.");
      } else {
        estados[chat_id] = { paso: -1, datos: {}, en_flujo: false };
        await enviar(chat_id, "👋 Hola, soy el asistente de soporte.\n\nEscribe tu <b>URL asignada</b> (ej: G7X4K9):");
      }
      return res.status(200).json({ ok: true });
    }

    // ===== /reporte =====
    if (texto === "/reporte") {
      estados[chat_id] = { paso: -1, datos: {}, en_flujo: false };
      await enviar(chat_id, "Escribe tu <b>URL asignada</b> (ej: G7X4K9):");
      return res.status(200).json({ ok: true });
    }

    // ===== /asesor =====
    if (texto === "/asesor" || texto === "asesor") {
      const e = estados[chat_id];
      const nombre = e && e.datos && e.datos.nombre ? e.datos.nombre : "Cliente";
      const codigo = e && e.datos && e.datos.codigo ? e.datos.codigo : "???";
      await avisarAdmin("🆘 <b>CLIENTE PIDE ASESOR</b>\n" +
        "👤 " + nombre + " (" + codigo + ")\n" +
        "🆔 Chat: " + chat_id + "\n" +
        "🕐 " + new Date().toLocaleString("es-MX") + "\n\n" +
        "Responde: /responder " + codigo + " tu mensaje");
      await enviar(chat_id, "⏳ Un asesor se pondrá en contacto contigo en un momento.");
      await logSistema("🆘 Asesor solicitado por " + codigo);
      return res.status(200).json({ ok: true });
    }

    // ===== /cancelar =====
    if (texto === "/cancelar") {
      delete estados[chat_id];
      await enviar(chat_id, "❌ Cancelado.");
      return res.status(200).json({ ok: true });
    }

    // ===== FLUJO =====
    const estado = estados[chat_id];
    if (!estado) {
      await enviar(chat_id, "Escribe /start o /reporte para iniciar.");
      return res.status(200).json({ ok: true });
    }

    // Paso -1: pidiendo URL
    if (estado.paso === -1) {
      const codigo = texto.toUpperCase();
      if (!CLIENTES[codigo]) {
        await enviar(chat_id, "⚠️ URL no registrada. Intenta de nuevo:");
        return res.status(200).json({ ok: true });
      }
      estado.datos.codigo = codigo;
      estado.paso = 0;
      estado.en_flujo = true;
      await enviar(chat_id, "Escribe tu <b>nombre completo</b> tal como te registraste:");
      return res.status(200).json({ ok: true });
    }

    const cliente = CLIENTES[estado.datos.codigo];
    if (!cliente) {
      await enviar(chat_id, "⚠️ Error de sesión. Escribe /start.");
      delete estados[chat_id];
      return res.status(200).json({ ok: true });
    }

    // Paso 0: nombre
    if (estado.paso === 0) {
      if (normalizar(texto) !== normalizar(cliente.nombre)) {
        await enviar(chat_id, "⚠️ <b>Nombre incorrecto.</b> Usa el nombre exacto con el que te registraste.\n\nIntenta de nuevo:");
        return res.status(200).json({ ok: true });
      }
      estado.datos.nombre = cliente.nombre;
      estado.paso = 1;
      await enviar(chat_id, "✅ Nombre verificado.\n\nAhora escribe tu <b>correo electrónico</b> registrado:");
      return res.status(200).json({ ok: true });
    }

    // Paso 1: correo
    if (estado.paso === 1) {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(texto)) {
        await enviar(chat_id, "⚠️ Correo no válido. Intenta de nuevo:");
        return res.status(200).json({ ok: true });
      }
      if (normalizar(texto) !== normalizar(cliente.correo)) {
        await enviar(chat_id, "⚠️ <b>Correo incorrecto.</b> Usa el correo con el que te registraste.\n\nIntenta de nuevo:");
        return res.status(200).json({ ok: true });
      }
      estado.datos.correo = cliente.correo;
      estado.paso = 2;
      await enviar(chat_id, "✅ Correo verificado.\n\nDescribe el <b>problema</b> que tienes:");
      return res.status(200).json({ ok: true });
    }

    // Paso 2: problema
    if (estado.paso === 2) {
      if (!texto || texto.length < 5) {
        await enviar(chat_id, "⚠️ Describe un poco más el problema:");
        return res.status(200).json({ ok: true });
      }
      estado.datos.problema = texto;
      estado.paso = 3;
      await enviar(chat_id, "📷 <b>Manda una foto</b> del error (obligatoria):");
      return res.status(200).json({ ok: true });
    }

    // Paso 3: foto + crear ticket
    if (estado.paso === 3) {
      if (!foto) {
        await enviar(chat_id, "⚠️ Necesito una <b>foto</b>. Mándala como imagen:");
        return res.status(200).json({ ok: true });
      }
      const ahora = new Date();
      const tokenRep = cliente.codigo + "-" + ahora.getTime().toString(36).toUpperCase();
      const d = estado.datos;

      // Guardar ticket
      tickets[tokenRep] = {
        codigo: cliente.codigo,
        chatCliente: chat_id,
        nombre: d.nombre,
        problema: d.problema,
        fecha: ahora.toLocaleString("es-MX")
      };

      const textoReporte =
        "📋 <b>REPORTE " + tokenRep + "</b>\n" +
        "━━━━━━━━━━━━━━━━━━\n" +
        "👤 <b>Nombre:</b> " + d.nombre + "\n" +
        "📧 <b>Correo:</b> " + d.correo + "\n" +
        "🔗 <b>Código:</b> " + cliente.codigo + "\n" +
        "📱 <b>Telegram:</b> @" + (msg.from.username || "(sin username)") + "\n" +
        "━━━━━━━━━━━━━━━━━━\n" +
        "📝 <b>Problema:</b>\n" + d.problema + "\n" +
        "━━━━━━━━━━━━━━━━━━\n" +
        "🕐 " + ahora.toLocaleString("es-MX");

      for (const chat of [cfg.CHAT_REPORTES, cfg.CHAT_COPIA, cfg.ADMIN_ID]) {
        await enviar(chat, textoReporte);
      }
      const largest = foto[foto.length - 1];
      for (const chat of [cfg.CHAT_REPORTES, cfg.CHAT_COPIA, cfg.ADMIN_ID]) {
        await tg("sendPhoto", { chat_id: chat, photo: largest.file_id, caption: "📷 Foto " + tokenRep, parse_mode: "HTML" });
      }

      // Confirmación al cliente
      await enviar(chat_id,
        "✅ <b>Reporte " + tokenRep + " recibido.</b>\n\n" +
        "Te responderemos <b>en menos de 24 horas.</b>\n\n" +
        "Si es <b>urgente</b>, escribe: /asesor\n\n" +
        "Mientras tanto puedes seguir usando tu página normalmente.");

      // Ahora encuesta (esperamos respuesta 1-5)
      estados[chat_id] = { encuesta: { nombre: d.nombre } };
      setTimeout(async function(){}, 1);
      await enviar(chat_id, "⭐ Antes de irte, ¿cómo calificas la atención?\n\n" +
        "1️⃣ = Muy mal\n2️⃣ = Mal\n3️⃣ = Regular\n4️⃣ = Bien\n5️⃣ = Excelente\n\n" +
        "Envía un número del 1 al 5:");

      await logSistema("🆕 Reporte " + tokenRep + " — " + d.nombre);
      return res.status(200).json({ ok: true });
    }

    return res.status(200).json({ ok: true });
  } catch (e) {
    try { await enviar(cfg.CHAT_SISTEMA, "⚠️ Error webhook: " + e.message); } catch (_) {}
    return res.status(200).json({ ok: false, error: e.message });
  }
}
