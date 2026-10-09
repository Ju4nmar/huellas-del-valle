/* =========================================================
   Huellas del Valle — lógica del sistema
   - Agendar: envía la solicitud al webhook del escenario 1 de Make
     y muestra lo que el proceso respondió.
   - Cupos y agenda del día: se leen de la misma hoja de Google Sheets
     que usa Make (hojas "agenda" y "citas").
   ========================================================= */

const CONFIG = {
  // Webhook del escenario 1 ("Agendar cita").
  URL_WEBHOOK: "https://hook.us2.make.com/621lvkthpfj2hglamfshk06wsblubvq0",
  // ID de la hoja de cálculo (la parte larga de su enlace).
  // La hoja debe estar compartida como "Cualquier persona con el enlace: Lector".
  ID_HOJA: "16CfNQX9BBYnN_-7ubEvoVWWWKyVYbaCW2ozadYSoLlk",
  // Horas en las que la clínica abre franjas.
  HORAS: ["08:00", "09:00", "10:00", "11:00"],
};

/* ---------------- Utilidades ---------------- */

const $ = (sel) => document.querySelector(sel);

// Crea un elemento con clase y texto. Se usa textContent para que
// ningún dato de la hoja se interprete como HTML.
function el(etiqueta, clase, texto) {
  const n = document.createElement(etiqueta);
  if (clase) n.className = clase;
  if (texto !== undefined) n.textContent = texto;
  return n;
}

// Fecha de hoy en Colombia, en formato AAAA-MM-DD.
function hoyBogota() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bogota" }).format(new Date());
}

// "2026-10-14" -> "miércoles 14 de octubre"
function fechaLarga(iso) {
  const [a, m, d] = iso.split("-").map(Number);
  return new Date(a, m - 1, d).toLocaleDateString("es-CO", { weekday: "long", day: "numeric", month: "long" });
}

// Convierte un texto CSV en una lista de objetos { columna: valor }.
function leerCSV(texto) {
  const filas = [];
  let fila = [], campo = "", comillas = false;
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (comillas) {
      if (c === '"' && texto[i + 1] === '"') { campo += '"'; i++; }
      else if (c === '"') comillas = false;
      else campo += c;
    } else if (c === '"') comillas = true;
    else if (c === ",") { fila.push(campo); campo = ""; }
    else if (c === "\n") { fila.push(campo); filas.push(fila); fila = []; campo = ""; }
    else if (c !== "\r") campo += c;
  }
  if (campo !== "" || fila.length) { fila.push(campo); filas.push(fila); }

  const [encabezados, ...datos] = filas;
  if (!encabezados) return [];
  const claves = encabezados.map((h) => h.trim().toLowerCase());
  return datos
    .filter((f) => f.some((v) => v.trim() !== ""))
    .map((f) => Object.fromEntries(claves.map((k, i) => [k, (f[i] || "").trim()])));
}

// Lee una pestaña de la hoja de cálculo como CSV (consulta de Google Sheets).
async function leerHoja(nombre) {
  const url = `https://docs.google.com/spreadsheets/d/${CONFIG.ID_HOJA}/gviz/tq` +
              `?tqx=out:csv&headers=1&sheet=${encodeURIComponent(nombre)}&t=${Date.now()}`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`La hoja "${nombre}" respondió ${r.status}`);
  return leerCSV(await r.text());
}

/* ---------------- Pestañas ---------------- */

const pestanas = { agendar: $("#tab-agendar"), agenda: $("#tab-agenda") };
const vistas   = { agendar: $("#vista-agendar"), agenda: $("#vista-agenda") };

function abrirVista(nombre) {
  for (const k of Object.keys(vistas)) {
    const activa = k === nombre;
    vistas[k].hidden = !activa;
    pestanas[k].setAttribute("aria-selected", String(activa));
  }
  if (nombre === "agenda") {
    // Si ya se eligió una fecha al agendar, la agenda abre en esa fecha.
    if (!agendaFecha.value) agendaFecha.value = form.fecha.value || hoyBogota();
    cargarAgenda();
  }
}
pestanas.agendar.addEventListener("click", () => abrirVista("agendar"));
pestanas.agenda.addEventListener("click", () => abrirVista("agenda"));

