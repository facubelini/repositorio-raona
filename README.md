# Repositorio Raona

Repositorio de proyectos realizados con clientes. Sitio estático (sin backend, sin build), publicado en GitHub Pages, con identidad visual de Raona.

Sitio: https://facubelini.github.io/repositorio-raona/

## Qué tiene

- Grilla de proyectos con imagen, cliente, solución, descripción, tecnologías y adjuntos descargables.
- Filtros combinables por **Cliente** y por **Solución**, más buscador de texto libre.
- Modo editor: alta, edición y borrado de proyectos, con carga de imágenes y adjuntos (cualquier tipo de archivo) directo desde el navegador — sin backend.

## Cómo editar contenido

1. Click en **Editar** (header, arriba a la derecha).
2. Ingresá la palabra clave (definida en `app.js`, constante `KEYWORD`). Cambiala editando ese archivo antes de usar el sitio en serio.
3. La primera vez te va a pedir un **Personal Access Token** de GitHub:
   - Generalo en [github.com/settings/tokens](https://github.com/settings/tokens) → *Tokens (classic)* → scope `repo`.
   - Se guarda solo en el `localStorage` de tu navegador, nunca se sube a ningún lado.
4. Con el modo editor activo aparecen los botones **+ Nuevo proyecto**, editar (✎) y eliminar (×) en cada tarjeta.
5. Al guardar, la app comitea directo a este repo vía la API de GitHub (`projects.json`, `images/`, `attachments/`). GitHub Pages tarda uno o dos minutos en reflejar el cambio.

## Cómo funciona técnicamente

- `projects.json` es la única fuente de datos. Cada proyecto tiene: `titulo`, `cliente`, `solucion`, `descripcion`, `fecha`, `tecnologias`, `link`, `images` (rutas dentro de `images/`) y `attachments` (`{name, path, size}` dentro de `attachments/<slug>/`).
- Los adjuntos se descargan vía `raw.githubusercontent.com`, así que no hay límite de tráfico ni servidor propio. Límite práctico por archivo: ~20MB (límite de la Contents API de GitHub).
- Sin build step: `index.html` + `styles.css` + `app.js` planos. GitHub Pages sirve el repo tal cual (rama `main`, carpeta raíz).

## Importante — visibilidad

Este repo es **público**, igual que el resto de los proyectos de este GitHub. Cualquier dato de cliente o adjunto que subas queda visible para cualquiera con el link (incluso en el historial de git si después lo borrás). Si en algún momento necesitás manejar información confidencial de clientes, este approach no alcanza — habría que migrar a hosting con autenticación real (ej. Vercel/Netlify + login, o un backend propio).

## Identidad visual

Colores y logo tomados de raona.com: fondo `#161823`, acento `#F78C38`, tipografías Roboto Slab (títulos) + Open Sans (texto).
