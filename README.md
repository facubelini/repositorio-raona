# Repositorio Raona

Repositorio de proyectos realizados con clientes. Sitio estático (sin backend, sin build), publicado en GitHub Pages, con identidad visual de Raona.

Sitio: https://facubelini.github.io/repositorio-raona/

## Qué tiene

- Grilla de proyectos con imagen, cliente, solución, descripción, tecnologías y adjuntos descargables.
- Filtros combinables por **Cliente** y por **Solución**, más buscador de texto libre.
- Modo editor: alta, edición y borrado de proyectos, con carga de imágenes y adjuntos (cualquier tipo de archivo) directo desde el navegador — sin backend.

## Acceso al sitio

Al entrar pide una palabra clave (`marketing`, constante `SITE_KEYWORD` en `app.js`) antes de mostrar cualquier contenido. Es un gate cosmético: el repo es público, así que técnicamente cualquiera con conocimientos técnicos podría leer `app.js` o `projects.json` directamente. No usar para datos realmente confidenciales — ver sección de visibilidad más abajo.

## Cómo editar contenido

1. Click en **Editar** (header, arriba a la derecha).
2. Ingresá la palabra clave (`marketing`, constante `KEYWORD` en `app.js` — es la misma palabra que la de entrada al sitio, pero son dos gates independientes; podés diferenciarlas cambiando una sola de las dos constantes).
3. La primera vez te va a pedir un **Personal Access Token** de GitHub. Creá uno dedicado, con permisos mínimos:
   1. Ir a [github.com/settings/personal-access-tokens/new](https://github.com/settings/personal-access-tokens/new) (fine-grained).
   2. **Token name**: `repositorio-raona-editor`.
   3. **Expiration**: 1 año (o el que prefieras).
   4. **Repository access** → *Only select repositories* → `repositorio-raona`.
   5. **Permissions** → **Repository permissions** → **Contents**: `Read and write`.
   6. **Generate token** y copiá el valor (no se vuelve a mostrar).
   7. Pegalo en el modal del sitio — queda guardado solo en el `localStorage` de tu navegador, nunca se sube a ningún lado.
4. Con el modo editor activo aparecen los botones **+ Nuevo proyecto**, editar (✎) y eliminar (×) en cada tarjeta.
5. Al guardar, la app comitea directo a este repo vía la API de GitHub (`projects.json`, `images/`, `attachments/`). GitHub Pages tarda uno o dos minutos en reflejar el cambio.

No pude generar el token por vos automáticamente: GitHub no tiene una API para crear Personal Access Tokens (solo se hace desde la web, con tu sesión logueada), y no tengo un navegador conectado a tu cuenta de GitHub para completar esos clicks en tu lugar. Son ~2 minutos siguiendo los pasos de arriba, una sola vez.

## Cómo funciona técnicamente

- `projects.json` es la única fuente de datos. Cada proyecto tiene: `titulo`, `cliente`, `solucion`, `descripcion`, `fecha`, `tecnologias`, `link`, `images` (rutas dentro de `images/`) y `attachments` (`{name, path, size}` dentro de `attachments/<slug>/`).
- Los adjuntos se descargan vía `raw.githubusercontent.com`, así que no hay límite de tráfico ni servidor propio. Límite práctico por archivo: ~20MB (límite de la Contents API de GitHub).
- Sin build step: `index.html` + `styles.css` + `app.js` planos. GitHub Pages sirve el repo tal cual (rama `main`, carpeta raíz).

## Importante — visibilidad

Este repo es **público**, igual que el resto de los proyectos de este GitHub. Cualquier dato de cliente o adjunto que subas queda visible para cualquiera con el link (incluso en el historial de git si después lo borrás). Si en algún momento necesitás manejar información confidencial de clientes, este approach no alcanza — habría que migrar a hosting con autenticación real (ej. Vercel/Netlify + login, o un backend propio).

## Identidad visual

Colores y logo tomados de raona.com: fondo `#161823`, acento `#F78C38`, tipografías Roboto Slab (títulos) + Open Sans (texto).