/* ---------------- Cupos del día (hoja "agenda") ---------------- */

const form        = $("#form-cita");
const listaFranjas = $("#lista-franjas");
const cuposFecha  = $("#cupos-fecha");

// Dibuja un círculo por cupo; los ocupados van rellenos.
function asientos(cupo, ocupados) {
  const caja = el("span", "asientos");
  caja.setAttribute("aria-hidden", "true");
  for (let i = 0; i < cupo; i++) {
    caja.append(el("span", "asiento" + (i < ocupados ? " asiento--ocupado" : "")));
  }
  return caja;
}

function textoLibres(libres) {
  if (libres <= 0) return "Llena";
  if (libres === 1) return "Queda 1";
  return `Quedan ${libres}`;
}

// Si se piden dos lecturas seguidas, solo se dibuja la más reciente.
let turnoCupos = 0;

async function cargarCupos() {
  const turno = ++turnoCupos;
  const fecha = form.fecha.value;
  listaFranjas.innerHTML = "";
  if (!fecha) {
    cuposFecha.textContent = "Elige una fecha para ver qué horas quedan libres.";
    return;
  }
  cuposFecha.textContent = `Consultando ${fechaLarga(fecha)}…`;

  let filas;
  try {
    filas = (await leerHoja("agenda")).filter((f) => f.fecha === fecha);
  } catch (e) {
    if (turno !== turnoCupos) return;
    cuposFecha.textContent = "No se pudo leer la agenda. Revisa que la hoja esté compartida como lector para cualquier persona con el enlace.";
    return;
  }

  if (turno !== turnoCupos) return;
  listaFranjas.innerHTML = "";
  cuposFecha.textContent = fechaLarga(fecha);
  if (!filas.length) {
    listaFranjas.append(el("li", "vacio", "No hay franjas abiertas para esta fecha. Puedes enviar la solicitud y quedará registrada para revisión."));
    return;
  }

  filas.sort((a, b) => a.hora.localeCompare(b.hora));
  for (const f of filas) {
    const cupo = parseInt(f.cupo, 10) || 0;
    const ocupados = parseInt(f.ocupados, 10) || 0;
    const libres = cupo - ocupados;

    const boton = el("button", "franja");
    boton.type = "button";
    if (libres <= 0) boton.classList.add("franja--llena");
    else if (libres === 1) boton.classList.add("franja--ultima");
    boton.dataset.hora = f.hora;
    boton.setAttribute("aria-pressed", String(form.hora.value === f.hora));
    boton.setAttribute("aria-label", `${f.hora}: ${ocupados} de ${cupo} cupos ocupados`);
    boton.append(el("span", "franja__hora", f.hora), asientos(cupo, ocupados), el("span", "franja__estado", textoLibres(libres)));

    // Elegir una franja llena también se permite: quien decide es el proceso en Make.
    boton.addEventListener("click", () => { form.hora.value = f.hora; marcarFranja(); });

    const li = el("li");
    li.append(boton);
    listaFranjas.append(li);
  }
}

// Resalta la franja que coincide con la hora elegida en el formulario.
function marcarFranja() {
  for (const b of listaFranjas.querySelectorAll(".franja")) {
    b.setAttribute("aria-pressed", String(b.dataset.hora === form.hora.value));
  }
}

form.fecha.addEventListener("change", cargarCupos);
form.hora.addEventListener("change", marcarFranja);

/* ---------------- Agendar (webhook del escenario 1) ---------------- */

const boton  = $("#btn-enviar");
const caja   = $("#respuesta");
const aviso  = $("#aviso-form");
const dlg    = $("#dlg-confirmar");
const dlgTxt = $("#dlg-texto");

// Muestra el resultado. tipo: "ok" | "alerta" | "error" | "info"
function mostrar(tipo, titulo, detalle) {
  caja.className = "respuesta " + tipo;
  caja.hidden = false;
  caja.innerHTML = "";
  caja.append(el("strong", "", titulo), el("p", "", detalle || ""));
}

// Traduce el "estado" que devuelve Make a un color.
function tipoSegunEstado(estado) {
  const e = (estado || "").toUpperCase();
  if (e.includes("ALERTA"))     return "alerta";
  if (e.includes("CONFIRMADA")) return "ok";
  if (e.includes("RECHAZADA"))  return "error";
  return "info"; // respaldo u otro resultado
}

