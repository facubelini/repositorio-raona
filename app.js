/* ================================================================
   REPOSITORIO RAONA — app.js
   Modelo de seguridad (mismo patrón que portfolio-facundo-belini):
   ─ Palabra clave  → verificada por sesión (sessionStorage)
   ─ PAT            → localStorage, ingresado una sola vez
   ─ owner/repo/branch → hardcodeados (el repo es público de todas formas)
   ─ DOM de edición → inyectado SOLO después de verificación
   ─ Write API      → doble-check isEditorActive() antes de cada fetch
   ================================================================ */

'use strict';

/* ─── Config del repositorio ─────────────────────────────────────── */
const GH_OWNER  = 'facubelini';
const GH_REPO   = 'repositorio-raona';
const GH_BRANCH = 'main';

/* ─── Constantes ─────────────────────────────────────────────────── */
const SITE_KEYWORD   = 'marketing'; // palabra clave para VER el sitio — cambiala editando este archivo
const KEYWORD         = 'marketing'; // palabra clave para ENTRAR AL MODO EDITOR — cambiala editando este archivo
const MAX_ATTEMPTS   = 5;
const LOCKOUT_MS     = 5 * 60 * 1000;
const GH_PAT_KEY      = 'raona_repo_pat';
const EDITOR_SES_KEY  = 'raona_repo_editor_active';
const SITE_GATE_KEY   = 'raona_repo_site_unlocked';
const GH_API          = 'https://api.github.com';
const MAX_ATTACH_MB   = 20; // límite práctico de la Contents API de GitHub (~25MB reales)

/* NOTA DE SEGURIDAD: este gate es solo cosmético — el repo es público, así que
   cualquiera puede leer app.js (o projects.json vía raw.githubusercontent.com)
   y ver la palabra clave o el contenido sin pasar por esta pantalla. No usar
   para datos realmente confidenciales. */

/* ─── Estado ─────────────────────────────────────────────────────── */
const state = {
  projects:        [],
  activeClient:    'Todos',
  activeSolution:  'Todos',
  activeTech:      'Todos',
  search:          '',
  failedAttempts:  0,
  lockoutUntil:    null,
};

let _carouselIdx  = 0;
let _carouselImgs = [];
let _pfQuill      = null;

/* ════════════════════════════════════════════════════════════════════
   SESIÓN Y CONFIG
   ════════════════════════════════════════════════════════════════════ */

const isEditorActive  = () => sessionStorage.getItem(EDITOR_SES_KEY) === 'true';
const activateSession = () => sessionStorage.setItem(EDITOR_SES_KEY, 'true');
const clearSession    = () => sessionStorage.removeItem(EDITOR_SES_KEY);

function getGHConfig() {
  const pat = localStorage.getItem(GH_PAT_KEY);
  if (!pat) return null;
  return { owner: GH_OWNER, repo: GH_REPO, branch: GH_BRANCH, pat };
}
function savePAT(pat) { localStorage.setItem(GH_PAT_KEY, pat); }

function lockoutRemaining() {
  if (!state.lockoutUntil) return 0;
  const rem = state.lockoutUntil - Date.now();
  if (rem <= 0) { state.lockoutUntil = null; return 0; }
  return rem;
}

/* ════════════════════════════════════════════════════════════════════
   GITHUB API
   ════════════════════════════════════════════════════════════════════ */

function ghHeaders(pat) {
  return {
    'Authorization': `token ${pat}`,
    'Accept':        'application/vnd.github.v3+json',
    'Content-Type':  'application/json',
  };
}
function ghReadHeaders(pat) {
  return {
    'Authorization': `token ${pat}`,
    'Accept':        'application/vnd.github.v3+json',
  };
}

