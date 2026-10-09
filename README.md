# Huellas del Valle: sistema de agendamiento

Sitio estático (HTML, CSS y JavaScript, sin dependencias) para la Clínica Veterinaria
Huellas del Valle S.A.S. Se conecta con dos piezas:

- **Make, escenario 1 "Agendar cita"**: el formulario envía la solicitud a su webhook y
  muestra lo que el proceso respondió (confirmada, con alerta, rechazada, respaldo o
  requiere confirmación).
- **Google Sheets**: las vistas de cupos y de agenda del día leen las hojas `agenda` y
  `citas`, las mismas que escribe Make.

## Archivos

| Archivo | Qué contiene |
|---|---|
| `index.html` | Estructura de las dos vistas y la ventana de confirmación |
| `styles.css` | Diseño: colores, tipografía y versión para celular |
| `app.js` | Envío al webhook, lectura de la hoja y armado de las vistas |
| `assets/banner.jpg` | Imagen de la portada (sirve también para los correos) |

## Configuración

Al inicio de `app.js`, en `CONFIG`:

- `URL_WEBHOOK`: webhook del escenario 1.
- `ID_HOJA`: ID de la hoja de cálculo.

La hoja debe estar compartida como **Cualquier persona con el enlace: Lector**
para que el sitio pueda leerla.

## Publicar en Vercel

1. Crear un repositorio en GitHub y subir estos archivos.
2. En vercel.com: Add New → Project → elegir el repositorio → Deploy.
3. Cada cambio que se suba al repositorio se publica solo.