// Revisa que estén los 7 campos antes de enviar.
function validar() {
  let primero = null;
  for (const campo of ["propietario", "correo", "mascota", "servicio", "fecha", "hora"]) {
    const n = form[campo];
    const malo = !n.value.trim() || (campo === "correo" && !n.checkValidity());
    n.setAttribute("aria-invalid", String(malo));
    if (malo && !primero) primero = n;
  }
  const especie = form.querySelector('input[name="especie"]:checked');
  if (!especie && !primero) primero = form.querySelector('input[name="especie"]');

  if (primero) {
    aviso.textContent = "Completa todos los campos para agendar. Revisa los marcados en rojo.";
    aviso.hidden = false;
    primero.focus();
    return false;
  }
  aviso.hidden = true;
  return true;
}

// Envía los 7 campos al webhook. Con confirmar = true agrega confirmar=si
// (segunda llamada del caso C5, cuando el usuario acepta la segunda cita).
async function enviar(confirmar) {
  const datos = new URLSearchParams(new FormData(form));
  if (confirmar) datos.append("confirmar", "si");

  // Se envía como formulario (x-www-form-urlencoded): Make lo separa en campos
  // y el navegador no necesita una verificación previa (preflight) de CORS.
  const r = await fetch(CONFIG.URL_WEBHOOK, { method: "POST", body: datos });
  const texto = await r.text();
  try { return JSON.parse(texto); }
  catch (_) { return { estado: "", mensaje: "Respuesta sin formato: " + texto }; }
}

function mostrarResultado(json) {
  if (json && json.estado) mostrar(tipoSegunEstado(json.estado), json.estado, json.mensaje);
  else mostrar("info", "Solicitud recibida", json ? json.mensaje : "");
  // La hoja tarda unos segundos en reflejar el cambio.
  setTimeout(cargarCupos, 1500);
}

function mostrarError(error) {
  mostrar("error", "No se pudo leer la respuesta",
    "La solicitud pudo haber llegado. Revisa el historial del escenario en Make antes de reintentar. Detalle: " + error.message);
}

// Primer envío: el escenario decide. Si la mascota ya tiene cita ese día,
// responde REQUIERE CONFIRMACION sin haber escrito nada, y se abre la ventana.
form.addEventListener("submit", async (evento) => {
  evento.preventDefault();
  if (!validar()) return;

  boton.disabled = true;
  boton.textContent = "Consultando cupo…";
  caja.hidden = true;
  try {
    const json = await enviar(false);
    if ((json.estado || "").toUpperCase().includes("REQUIERE CONFIRMACION")) {
      mostrar("alerta", "Falta tu confirmación", "Todavía no se ha agendado nada.");
      dlgTxt.textContent = json.mensaje || "Esta mascota ya tiene otra cita ese día. ¿Deseas agendar también esta?";
      dlg.showModal();
    } else {
      mostrarResultado(json);
    }
  } catch (error) {
    mostrarError(error);
  } finally {
    boton.disabled = false;
    boton.textContent = "Agendar cita";
  }
});

// Segundo envío: el usuario aceptó. Mismos datos + confirmar=si.
$("#btn-confirmar").addEventListener("click", async () => {
  dlg.close();
  boton.disabled = true;
  mostrar("info", "Agendando la segunda cita…", "");
  try { mostrarResultado(await enviar(true)); }
  catch (error) { mostrarError(error); }
  finally { boton.disabled = false; }
});

// No quiso la segunda cita: no se envía nada más.
$("#btn-cancelar").addEventListener("click", () => {
  dlg.close();
  mostrar("info", "Solicitud cancelada", "No se agendó ninguna cita.");
});

/* ---------------- Agenda del día (hojas "citas" y "agenda") ---------------- */

const agendaFecha   = $("#agenda-fecha");
const agendaLista   = $("#agenda-lista");
const agendaResumen = $("#agenda-resumen");

function claseEstado(resultado) {
  const r = (resultado || "").toUpperCase();
  if (r.includes("ALERTA")) return "estado estado--alerta";
  if (r.includes("CONFIRMADA")) return "estado estado--ok";
  return "estado estado--otro";
}