async function ghGetFile(path, cfg) {
  const url = `${GH_API}/repos/${cfg.owner}/${cfg.repo}/contents/${path}?ref=${cfg.branch}&_=${Date.now()}`;
  const res = await fetch(url, { headers: ghReadHeaders(cfg.pat) });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GitHub ${res.status}: ${res.statusText}`);
  const data = await res.json();
  const binary = atob(data.content.replace(/\n/g, ''));
  const bytes  = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return { sha: data.sha, content: new TextDecoder('utf-8').decode(bytes) };
}

async function ghPutTextFile(path, text, sha, msg, cfg) {
  if (!isEditorActive()) throw new Error('Sesión inactiva — operación cancelada.');
  const body = { message: msg, content: textToBase64(text), branch: cfg.branch };
  if (sha) body.sha = sha;
  const res = await fetch(`${GH_API}/repos/${cfg.owner}/${cfg.repo}/contents/${path}`, {
    method: 'PUT', headers: ghHeaders(cfg.pat), body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || `GitHub ${res.status}`);
  }
  return res.json();
}

async function ghPutBinaryFile(path, base64, sha, msg, cfg) {
  if (!isEditorActive()) throw new Error('Sesión inactiva — operación cancelada.');
  const body = { message: msg, content: base64, branch: cfg.branch };
  if (sha) body.sha = sha;
  const res = await fetch(`${GH_API}/repos/${cfg.owner}/${cfg.repo}/contents/${path}`, {
    method: 'PUT', headers: ghHeaders(cfg.pat), body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || `GitHub ${res.status}`);
  }
  return res.json();
}

async function ghDeleteFile(path, sha, msg, cfg) {
  if (!isEditorActive()) throw new Error('Sesión inactiva — operación cancelada.');
  const res = await fetch(`${GH_API}/repos/${cfg.owner}/${cfg.repo}/contents/${path}`, {
    method: 'DELETE', headers: ghHeaders(cfg.pat),
    body: JSON.stringify({ message: msg, sha, branch: cfg.branch }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || `GitHub ${res.status}`);
  }
  return res.json();
}

/* ════════════════════════════════════════════════════════════════════
   HELPERS
   ════════════════════════════════════════════════════════════════════ */

function escHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function formatDate(str) {
  if (!str) return '';
  const [y, m] = str.split('-');
  const meses = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
  const mi = parseInt(m, 10) - 1;
  return meses[mi] ? `${meses[mi]} ${y}` : y;
}

function textToBase64(str) {
  const bytes = new TextEncoder().encode(str);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = () => resolve(reader.result.split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function slugify(str) {
  return String(str || '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'proyecto';
}

function formatBytes(n) {
  if (!n) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function newId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function showError(el, msg) { el.textContent = msg; el.hidden = false; }

function stripHtml(html) {
  const div = document.createElement('div');
  div.innerHTML = html || '';
  return div.textContent || '';
}

/* ════════════════════════════════════════════════════════════════════
   CARGA DE DATOS
   ════════════════════════════════════════════════════════════════════ */

async function loadProjects() {
  try {
    const res = await fetch(`./projects.json?t=${Date.now()}`);
    if (!res.ok) throw new Error();
    state.projects = (await res.json()).projects || [];
  } catch { state.projects = []; }
}

/* ════════════════════════════════════════════════════════════════════
   RENDER
   ════════════════════════════════════════════════════════════════════ */

function renderAll() {
  renderStats();
  renderFilters();
  renderProjects();
}

function renderStats() {
  const bar = document.getElementById('stats-bar');
  const clientes  = new Set(state.projects.map(p => p.cliente).filter(Boolean));
  const soluciones = new Set(state.projects.map(p => p.solucion).filter(Boolean));
  bar.innerHTML = `
    <div class="stat-pill"><strong>${state.projects.length}</strong><span>Proyectos</span></div>
    <div class="stat-pill"><strong>${clientes.size}</strong><span>Clientes</span></div>
    <div class="stat-pill"><strong>${soluciones.size}</strong><span>Soluciones</span></div>`;
}

function renderFilters() {
  const clientEl   = document.getElementById('client-filters');
  const solutionEl = document.getElementById('solution-filters');
  const techEl      = document.getElementById('tech-filters');
  const addBtn      = document.getElementById('add-project-btn');

  const clientes   = ['Todos', ...new Set(state.projects.map(p => p.cliente).filter(Boolean))];
  const soluciones = ['Todos', ...new Set(state.projects.map(p => p.solucion).filter(Boolean))];
  const tecnologias = ['Todos', ...new Set(state.projects.flatMap(p => p.tecnologias || []).filter(Boolean))];

  clientEl.innerHTML = clientes.map(c => `
    <button class="filter-chip${c === state.activeClient ? ' active' : ''}" data-client="${escHtml(c)}">${escHtml(c)}</button>
  `).join('');
  solutionEl.innerHTML = soluciones.map(s => `
    <button class="filter-chip${s === state.activeSolution ? ' active' : ''}" data-solution="${escHtml(s)}">${escHtml(s)}</button>
  `).join('');
  techEl.innerHTML = tecnologias.map(t => `
    <button class="filter-chip${t === state.activeTech ? ' active' : ''}" data-tech="${escHtml(t)}">${escHtml(t)}</button>
  `).join('');

  clientEl.querySelectorAll('.filter-chip').forEach(btn => {
    btn.addEventListener('click', () => { state.activeClient = btn.dataset.client; renderFilters(); renderProjects(); });
  });
  solutionEl.querySelectorAll('.filter-chip').forEach(btn => {
    btn.addEventListener('click', () => { state.activeSolution = btn.dataset.solution; renderFilters(); renderProjects(); });
  });
  techEl.querySelectorAll('.filter-chip').forEach(btn => {
    btn.addEventListener('click', () => { state.activeTech = btn.dataset.tech; renderFilters(); renderProjects(); });
  });

  addBtn.hidden = !isEditorActive();
}

function filteredProjects() {
  return state.projects.filter(p => {
    if (state.activeClient !== 'Todos' && p.cliente !== state.activeClient) return false;
    if (state.activeSolution !== 'Todos' && p.solucion !== state.activeSolution) return false;
    if (state.activeTech !== 'Todos' && !(p.tecnologias || []).includes(state.activeTech)) return false;
    if (state.search) {
      const q = state.search.toLowerCase();
      const hay = [p.titulo, p.cliente, p.solucion, stripHtml(p.descripcion), ...(p.tecnologias || [])]
        .filter(Boolean).join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

function renderProjects() {
  const grid  = document.getElementById('projects-grid');
  const empty = document.getElementById('empty-state');
  const list  = filteredProjects();

  if (list.length === 0) { grid.innerHTML = ''; empty.hidden = false; return; }
  empty.hidden = true;
  grid.innerHTML = list.map((p, i) => buildCardHTML(p, i)).join('');
  attachCardHandlers();
}

function buildCardHTML(project, idx) {
  const id     = escHtml(project.id || '');
  const images = project.images || [];
  const attachments = project.attachments || [];

  const img = images.length > 0
    ? `<div class="card-img-wrap">
         ${images.length > 1 ? `<span class="card-img-count">${images.length} imgs</span>` : ''}
         <img src="./${escHtml(images[0])}" alt="${escHtml(project.titulo)}" class="card-img" loading="lazy" />
       </div>`
    : `<div class="card-img-wrap card-img-placeholder"><span class="placeholder-label" aria-hidden="true">${escHtml(project.solucion || '—')}</span></div>`;

  const tags = (project.tecnologias || []).map(t => `<span class="card-tag">${escHtml(t)}</span>`).join('');

  const delBtn  = isEditorActive()
    ? `<button class="card-delete-btn" data-id="${id}" aria-label="Eliminar" title="Eliminar">×</button>` : '';
  const editBtn = isEditorActive()
    ? `<button class="card-edit-btn" data-id="${id}" aria-label="Editar" title="Editar">
         <svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden="true">
           <path d="M8.5 1.5L10.5 3.5L4 10H2V8L8.5 1.5Z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
         </svg>
       </button>` : '';

  return `
    <article class="project-card" data-id="${id}" style="--card-i:${idx}">
      ${editBtn}${delBtn}${img}
      <div class="card-body">
        <div class="card-badges">
          ${project.cliente ? `<span class="badge badge-cliente">${escHtml(project.cliente)}</span>` : ''}
          ${project.solucion ? `<span class="badge badge-solucion">${escHtml(project.solucion)}</span>` : ''}
        </div>
        <h2 class="card-title">${escHtml(project.titulo)}</h2>
        ${project.fecha ? `<time class="card-date" datetime="${escHtml(project.fecha)}">${formatDate(project.fecha)}</time>` : ''}
        <p class="card-desc">${escHtml(stripHtml(project.descripcion || ''))}</p>
        ${tags ? `<div class="card-tags">${tags}</div>` : ''}
        <div class="card-footer-row">
          <span class="card-attach-count">${attachments.length > 0 ? `📎 ${attachments.length} adjunto${attachments.length > 1 ? 's' : ''}` : ''}</span>
          <button class="card-view-btn" data-id="${id}">Ver detalle →</button>
        </div>
      </div>
    </article>`.trim();
}

function attachCardHandlers() {
  document.querySelectorAll('.card-delete-btn').forEach(btn => {
    btn.addEventListener('click', e => { e.stopPropagation(); showDeleteConfirm(btn.dataset.id, btn.closest('.project-card')); });
  });
  document.querySelectorAll('.card-edit-btn').forEach(btn => {
    btn.addEventListener('click', e => { e.stopPropagation(); showProjectEditModal(btn.dataset.id); });
  });
  document.querySelectorAll('.card-view-btn').forEach(btn => {
    btn.addEventListener('click', () => showProjectDetailModal(btn.dataset.id));
  });
}

function showDeleteConfirm(projectId, cardEl) {
  cardEl.querySelector('.card-confirm-overlay')?.remove();
  const overlay = document.createElement('div');
  overlay.className = 'card-confirm-overlay';
  overlay.innerHTML = `
    <p class="confirm-msg">¿Eliminar este proyecto y sus adjuntos?</p>
    <div class="confirm-btns">
      <button class="btn btn-danger confirm-yes">Sí, eliminar</button>
      <button class="btn btn-ghost confirm-no">Cancelar</button>
    </div>`;
  cardEl.appendChild(overlay);
  overlay.querySelector('.confirm-no').addEventListener('click', () => overlay.remove());
  overlay.querySelector('.confirm-yes').addEventListener('click', () => { overlay.remove(); deleteProject(projectId); });
}

/* ════════════════════════════════════════════════════════════════════
   MODAL — genérico
   ════════════════════════════════════════════════════════════════════ */

function showModal(html, type = '') {
  const overlay = document.getElementById('modal-overlay');
  const box     = document.getElementById('modal-box');
  box.innerHTML = html;
  box.className = type ? `modal-box modal-box--${type}` : 'modal-box';
  overlay.classList.add('open');
  overlay.setAttribute('aria-hidden', 'false');
  overlay.onclick = e => { if (e.target === overlay) hideModal(); };
  if (!type) setTimeout(() => box.querySelector('input, textarea')?.focus(), 60);
}
function hideModal() {
  const overlay = document.getElementById('modal-overlay');
  overlay.classList.remove('open');
  overlay.setAttribute('aria-hidden', 'true');
  overlay.onclick = null;
  _pfQuill = null;
  setTimeout(() => {
    const box = document.getElementById('modal-box');
    box.innerHTML = ''; box.className = 'modal-box';
  }, 220);
}

/* ════════════════════════════════════════════════════════════════════
   CARRUSEL
   ════════════════════════════════════════════════════════════════════ */

function buildCarouselHTML(images, altText) {
  if (images.length === 0) return '';
  if (images.length === 1) {
    return `<div class="detail-img-wrap"><img src="./${escHtml(images[0])}" class="detail-img" alt="${escHtml(altText)}" loading="lazy" /></div>`;
  }
  const dots = images.map((_, i) => `<button class="carousel-dot${i === 0 ? ' active' : ''}" data-idx="${i}" aria-label="Imagen ${i + 1}"></button>`).join('');
  return `
    <div class="detail-carousel">
      <img src="./${escHtml(images[0])}" class="detail-carousel-img" id="carousel-main-img" alt="${escHtml(altText)}" loading="lazy" />
      <button class="carousel-arrow carousel-arrow--prev" onclick="carouselNav(-1)" aria-label="Anterior">
        <svg width="16" height="16" viewBox="0 0 18 18" fill="none"><polyline points="11,3 5,9 11,15" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </button>
      <button class="carousel-arrow carousel-arrow--next" onclick="carouselNav(1)" aria-label="Siguiente">
        <svg width="16" height="16" viewBox="0 0 18 18" fill="none"><polyline points="7,3 13,9 7,15" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </button>
      <div class="carousel-dots">${dots}</div>
    </div>`;
}
function carouselNav(dir) {
  if (_carouselImgs.length < 2) return;
  _carouselIdx = (_carouselIdx + dir + _carouselImgs.length) % _carouselImgs.length;
  updateCarousel();
}
function updateCarousel() {
  const img  = document.getElementById('carousel-main-img');
  const dots = document.querySelectorAll('.carousel-dot');
  if (img) img.src = `./${_carouselImgs[_carouselIdx]}`;
  dots.forEach((d, i) => d.classList.toggle('active', i === _carouselIdx));
}
function bindCarouselDots() {
  document.querySelectorAll('.carousel-dot').forEach(dot => {
    dot.addEventListener('click', () => { _carouselIdx = parseInt(dot.dataset.idx, 10); updateCarousel(); });
  });
}

/* ════════════════════════════════════════════════════════════════════
   DETALLE DE PROYECTO
   ════════════════════════════════════════════════════════════════════ */

function showProjectDetailModal(projectId) {
  const project = state.projects.find(p => p.id === projectId);
  if (!project) return;
  const images = project.images || [];
  const attachments = project.attachments || [];
  const contacts = project.contactos || [];
  _carouselImgs = images; _carouselIdx = 0;
  const imgHTML = buildCarouselHTML(images, project.titulo);
  const tags = (project.tecnologias || []).map(t => `<span class="card-tag">${escHtml(t)}</span>`).join('');

  const contactsHTML = contacts.length > 0 ? `
    <div class="detail-contacts">
      <p class="detail-attachments-title">Contactos clave</p>
      <div class="contacts-list">
        ${contacts.map(c => `
          <div class="contact-chip">
            <span class="contact-name">${escHtml(c.nombre)}</span>
            ${c.puesto ? `<span class="contact-role">${escHtml(c.puesto)}</span>` : ''}
          </div>`).join('')}
      </div>
    </div>` : '';

  const attachHTML = attachments.length > 0 ? `
    <div class="detail-attachments">
      <p class="detail-attachments-title">Adjuntos</p>
      ${attachments.map(a => `
        <div class="attachment-row">
          <div class="attachment-info">
            <span aria-hidden="true">📄</span>
            <span class="attachment-name">${escHtml(a.name)}</span>
            <span class="attachment-size">${formatBytes(a.size)}</span>
          </div>
          <a class="attachment-download" href="https://raw.githubusercontent.com/${GH_OWNER}/${GH_REPO}/${GH_BRANCH}/${encodeURI(a.path)}" download="${escHtml(a.name)}">Descargar</a>
        </div>`).join('')}
    </div>` : '';

  showModal(`
    ${imgHTML}
    <div class="detail-body">
      <button class="detail-close" onclick="hideModal()" aria-label="Cerrar">×</button>
      <div class="detail-meta">
        ${project.cliente ? `<span class="badge badge-cliente">${escHtml(project.cliente)}</span>` : ''}
        ${project.solucion ? `<span class="badge badge-solucion">${escHtml(project.solucion)}</span>` : ''}
        ${project.fecha ? `<time class="card-date">${formatDate(project.fecha)}</time>` : ''}
      </div>
      <h2 class="detail-title">${escHtml(project.titulo)}</h2>
      ${project.descripcion ? `<div class="detail-desc">${project.descripcion}</div>` : ''}
      ${tags ? `<div class="detail-tags">${tags}</div>` : ''}
      ${project.link ? `<a class="detail-link" href="${escHtml(project.link)}" target="_blank" rel="noopener noreferrer">Ver enlace del proyecto →</a>` : ''}
      ${contactsHTML}
      ${attachHTML}
    </div>`, 'detail');

  if (images.length > 1) bindCarouselDots();
}

/* ════════════════════════════════════════════════════════════════════
   FORMULARIO PROYECTO (nuevo / editar)
   ════════════════════════════════════════════════════════════════════ */

function showProjectFormModal(existingProject) {
  if (!isEditorActive()) { showKeywordModal(); return; }
  const isEdit = !!existingProject;
  const p = existingProject || {};
  const existingImages = p.images || [];
  const existingAttachments = p.attachments || [];

  const existingContacts = p.contactos || [];
  const clientesDatalist  = [...new Set(state.projects.map(x => x.cliente).filter(Boolean))];
  const solucionesDatalist = [...new Set(state.projects.map(x => x.solucion).filter(Boolean))];

  const existingImgsHTML = isEdit && existingImages.length > 0 ? `
    <div class="form-group">
      <label class="form-label">Imágenes actuales <span class="hint">(× para quitar)</span></label>
      <div class="current-imgs" id="pf-current-imgs">
        ${existingImages.map((img, i) => `
          <div class="current-img-item" data-img="${escHtml(img)}">
            <img src="./${escHtml(img)}" class="current-img-thumb" alt="Imagen ${i + 1}" />
            <button type="button" class="current-img-remove" aria-label="Quitar imagen">×</button>
          </div>`).join('')}
      </div>
    </div>` : `<div class="form-group" id="pf-current-imgs" hidden></div>`;

  const existingAttachHTML = isEdit && existingAttachments.length > 0 ? `
    <div class="form-group">
      <label class="form-label">Adjuntos actuales <span class="hint">(× para quitar)</span></label>
      <div class="current-attachments" id="pf-current-attachments">
        ${existingAttachments.map(a => `
          <div class="current-attach-item" data-path="${escHtml(a.path)}" data-name="${escHtml(a.name)}" data-size="${a.size || 0}">
            <span>📄 ${escHtml(a.name)} <span class="attachment-size">(${formatBytes(a.size)})</span></span>
            <button type="button" class="attach-remove" aria-label="Quitar adjunto">×</button>
          </div>`).join('')}
      </div>
    </div>` : `<div class="form-group" id="pf-current-attachments" hidden></div>`;

  showModal(`
    <div class="modal-header">
      <h3 class="modal-title">${isEdit ? 'Editar proyecto' : 'Nuevo proyecto'}</h3>
      <button class="modal-close" onclick="hideModal()">×</button>
    </div>
    <div class="form-group">
      <label class="form-label" for="pf-titulo">Título <span class="req">*</span></label>
      <input id="pf-titulo" type="text" class="form-input" placeholder="Nombre del proyecto" value="${escHtml(p.titulo || '')}" />
    </div>
    <div class="form-row">
      <div class="form-group">
        <label class="form-label" for="pf-cliente">Cliente <span class="req">*</span></label>
        <input id="pf-cliente" type="text" class="form-input" list="pf-clientes-list" placeholder="Nombre del cliente" value="${escHtml(p.cliente || '')}" />
        <datalist id="pf-clientes-list">${clientesDatalist.map(c => `<option value="${escHtml(c)}">`).join('')}</datalist>
      </div>
      <div class="form-group">
        <label class="form-label" for="pf-solucion">Solución <span class="req">*</span></label>
        <input id="pf-solucion" type="text" class="form-input" list="pf-soluciones-list" placeholder="Ej: Desarrollo a medida, Consultoría, Data & AI…" value="${escHtml(p.solucion || '')}" />
        <datalist id="pf-soluciones-list">${solucionesDatalist.map(s => `<option value="${escHtml(s)}">`).join('')}</datalist>
      </div>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label class="form-label" for="pf-fecha">Fecha <span class="hint">(opcional)</span></label>
        <input id="pf-fecha" type="month" class="form-input" value="${escHtml(p.fecha || '')}" />
      </div>
      <div class="form-group">
        <label class="form-label" for="pf-link">Enlace <span class="hint">(demo, repo… opcional)</span></label>
        <input id="pf-link" type="url" class="form-input" placeholder="https://…" value="${escHtml(p.link || '')}" />
      </div>
    </div>
    <div class="form-group">
      <label class="form-label">Descripción</label>
      <div id="pf-desc-editor" class="rich-editor"></div>
    </div>
    <div class="form-group">
      <label class="form-label" for="pf-tech">Tecnologías <span class="hint">(separadas por coma)</span></label>
      <input id="pf-tech" type="text" class="form-input" placeholder="React, Node.js, Azure…" value="${escHtml((p.tecnologias || []).join(', '))}" />
    </div>
    <div class="form-group">
      <label class="form-label">Contactos clave <span class="hint">(opcional)</span></label>
      <div id="pf-contacts-list"></div>
      <button type="button" class="add-contact-btn" id="pf-add-contact">+ Agregar contacto</button>
    </div>
    ${existingImgsHTML}
    <div class="form-group">
      <label class="form-label" for="pf-imgs">${isEdit ? 'Agregar imágenes' : 'Imágenes'} <span class="hint">(podés elegir varias)</span></label>
      <input id="pf-imgs" type="file" class="form-file" accept="image/*" multiple />
      <div class="new-imgs-preview" id="pf-new-img-previews"></div>
    </div>
    ${existingAttachHTML}
    <div class="form-group">
      <label class="form-label" for="pf-attachments">${isEdit ? 'Agregar adjuntos' : 'Adjuntos'} <span class="hint">(cualquier archivo, máx ~${MAX_ATTACH_MB}MB cada uno)</span></label>
      <input id="pf-attachments" type="file" class="form-file" multiple />
      <div class="new-imgs-preview" id="pf-new-attach-previews"></div>
    </div>
    <div id="pf-status" class="upload-status" hidden></div>
    <div id="pf-error" class="form-error" hidden></div>
    <div class="modal-actions">
      <button class="btn btn-ghost" onclick="hideModal()">Cancelar</button>
      <button class="btn btn-primary" id="pf-submit">${isEdit ? 'Guardar cambios →' : 'Publicar →'}</button>
    </div>`);

  _pfQuill = new Quill('#pf-desc-editor', {
    theme: 'snow',
    placeholder: 'Qué se hizo, alcance, resultados…',
    modules: { toolbar: [['bold', 'italic', 'underline'], [{ list: 'ordered' }, { list: 'bullet' }], ['link'], ['clean']] },
  });
  if (p.descripcion) _pfQuill.root.innerHTML = p.descripcion;

  const contactsList = document.getElementById('pf-contacts-list');
  if (existingContacts.length > 0) existingContacts.forEach(c => addContactRow(contactsList, c.nombre, c.puesto));
  document.getElementById('pf-add-contact').addEventListener('click', () => addContactRow(contactsList, '', ''));

  document.querySelectorAll('#pf-current-imgs .current-img-remove').forEach(btn => {
    btn.addEventListener('click', () => btn.closest('.current-img-item').remove());
  });
  document.querySelectorAll('#pf-current-attachments .attach-remove').forEach(btn => {
    btn.addEventListener('click', () => btn.closest('.current-attach-item').remove());
  });

  document.getElementById('pf-imgs').addEventListener('change', e => {
    const wrap = document.getElementById('pf-new-img-previews');
    wrap.innerHTML = '';
    Array.from(e.target.files).forEach(file => {
      const reader = new FileReader();
      reader.onload = ev => {
        const div = document.createElement('div');
        div.innerHTML = `<img src="${ev.target.result}" class="new-img-thumb" alt="${escHtml(file.name)}" />`;
        wrap.appendChild(div);
      };
      reader.readAsDataURL(file);
    });
  });
  document.getElementById('pf-attachments').addEventListener('change', e => {
    const wrap = document.getElementById('pf-new-attach-previews');
    wrap.innerHTML = Array.from(e.target.files).map(f => `<span class="card-tag">📄 ${escHtml(f.name)} (${formatBytes(f.size)})</span>`).join('');
  });

  document.getElementById('pf-submit').addEventListener('click', () => {
    if (isEdit) submitProjectEdit(p.id, existingImages, existingAttachments);
    else submitNewProject();
  });
}

function showProjectEditModal(projectId) {
  const project = state.projects.find(p => p.id === projectId);
  if (!project) return;
  showProjectFormModal(project);
}

function addContactRow(container, nombre, puesto) {
  const row = document.createElement('div');
  row.className = 'contact-row';
  row.innerHTML = `
    <input type="text" class="form-input contact-nombre" placeholder="Nombre" value="${escHtml(nombre || '')}" />
    <input type="text" class="form-input contact-puesto" placeholder="Puesto / Cargo" value="${escHtml(puesto || '')}" />
    <button type="button" class="contact-remove-row" aria-label="Quitar contacto">×</button>`;
  row.querySelector('.contact-remove-row').addEventListener('click', () => row.remove());
  container.appendChild(row);
}

function getQuillDescriptionHTML() {
  if (!_pfQuill) return '';
  const html = _pfQuill.root.innerHTML.trim();
  return html === '<p><br></p>' ? '' : html;
}

function readContactsFromForm() {
  return Array.from(document.querySelectorAll('#pf-contacts-list .contact-row'))
    .map(row => ({
      nombre: row.querySelector('.contact-nombre').value.trim(),
      puesto: row.querySelector('.contact-puesto').value.trim(),
    }))
    .filter(c => c.nombre);
}

function readProjectFormFields() {
  return {
    titulo:  document.getElementById('pf-titulo').value.trim(),
    cliente: document.getElementById('pf-cliente').value.trim(),
    solucion: document.getElementById('pf-solucion').value.trim(),
    fecha:   document.getElementById('pf-fecha').value,
    link:    document.getElementById('pf-link').value.trim(),
    descripcion: getQuillDescriptionHTML(),
    tecnologias: document.getElementById('pf-tech').value.trim().split(',').map(t => t.trim()).filter(Boolean),
    contactos: readContactsFromForm(),
    imgFiles: Array.from(document.getElementById('pf-imgs').files),
    attachFiles: Array.from(document.getElementById('pf-attachments').files),
  };
}

async function submitNewProject() {
  if (!isEditorActive()) { hideModal(); showKeywordModal(); return; }
  const f = readProjectFormFields();
  const errEl = document.getElementById('pf-error');
  const statusEl = document.getElementById('pf-status');
  const submitBtn = document.getElementById('pf-submit');

  if (!f.titulo || !f.cliente || !f.solucion) { showError(errEl, 'Título, cliente y solución son obligatorios.'); return; }
  const oversized = f.attachFiles.find(file => file.size > MAX_ATTACH_MB * 1024 * 1024);
  if (oversized) { showError(errEl, `"${oversized.name}" supera ${MAX_ATTACH_MB}MB.`); return; }

  const cfg = getGHConfig();
  if (!cfg) { hideModal(); showTokenModal(); return; }

  submitBtn.disabled = true; errEl.hidden = true;
  const setStatus = (msg, type = 'loading') => {
    statusEl.className = `upload-status upload-status--${type}`;
    statusEl.textContent = msg; statusEl.hidden = false;
  };

  const project = {
    id: newId(), titulo: f.titulo, cliente: f.cliente, solucion: f.solucion,
    fecha: f.fecha || null, link: f.link || null, descripcion: f.descripcion,
    tecnologias: f.tecnologias, contactos: f.contactos, images: [], attachments: [],
  };
  const slug = slugify(f.titulo) + '-' + project.id;

  try {
    for (let i = 0; i < f.imgFiles.length; i++) {
      setStatus(`Subiendo imágenes (${i + 1}/${f.imgFiles.length})…`);
      const file = f.imgFiles[i];
      const base64 = await readFileAsBase64(file);
      const ext = file.name.split('.').pop().toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
      const fname = `images/${project.id}_${i}.${ext}`;
      await ghPutBinaryFile(fname, base64, null, `Add image: ${f.titulo}`, cfg);
      project.images.push(fname);
    }
    for (let i = 0; i < f.attachFiles.length; i++) {
      setStatus(`Subiendo adjuntos (${i + 1}/${f.attachFiles.length})…`);
      const file = f.attachFiles[i];
      const base64 = await readFileAsBase64(file);
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
      const path = `attachments/${slug}/${safeName}`;
      await ghPutBinaryFile(path, base64, null, `Add attachment: ${file.name}`, cfg);
      project.attachments.push({ name: file.name, path, size: file.size });
    }
    setStatus('Guardando proyecto…');
    const existing = await ghGetFile('projects.json', cfg);
    let sha = null; let data = { projects: [] };
    if (existing) { sha = existing.sha; data = JSON.parse(existing.content); }
    if (!Array.isArray(data.projects)) data.projects = [];
    data.projects.push(project);
    await ghPutTextFile('projects.json', JSON.stringify(data, null, 2), sha, `Add project: ${f.titulo}`, cfg);
    state.projects.push(project);
    renderAll();
    setStatus('¡Proyecto publicado!', 'success');
    setTimeout(hideModal, 1500);
  } catch (err) {
    setStatus(`Error: ${err.message}`, 'error');
    submitBtn.disabled = false;
  }
}

async function submitProjectEdit(projectId, originalImages, originalAttachments) {
  if (!isEditorActive()) { hideModal(); showKeywordModal(); return; }
  const f = readProjectFormFields();
  const errEl = document.getElementById('pf-error');
  const statusEl = document.getElementById('pf-status');
  const submitBtn = document.getElementById('pf-submit');

  if (!f.titulo || !f.cliente || !f.solucion) { showError(errEl, 'Título, cliente y solución son obligatorios.'); return; }
  const oversized = f.attachFiles.find(file => file.size > MAX_ATTACH_MB * 1024 * 1024);
  if (oversized) { showError(errEl, `"${oversized.name}" supera ${MAX_ATTACH_MB}MB.`); return; }

  const cfg = getGHConfig();
  if (!cfg) { hideModal(); showTokenModal(); return; }

  const keptImages = Array.from(document.querySelectorAll('#pf-current-imgs .current-img-item')).map(el => el.dataset.img);
  const keptAttachments = Array.from(document.querySelectorAll('#pf-current-attachments .current-attach-item')).map(el => ({
    path: el.dataset.path, name: el.dataset.name, size: parseInt(el.dataset.size, 10) || 0,
  }));

  submitBtn.disabled = true; errEl.hidden = true;
  const setStatus = (msg, type = 'loading') => {
    statusEl.className = `upload-status upload-status--${type}`;
    statusEl.textContent = msg; statusEl.hidden = false;
  };

  try {
    const removedImages = originalImages.filter(img => !keptImages.includes(img));
    for (const imgPath of removedImages) {
      try { const fl = await ghGetFile(imgPath, cfg); if (fl) await ghDeleteFile(imgPath, fl.sha, `Remove image: ${f.titulo}`, cfg); } catch {}
    }
    const removedAttachments = originalAttachments.filter(a => !keptAttachments.some(k => k.path === a.path));
    for (const a of removedAttachments) {
      try { const fl = await ghGetFile(a.path, cfg); if (fl) await ghDeleteFile(a.path, fl.sha, `Remove attachment: ${a.name}`, cfg); } catch {}
    }

    const slug = slugify(f.titulo) + '-' + projectId;
    const newImages = [...keptImages];
    for (let i = 0; i < f.imgFiles.length; i++) {
      setStatus(`Subiendo imágenes nuevas (${i + 1}/${f.imgFiles.length})…`);
      const file = f.imgFiles[i];
      const base64 = await readFileAsBase64(file);
      const ext = file.name.split('.').pop().toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
      const fname = `images/${projectId}_${Date.now()}_${i}.${ext}`;
      await ghPutBinaryFile(fname, base64, null, `Update image: ${f.titulo}`, cfg);
      newImages.push(fname);
    }
    const newAttachments = [...keptAttachments];
    for (let i = 0; i < f.attachFiles.length; i++) {
      setStatus(`Subiendo adjuntos nuevos (${i + 1}/${f.attachFiles.length})…`);
      const file = f.attachFiles[i];
      const base64 = await readFileAsBase64(file);
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
      const path = `attachments/${slug}/${safeName}`;
      await ghPutBinaryFile(path, base64, null, `Add attachment: ${file.name}`, cfg);
      newAttachments.push({ name: file.name, path, size: file.size });
    }

    setStatus('Guardando cambios…');
    const existing = await ghGetFile('projects.json', cfg);
    if (!existing) throw new Error('No se pudo leer projects.json');
    const data = JSON.parse(existing.content);
    const idx = data.projects.findIndex(p => p.id === projectId);
    if (idx === -1) throw new Error('Proyecto no encontrado');

    const updated = {
      ...data.projects[idx],
      titulo: f.titulo, cliente: f.cliente, solucion: f.solucion,
      fecha: f.fecha || null, link: f.link || null, descripcion: f.descripcion,
      tecnologias: f.tecnologias, contactos: f.contactos, images: newImages, attachments: newAttachments,
    };
    data.projects[idx] = updated;

    await ghPutTextFile('projects.json', JSON.stringify(data, null, 2), existing.sha, `Update project: ${f.titulo}`, cfg);
    const stateIdx = state.projects.findIndex(p => p.id === projectId);
    if (stateIdx !== -1) state.projects[stateIdx] = updated;
    renderAll();
    setStatus('¡Cambios guardados!', 'success');
    setTimeout(hideModal, 1500);
  } catch (err) {
    setStatus(`Error: ${err.message}`, 'error');
    submitBtn.disabled = false;
  }
}

async function deleteProject(projectId) {
  if (!isEditorActive()) return;
  const project = state.projects.find(p => p.id === projectId);
  if (!project) return;
  const cfg = getGHConfig(); if (!cfg) { showTokenModal(); return; }
  const card = document.querySelector(`.project-card[data-id="${projectId}"]`);
  if (card) card.style.opacity = '0.35';
  try {
    const existing = await ghGetFile('projects.json', cfg);
    if (!existing) throw new Error('No se pudo leer projects.json');
    const data = JSON.parse(existing.content);
    data.projects = (data.projects || []).filter(p => p.id !== projectId);
    for (const imgPath of (project.images || [])) {
      try { const fl = await ghGetFile(imgPath, cfg); if (fl) await ghDeleteFile(imgPath, fl.sha, `Remove image: ${project.titulo}`, cfg); } catch {}
    }
    for (const a of (project.attachments || [])) {
      try { const fl = await ghGetFile(a.path, cfg); if (fl) await ghDeleteFile(a.path, fl.sha, `Remove attachment: ${a.name}`, cfg); } catch {}
    }
    await ghPutTextFile('projects.json', JSON.stringify(data, null, 2), existing.sha, `Remove project: ${project.titulo}`, cfg);
    state.projects = state.projects.filter(p => p.id !== projectId);
    renderAll();
  } catch (err) {
    if (card) card.style.opacity = '1';
    alert(`Error al eliminar: ${err.message}`);
  }
}

/* ════════════════════════════════════════════════════════════════════
   GATE — PALABRA CLAVE + TOKEN
   ════════════════════════════════════════════════════════════════════ */

function showKeywordModal() {
  const rem = lockoutRemaining();
  if (rem > 0) {
    const mins = Math.ceil(rem / 60000);
    showModal(`
      <div class="modal-header"><h3 class="modal-title">Acceso bloqueado</h3><button class="modal-close" onclick="hideModal()">×</button></div>
      <p class="form-error" style="display:block">Demasiados intentos. Intentá en ${mins} minuto${mins !== 1 ? 's' : ''}.</p>
      <div class="modal-actions"><button class="btn btn-ghost" onclick="hideModal()">Cerrar</button></div>`);
    return;
  }
  showModal(`
    <div class="modal-header"><h3 class="modal-title">Modo editor</h3><button class="modal-close" onclick="hideModal()">×</button></div>
    <p class="modal-sub">Ingresá la palabra clave para continuar.</p>
    <div class="form-group">
      <label class="form-label" for="kw-input">Palabra clave</label>
      <input id="kw-input" type="password" class="form-input" autocomplete="off" placeholder="••••••••••••" />
    </div>
    <div id="kw-error" class="form-error" hidden></div>
    <div class="modal-actions">
      <button class="btn btn-ghost" onclick="hideModal()">Cancelar</button>
      <button class="btn btn-primary" id="kw-btn">Continuar →</button>
    </div>`);
  const input = document.getElementById('kw-input');
  const submit = () => checkKeyword(input.value);
  document.getElementById('kw-btn').addEventListener('click', submit);
  input.addEventListener('keydown', e => { if (e.key === 'Enter') submit(); });
}

function checkKeyword(value) {
  const errEl = document.getElementById('kw-error');
  if (value === KEYWORD) {
    state.failedAttempts = 0;
    activateSession();
    hideModal();
    updateEditorToggleUI();
    renderAll();
    if (!getGHConfig()) setTimeout(showTokenModal, 250);
    return;
  }
  state.failedAttempts++;
  if (state.failedAttempts >= MAX_ATTEMPTS) {
    state.lockoutUntil = Date.now() + LOCKOUT_MS;
    hideModal();
    setTimeout(showKeywordModal, 200);
    return;
  }
  showError(errEl, `Palabra clave incorrecta (${MAX_ATTEMPTS - state.failedAttempts} intentos restantes).`);
}

function showTokenModal() {
  showModal(`
    <div class="modal-header"><h3 class="modal-title">Token de GitHub</h3><button class="modal-close" onclick="hideModal()">×</button></div>
    <p class="modal-sub">Pegá un Personal Access Token (classic, con permiso <code>repo</code>) para poder editar y subir archivos. Se guarda solo en tu navegador.</p>
    <div class="form-group">
      <label class="form-label" for="pat-input">Token</label>
      <input id="pat-input" type="password" class="form-input" autocomplete="off" placeholder="ghp_…" />
    </div>
    <div id="pat-error" class="form-error" hidden></div>
    <div class="modal-actions">
      <button class="btn btn-ghost" onclick="hideModal()">Cancelar</button>
      <button class="btn btn-primary" id="pat-btn">Guardar →</button>
    </div>`);
  const input = document.getElementById('pat-input');
  const submit = () => {
    const val = input.value.trim();
    if (!val) { showError(document.getElementById('pat-error'), 'Ingresá un token válido.'); return; }
    savePAT(val);
    hideModal();
    updateEditorToggleUI();
    renderAll();
  };
  document.getElementById('pat-btn').addEventListener('click', submit);
  input.addEventListener('keydown', e => { if (e.key === 'Enter') submit(); });
}

function updateEditorToggleUI() {
  const btn = document.getElementById('editor-toggle-btn');
  const label = document.getElementById('editor-toggle-label');
  const active = isEditorActive();
  btn.classList.toggle('active', active);
  label.textContent = active ? 'Editando' : 'Editar';
}

function toggleEditor() {
  if (isEditorActive()) {
    clearSession();
    updateEditorToggleUI();
    renderAll();
    return;
  }
  showKeywordModal();
}

/* ════════════════════════════════════════════════════════════════════
   GATE — ACCESO AL SITIO (bloquea todo el contenido hasta ingresar la palabra clave)
   ════════════════════════════════════════════════════════════════════ */

const isSiteUnlocked = () => sessionStorage.getItem(SITE_GATE_KEY) === 'true';

function unlockSiteUI() {
  document.body.classList.add('unlocked');
}

function trySiteUnlock() {
  const input = document.getElementById('gate-input');
  const errEl = document.getElementById('gate-error');
  if (input.value === SITE_KEYWORD) {
    sessionStorage.setItem(SITE_GATE_KEY, 'true');
    unlockSiteUI();
    initApp();
  } else {
    errEl.hidden = false;
    input.value = '';
    input.focus();
  }
}

function initSiteGate() {
  document.getElementById('gate-submit').addEventListener('click', trySiteUnlock);
  document.getElementById('gate-input').addEventListener('keydown', e => { if (e.key === 'Enter') trySiteUnlock(); });
  document.getElementById('gate-input').focus();
}

/* ════════════════════════════════════════════════════════════════════
   INIT
   ════════════════════════════════════════════════════════════════════ */

async function initApp() {
  await loadProjects();
  renderAll();
  updateEditorToggleUI();

  document.getElementById('editor-toggle-btn').addEventListener('click', toggleEditor);
  document.getElementById('add-project-btn').addEventListener('click', () => showProjectFormModal(null));

  let searchTimer = null;
  document.getElementById('search-input').addEventListener('input', e => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { state.search = e.target.value.trim(); renderProjects(); }, 150);
  });
}

document.addEventListener('DOMContentLoaded', () => {
  if (isSiteUnlocked()) {
    unlockSiteUI();
    initApp();
  } else {
    initSiteGate();
  }
});