function nombreEstado(resultado) {
  const r = (resultado || "").toUpperCase();
  if (r === "CONFIRMADA CON ALERTA") return "Confirmada, franja casi llena";
  if (r === "CONFIRMADA") return "Confirmada";
  return resultado || "Sin estado";
}

let turnoAgenda = 0;

async function cargarAgenda() {
  const turno = ++turnoAgenda;
  const fecha = agendaFecha.value;
  agendaLista.innerHTML = "";
  if (!fecha) { agendaResumen.textContent = "Elige una fecha para ver sus citas."; return; }
  agendaResumen.textContent = `Consultando ${fechaLarga(fecha)}…`;

  let citas, franjas;
  try {
    [citas, franjas] = await Promise.all([leerHoja("citas"), leerHoja("agenda")]);
  } catch (e) {
    if (turno !== turnoAgenda) return;
    agendaResumen.textContent = "No se pudo leer la hoja. Revisa que esté compartida como lector para cualquier persona con el enlace.";
    return;
  }
  if (turno !== turnoAgenda) return;
  agendaLista.innerHTML = "";
  citas = citas.filter((c) => c.fecha === fecha);
  franjas = franjas.filter((f) => f.fecha === fecha);

  // Resumen en una frase: cuántas citas y qué franjas quedaron llenas.
  const llenas = franjas.filter((f) => (parseInt(f.cupo, 10) || 0) - (parseInt(f.ocupados, 10) || 0) <= 0).map((f) => f.hora);
  let resumen = citas.length === 0 ? "No hay citas agendadas" :
                citas.length === 1 ? "Hay 1 cita agendada" : `Hay ${citas.length} citas agendadas`;
  resumen += ` para el ${fechaLarga(fecha)}.`;
  if (llenas.length === 1) resumen += ` La franja de las ${llenas[0]} está llena.`;
  if (llenas.length > 1) {
    const horasTexto = llenas.slice(0, -1).map((h) => "las " + h).join(", ") + " y las " + llenas[llenas.length - 1];
    resumen += ` Están llenas las franjas de ${horasTexto}.`;
  }
  agendaResumen.textContent = resumen;

  if (!franjas.length && !citas.length) {
    agendaLista.append(el("p", "sin-citas", "Esta fecha no tiene franjas abiertas en la agenda."));
    return;
  }

  // Una tarjeta por hora: las de la agenda y cualquier otra que tenga citas.
  const horas = [...new Set([...franjas.map((f) => f.hora), ...citas.map((c) => c.hora)])].sort();
  for (const hora of horas) {
    const franja = franjas.find((f) => f.hora === hora);
    const deEstaHora = citas.filter((c) => c.hora === hora);

    const bloque = el("article", "bloque");
    const lado = el("div");
    lado.append(el("div", "bloque__hora", hora));
    if (franja) {
      const cupo = parseInt(franja.cupo, 10) || 0;
      const ocupados = parseInt(franja.ocupados, 10) || 0;
      const info = el("div", "bloque__cupo");
      info.append(el("span", "", `${ocupados} de ${cupo} cupos`), asientos(cupo, ocupados));
      if (cupo - ocupados <= 0) bloque.classList.add("bloque--llena");
      lado.append(info);
    }

    const lista = el("ul", "citas");
    if (!deEstaHora.length) {
      lista.append(el("li", "sin-citas", "Sin citas en esta franja."));
    }
    for (const c of deEstaHora) {
      const li = el("li", "cita");
      const nombre = el("div", "cita__mascota", c.mascota);
      if (c.especie) nombre.append(el("span", "", `, ${c.especie}`));
      const estado = el("div", "cita__estado");
      estado.append(el("span", claseEstado(c.resultado), nombreEstado(c.resultado)));
      li.append(nombre, el("div", "cita__detalle", `${c.servicio} para ${c.propietario}`), estado);
      lista.append(li);
    }

    bloque.append(lado, lista);
    agendaLista.append(bloque);
  }
}

agendaFecha.addEventListener("change", cargarAgenda);
$("#btn-actualizar").addEventListener("click", cargarAgenda);
