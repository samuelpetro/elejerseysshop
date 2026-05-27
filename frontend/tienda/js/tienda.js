// ============================================================
// tienda.js - Lógica completa de la tienda EleJeserys
// ============================================================

const API = "/api";

// ---- Estado global ----------------------------------------
let carrito = JSON.parse(localStorage.getItem("ej_carrito") || "[]");
let usuario = JSON.parse(localStorage.getItem("ej_usuario") || "null");
let token   = localStorage.getItem("ej_token") || null;
let categorias = [];
let _catActual = "";
let _paginaActual = "inicio";

// ============================================================
// INICIO
// ============================================================
// ==== THEME ====
function initTheme() {
  const isLight = localStorage.getItem("ele_theme") === "light";
  if (isLight) applyTheme("light");
}

function toggleTheme() {
  const current = document.documentElement.getAttribute("data-theme");
  if (current === "light") applyTheme("dark");
  else applyTheme("light");
}

function applyTheme(theme) {
  const btn = document.getElementById("theme-toggle");
  if (theme === "light") {
    document.documentElement.setAttribute("data-theme", "light");
    localStorage.setItem("ele_theme", "light");
    if (btn) btn.innerHTML = "🌙 Oscuro";
  } else {
    document.documentElement.removeAttribute("data-theme");
    localStorage.setItem("ele_theme", "dark");
    if (btn) btn.innerHTML = "💡 Claro";
  }
}

document.addEventListener("DOMContentLoaded", async () => {
  initTheme();
  actualizarUIUsuario();
  actualizarBadgeCarrito();
  await cargarCategorias();
  cargarDestacados();
});

// ============================================================
// NAVEGACIÓN
// ============================================================
function irAPagina(id) {
  document.querySelectorAll(".pagina").forEach(p => p.classList.remove("activa"));
  document.getElementById("pagina-" + id)?.classList.add("activa");
  _paginaActual = id;
  window.scrollTo(0, 0);
}

function irACatalogo(slug = "") {
  _catActual = slug;
  irAPagina("catalogo");
  // Marcar categoría activa en nav
  document.querySelectorAll(".nav-cat").forEach(b => {
    b.classList.toggle("activo", b.dataset.cat === slug);
  });
  const cat = categorias.find(c => c.slug === slug);
  document.getElementById("titulo-catalogo").textContent =
    cat ? cat.nombre : "Todos los productos";
  cargarCatalogo();
}

function filtrarCategoria(btn, slug) {
  document.querySelectorAll(".nav-cat").forEach(b => b.classList.remove("activo"));
  btn.classList.add("activo");
  irACatalogo(slug);
}

function irAPaginaPedidos() {
  if (!token) { abrirAuth(); return; }
  irAPagina("pedidos");
  cargarMisPedidos();
}

// ============================================================
// CATEGORÍAS (llenar nav)
// ============================================================
async function cargarCategorias() {
  try {
    const res = await fetch(`${API}/categorias`);
    categorias = await res.json();
    const nav = document.getElementById("nav-cats");
    // Solo mostrar categorias padre (sin parent_id)
    categorias.filter(c => !c.parent_id).forEach(c => {
      const btn = document.createElement("button");
      btn.className = "nav-cat";
      btn.dataset.cat = c.slug;
      btn.textContent = c.nombre;
      btn.onclick = () => filtrarCategoria(btn, c.slug);
      nav.appendChild(btn);
    });
  } catch (e) { console.error(e); }
}

// ============================================================
// DESTACADOS (home)
// ============================================================
async function cargarDestacados() {
  const grid = document.getElementById("grid-destacados");
  try {
    const res = await fetch(`${API}/productos/destacados`);
    const productos = await res.json();
    grid.innerHTML = productos.length
      ? productos.map(tarjetaHTML).join("")
      : `<div class="vacio">No hay productos destacados aún.</div>`;
  } catch (e) {
    grid.innerHTML = `<div class="vacio">Error cargando productos.</div>`;
  }
}

// ============================================================
// CATÁLOGO
// ============================================================
async function cargarCatalogo() {
  const grid = document.getElementById("grid-catalogo");
  grid.innerHTML = `<div class="loading"><div class="spinner"></div></div>`;

  const params = new URLSearchParams();
  if (_catActual) {
    const cat = categorias.find(c => c.slug === _catActual);
    if (cat) params.set("categoria", cat.id_categoria);
  }
  const buscar  = document.getElementById("buscador").value.trim();
  const version = document.getElementById("filtro-version").value;
  const talla   = document.getElementById("filtro-talla").value;
  if (buscar)  params.set("buscar", buscar);
  if (version) params.set("version", version);
  if (talla)   params.set("talla", talla);

  try {
    const res = await fetch(`${API}/productos?${params}`);
    const productos = await res.json();
    grid.innerHTML = productos.length
      ? productos.map(tarjetaHTML).join("")
      : `<div class="vacio">No se encontraron productos con esos filtros.</div>`;
  } catch (e) {
    grid.innerHTML = `<div class="vacio">Error cargando productos.</div>`;
  }
}

function aplicarFiltros() { cargarCatalogo(); }
function limpiarFiltros() {
  document.getElementById("buscador").value = "";
  document.getElementById("filtro-version").value = "";
  document.getElementById("filtro-talla").value = "";
  cargarCatalogo();
}

// ============================================================
// TARJETA HTML
// ============================================================
function tarjetaHTML(p) {
  const img = p.imagen
    ? `<img src="${p.imagen}" alt="${p.nombre}" loading="lazy">`
    : `👕`;
  return `
    <div class="tarjeta-producto" onclick="verProducto(${p.id_producto})">
      <div class="tarjeta-img">
        ${img}
        ${p.destacado ? `<div class="badge-destacado">Destacado</div>` : ""}
      </div>
      <div class="tarjeta-body">
        <div class="tarjeta-cat">${p.categoria_nombre || ""}</div>
        <div class="tarjeta-nombre">${p.nombre}</div>
        <div class="tarjeta-precios">
          <div class="precio-fan">${formatPrecio(p.precio)}</div>
          ${p.precio_player ? `<div class="precio-player">Player: ${formatPrecio(p.precio_player)}</div>` : ""}
        </div>
      </div>
      <div class="tarjeta-footer">
        <button class="btn btn-amarillo btn-full btn-sm" onclick="event.stopPropagation();verProducto(${p.id_producto})">
          Ver opciones
        </button>
      </div>
    </div>
  `;
}

// ============================================================
// DETALLE DEL PRODUCTO
// ============================================================
let _detalleProducto = null;
let _versionSeleccionada = "Fan";
let _tallaSeleccionada = null;

async function verProducto(id) {
  irAPagina("detalle");
  const cont = document.getElementById("detalle-contenido");
  cont.innerHTML = `<div class="loading"><div class="spinner"></div></div>`;

  try {
    const res = await fetch(`${API}/productos/${id}`);
    const p = await res.json();
    _detalleProducto = p;
    _versionSeleccionada = "Fan";
    _tallaSeleccionada = null;

    // Breadcrumb
    document.getElementById("breadcrumb-detalle").innerHTML = `
      <span onclick="irAPagina('inicio')">Inicio</span>
      <span class="breadcrumb-sep">/</span>
      <span onclick="irACatalogo('${p.categoria_slug || ''}')">${p.categoria_nombre || "Catálogo"}</span>
      <span class="breadcrumb-sep">/</span>
      <span>${p.nombre}</span>
    `;

    renderizarDetalle(p);
  } catch (e) {
    cont.innerHTML = `<div class="vacio">Error cargando producto.</div>`;
  }
}

function renderizarDetalle(p) {
  const imgPrincipal = p.imagen
    ? `<img src="${p.imagen}" alt="${p.nombre}" id="img-principal-grande">`
    : `<span style="font-size:100px">👕</span>`;

  // Galería adicional
  const galeriaHTML = p.imagenes?.length
    ? p.imagenes.map(img => `
        <div class="detalle-thumb" onclick="cambiarImgPrincipal('${img.url}')">
          <img src="${img.url}" alt="vista">
        </div>`).join("")
    : "";

  // Inventario organizado por versión
  const versiones = [...new Set(p.inventario.map(i => i.version))];
  const versionesHTML = versiones.length ? versiones.map(v => `
    <button class="version-btn ${v === _versionSeleccionada ? 'activo' : ''}"
            onclick="seleccionarVersion('${v}')">${v}</button>
  `).join("") : "";

  // Tallas disponibles para la versión seleccionada
  const tallasHTML = p.inventario.length ? renderizarTallas(p, _versionSeleccionada) : "";

  // Precio según versión
  const precioActual = p.precio_player && _versionSeleccionada === "Player"
    ? p.precio_player : p.precio;

  const sinInventario = !p.inventario || p.inventario.length === 0;
  const selectorHTML = sinInventario ? `
    <p style="color:var(--texto-muted);font-size:14px;margin:12px 0">Stock disponible: ${p.stock || 0} unidades</p>
    <button class="btn btn-amarillo btn-full" style="margin-top:8px" onclick="agregarAlCarritoSimple(${p.id_producto})">
      🛒 Agregar al carrito
    </button>
  ` : `
    <div class="version-selector">
      <div class="selector-label">Versión</div>
      <div class="version-btns" id="version-btns">${versionesHTML}</div>
    </div>

    <div class="selector-label">Talla</div>
    <div class="tallas-grid" id="tallas-grid">${tallasHTML}</div>
    <div class="stock-info" id="stock-info">Selecciona una talla</div>

    <button class="btn btn-amarillo btn-full" style="margin-top:8px" onclick="agregarAlCarrito()">
      🛒 Agregar al carrito
    </button>
  `;

  document.getElementById("detalle-contenido").innerHTML = `
    <div class="detalle-grid">
      <div>
        <div class="detalle-img-principal" id="detalle-img-box">
          ${imgPrincipal}
        </div>
        ${galeriaHTML ? `<div class="detalle-galeria">${galeriaHTML}</div>` : ""}
      </div>
      <div>
        <div class="detalle-cat">${p.categoria_nombre || ""}</div>
        <h1 class="detalle-nombre">${p.nombre}</h1>
        <div class="detalle-precio-fan" id="precio-mostrado">${formatPrecio(precioActual)}</div>
        ${p.precio_player ? `<div class="detalle-precio-player" id="detalle-precio-sub">
          ${_versionSeleccionada === 'Fan' ? `Versión Player: ${formatPrecio(p.precio_player)}` : `Versión Fan: ${formatPrecio(p.precio)}`}
        </div>` : ""}

        ${p.descripcion ? `<p style="color:var(--texto-muted);font-size:14px;margin:16px 0;line-height:1.7">${p.descripcion}</p>` : ""}

        ${selectorHTML}

        <button class="btn btn-outline btn-full" style="margin-top:8px" onclick="irACatalogo('${p.categoria_slug || ''}')">
          ← Ver más de ${p.categoria_nombre || "este equipo"}
        </button>
      </div>
    </div>
  `;
}

function renderizarTallas(p, version) {
  const tallas = ["S", "M", "L", "XL", "XXL"];
  return tallas.map(t => {
    const inv = p.inventario.find(i => i.talla === t && i.version === version);
    const stock = inv ? inv.stock : 0;
    const activa = t === _tallaSeleccionada ? "activa" : "";
    const sinStock = stock === 0 ? "sin-stock" : "";
    return `<button class="talla-btn ${activa} ${sinStock}"
                    onclick="${stock > 0 ? `seleccionarTalla('${t}')` : ''}"
                    title="${stock > 0 ? `${stock} disponibles` : 'Sin stock'}">${t}</button>`;
  }).join("");
}

function seleccionarVersion(v) {
  _versionSeleccionada = v;
  _tallaSeleccionada = null;
  // Actualizar botones versión
  document.querySelectorAll(".version-btn").forEach(b => {
    b.classList.toggle("activo", b.textContent === v);
  });
  // Actualizar precio
  const precioActual = v === "Player" && _detalleProducto.precio_player
    ? _detalleProducto.precio_player : _detalleProducto.precio;
  document.getElementById("precio-mostrado").textContent = formatPrecio(precioActual);
  // Actualizar tallas
  document.getElementById("tallas-grid").innerHTML = renderizarTallas(_detalleProducto, v);
  document.getElementById("stock-info").textContent = "Selecciona una talla";
}

function seleccionarTalla(t) {
  _tallaSeleccionada = t;
  document.querySelectorAll(".talla-btn").forEach(b => {
    b.classList.toggle("activa", b.textContent === t);
  });
  const inv = _detalleProducto.inventario.find(i => i.talla === t && i.version === _versionSeleccionada);
  document.getElementById("stock-info").textContent =
    inv ? `${inv.stock} unidades disponibles` : "Sin stock";
}

function cambiarImgPrincipal(url) {
  const box = document.getElementById("detalle-img-box");
  if (box) box.innerHTML = `<img src="${url}" alt="producto">`;
}

function agregarAlCarrito() {
  if (!_detalleProducto) return;
  if (!_tallaSeleccionada) { toast("Selecciona una talla primero.", "error"); return; }

  const precio = _versionSeleccionada === "Player" && _detalleProducto.precio_player
    ? _detalleProducto.precio_player : _detalleProducto.precio;

  const key = `${_detalleProducto.id_producto}-${_tallaSeleccionada}-${_versionSeleccionada}`;
  const existe = carrito.find(i => i.key === key);
  if (existe) {
    existe.cantidad++;
  } else {
    carrito.push({
      key,
      id_producto: _detalleProducto.id_producto,
      nombre: _detalleProducto.nombre,
      imagen: _detalleProducto.imagen,
      talla: _tallaSeleccionada,
      version: _versionSeleccionada,
      precio,
      cantidad: 1,
    });
  }
  guardarCarrito();
  toast(`✅ ${_detalleProducto.nombre} (${_versionSeleccionada} ${_tallaSeleccionada}) agregado al carrito`, "exito");
  toggleCarrito();
}

function agregarAlCarritoSimple(id) {
  if (!_detalleProducto) return;
  const key = `${id}-simple`;
  const existe = carrito.find(i => i.key === key);
  if (existe) {
    if (_detalleProducto.stock && existe.cantidad >= _detalleProducto.stock) {
      toast("Stock insuficiente.", "error"); return;
    }
    existe.cantidad++;
  } else {
    carrito.push({
      key,
      id_producto: id,
      nombre: _detalleProducto.nombre,
      imagen: _detalleProducto.imagen,
      talla: null,
      version: null,
      precio: _detalleProducto.precio,
      cantidad: 1,
    });
  }
  guardarCarrito();
  toast(`✅ ${_detalleProducto.nombre} agregado al carrito`, "exito");
  toggleCarrito();
}

// ============================================================
// CARRITO
// ============================================================
function toggleCarrito() {
  const panel = document.getElementById("carrito-panel");
  const overlay = document.getElementById("carrito-overlay");
  const abierto = panel.classList.contains("open");
  panel.classList.toggle("open", !abierto);
  overlay.classList.toggle("open", !abierto);
  if (!abierto) renderCarrito();
  // Ocultar form de dirección al abrir
  document.getElementById("carrito-direccion").classList.add("oculto");
  document.getElementById("btn-pedir").classList.remove("oculto");
}

function renderCarrito() {
  const cont = document.getElementById("carrito-items");
  if (!carrito.length) {
    cont.innerHTML = `<div class="carrito-vacio">Tu carrito está vacío.<br>¡Agrega una camisa! 👕</div>`;
    document.getElementById("carrito-total").textContent = "$0";
    return;
  }
  let total = 0;
  cont.innerHTML = carrito.map(item => {
    const sub = item.precio * item.cantidad;
    total += sub;
    const img = item.imagen
      ? `<img src="${item.imagen}" alt="${item.nombre}">`
      : `👕`;
    return `
      <div class="carrito-item">
        <div class="carrito-item-img">${img}</div>
        <div class="carrito-item-info">
          <div class="carrito-item-nombre">${item.nombre}</div>
          <div class="carrito-item-detalle">${item.talla ? `${item.version} · Talla ${item.talla} · ` : ''}${formatPrecio(item.precio)} c/u</div>
          <div class="carrito-item-ctrl">
            <button class="qty-btn" onclick="cambiarCantidad('${item.key}', -1)">−</button>
            <span>${item.cantidad}</span>
            <button class="qty-btn" onclick="cambiarCantidad('${item.key}', 1)">+</button>
          </div>
        </div>
        <div class="carrito-item-precio">${formatPrecio(sub)}</div>
      </div>
    `;
  }).join("");
  document.getElementById("carrito-total").textContent = formatPrecio(total);
}

function cambiarCantidad(key, delta) {
  const idx = carrito.findIndex(i => i.key === key);
  if (idx === -1) return;
  carrito[idx].cantidad += delta;
  if (carrito[idx].cantidad <= 0) carrito.splice(idx, 1);
  guardarCarrito();
  renderCarrito();
}

function guardarCarrito() {
  localStorage.setItem("ej_carrito", JSON.stringify(carrito));
  actualizarBadgeCarrito();
}

function actualizarBadgeCarrito() {
  const total = carrito.reduce((s, i) => s + i.cantidad, 0);
  const badge = document.getElementById("carrito-badge");
  badge.textContent = total;
  badge.classList.toggle("oculto", total === 0);
}

// ============================================================
// HACER PEDIDO
// ============================================================
function procesarPedido() {
  if (!carrito.length) { toast("Tu carrito está vacío.", "error"); return; }
  if (!token) { cerrarCarritoSinToggle(); abrirAuth(); return; }
  // Mostrar form dirección
  document.getElementById("carrito-direccion").classList.remove("oculto");
  document.getElementById("btn-pedir").classList.add("oculto");
  // Pre-llenar dirección del perfil si existe
  if (usuario?.direccion) {
    document.getElementById("input-direccion").value = usuario.direccion;
  }
}

async function confirmarPedido() {
  const direccion = document.getElementById("input-direccion").value.trim();
  const notas = document.getElementById("input-notas").value.trim();
  if (!direccion) { toast("Ingresa tu dirección de entrega.", "error"); return; }

  const items = carrito.map(i => ({
    id_producto: i.id_producto,
    talla: i.talla,
    version: i.version,
    cantidad: i.cantidad,
  }));

  try {
    const res = await fetch(`${API}/pedidos`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ items, direccion, notas }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    toast(`🎉 ¡Pedido #${data.id_pedido} realizado! Total: ${formatPrecio(data.total)}`, "exito");
    carrito = [];
    guardarCarrito();
    renderCarrito();
    toggleCarrito();
    irAPaginaPedidos();
  } catch (e) {
    toast(e.message, "error");
  }
}

function cerrarCarritoSinToggle() {
  document.getElementById("carrito-panel").classList.remove("open");
  document.getElementById("carrito-overlay").classList.remove("open");
}

// ============================================================
// MIS PEDIDOS
// ============================================================
async function cargarMisPedidos() {
  const cont = document.getElementById("mis-pedidos-lista");
  cont.innerHTML = `<div class="loading"><div class="spinner"></div></div>`;
  try {
    const res = await fetch(`${API}/pedidos/mis`, { headers: { Authorization: `Bearer ${token}` } });
    const pedidos = await res.json();
    if (!pedidos.length) {
      cont.innerHTML = `<div class="vacio">Aún no tienes pedidos. ¡Empieza a comprar! 👕</div>`;
      return;
    }
    cont.innerHTML = pedidos.map(p => `
      <div class="pedido-card">
        <div class="pedido-card-head">
          <div class="pedido-num">Pedido #${p.id_pedido}</div>
          <span class="estado-badge estado-${p.estado}">${p.estado}</span>
        </div>
        <div style="color:var(--texto-muted);font-size:13px;margin-bottom:8px">
          ${new Date(p.creado_en).toLocaleDateString("es-CO", { day:"2-digit", month:"long", year:"numeric" })}
        </div>
        <div style="display:flex;justify-content:space-between;align-items:center">
          <div style="font-family:var(--font-display);font-size:22px;color:var(--amarillo)">
            ${formatPrecio(p.total)}
          </div>
          ${p.direccion ? `<div style="font-size:12px;color:var(--texto-muted)">📍 ${p.direccion}</div>` : ""}
        </div>
      </div>
    `).join("");
  } catch (e) {
    cont.innerHTML = `<div class="vacio">Error cargando pedidos.</div>`;
  }
}

// ============================================================
// AUTH (Login / Registro)
// ============================================================
function abrirAuth() {
  document.getElementById("modal-auth").classList.add("open");
  document.getElementById("auth-error").classList.remove("show");
}
function cerrarAuth() {
  document.getElementById("modal-auth").classList.remove("open");
}
document.getElementById("modal-auth").addEventListener("click", e => {
  if (e.target === document.getElementById("modal-auth")) cerrarAuth();
});

let _rolLogin = "cliente";

function setLoginRole(role) {
  _rolLogin = role;
  const btnCliente = document.getElementById("role-btn-cliente");
  const btnAdmin = document.getElementById("role-btn-admin");
  const labelUser = document.getElementById("login-label-user");
  const inputEmail = document.getElementById("login-email");
  
  if (!btnCliente || !btnAdmin || !labelUser || !inputEmail) return;
  
  if (role === "admin") {
    btnAdmin.classList.add("active");
    btnCliente.classList.remove("active");
    btnAdmin.style.background = "var(--amarillo)";
    btnAdmin.style.color = "var(--negro)";
    btnCliente.style.background = "none";
    btnCliente.style.color = "var(--texto-muted)";
    
    labelUser.textContent = "Usuario";
    inputEmail.type = "text";
    inputEmail.placeholder = "Nombre de usuario o Correo";
  } else {
    btnCliente.classList.add("active");
    btnAdmin.classList.remove("active");
    btnCliente.style.background = "var(--amarillo)";
    btnCliente.style.color = "var(--negro)";
    btnAdmin.style.background = "none";
    btnAdmin.style.color = "var(--texto-muted)";
    
    labelUser.textContent = "Correo electrónico";
    inputEmail.type = "email";
    inputEmail.placeholder = "tu@correo.com";
  }
}

function cambiarTabAuth(tab) {
  document.querySelectorAll(".modal-tab").forEach((t, i) => {
    t.classList.toggle("activo", (i === 0 && tab === "login") || (i === 1 && tab === "registro"));
  });
  document.getElementById("form-login").classList.toggle("oculto", tab !== "login");
  document.getElementById("form-registro").classList.toggle("oculto", tab !== "registro");
  document.getElementById("login-role-selector").classList.toggle("oculto", tab !== "login");
  document.getElementById("auth-error").classList.remove("show");
  if (tab === "login") {
    setLoginRole("cliente");
  }
}

function mostrarErrorAuth(msg) {
  const el = document.getElementById("auth-error");
  el.textContent = msg;
  el.classList.add("show");
}

async function handleLogin(e) {
  e.preventDefault();
  const btn = document.getElementById("btn-login-submit");
  btn.textContent = "Entrando..."; btn.disabled = true;
  
  const emailInputVal = document.getElementById("login-email").value.trim();
  const passInputVal = document.getElementById("login-pass").value;
  
  const body = {};
  if (_rolLogin === "admin") {
    if (emailInputVal.includes("@")) {
      body.email = emailInputVal;
    } else {
      body.username = emailInputVal;
    }
  } else {
    body.email = emailInputVal;
  }
  body.password = passInputVal;

  try {
    const res = await fetch(`${API}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    if (_rolLogin === "admin") {
      // Guardar token y datos del usuario de gestión (POS)
      localStorage.setItem("td_token", data.token);
      localStorage.setItem("td_user", JSON.stringify(data.usuario));
      cerrarAuth();
      toast(`¡Bienvenido Administrador, ${data.usuario.username || data.usuario.nombre}!`, "exito");
      window.location.href = "/panel/index.html";
    } else {
      guardarSesion(data);
      cerrarAuth();
      toast(`¡Bienvenido, ${data.usuario.nombre}!`, "exito");
      if (data.usuario.rol === "admin") {
        window.location.href = "/panel/index.html";
      }
    }
  } catch (e) {
    mostrarErrorAuth(e.message);
  } finally {
    btn.textContent = "Entrar a mi cuenta"; btn.disabled = false;
  }
}

async function handleRegistro(e) {
  e.preventDefault();
  const pass  = document.getElementById("reg-pass").value;
  const pass2 = document.getElementById("reg-pass2").value;
  if (pass !== pass2) { mostrarErrorAuth("Las contraseñas no coinciden."); return; }

  const btn = document.getElementById("btn-reg-submit");
  btn.textContent = "Creando cuenta..."; btn.disabled = true;
  try {
    const res = await fetch(`${API}/auth/registro`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        nombre:    document.getElementById("reg-nombre").value,
        apellido:  document.getElementById("reg-apellido").value,
        email:     document.getElementById("reg-email").value,
        telefono:  document.getElementById("reg-telefono").value,
        direccion: document.getElementById("reg-direccion").value,
        password:  pass,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    guardarSesion(data);
    cerrarAuth();
    toast(`🎉 ¡Cuenta creada! Bienvenido, ${data.usuario.nombre}!`, "exito");
  } catch (e) {
    mostrarErrorAuth(e.message);
  } finally {
    btn.textContent = "Crear mi cuenta"; btn.disabled = false;
  }
}

function guardarSesion(data) {
  token = data.token;
  usuario = data.usuario;
  localStorage.setItem("ej_token", token);
  localStorage.setItem("ej_usuario", JSON.stringify(usuario));
  actualizarUIUsuario();
}

function actualizarUIUsuario() {
  const area = document.getElementById("btn-usuario-area");
  if (usuario && token) {
    area.innerHTML = `
      <div style="display:flex;gap:8px;align-items:center">
        <button class="btn-user" onclick="irAPaginaPedidos()">📦 Mis pedidos</button>
        <button class="btn-user" onclick="cerrarSesion()">Salir</button>
      </div>
    `;
  } else {
    area.innerHTML = `<button class="btn-user" onclick="abrirAuth()">Iniciar sesión</button>`;
  }
}

function cerrarSesion() {
  token = null; usuario = null;
  localStorage.removeItem("ej_token");
  localStorage.removeItem("ej_usuario");
  actualizarUIUsuario();
  irAPagina("inicio");
  toast("Sesión cerrada.", "info");
}

// ============================================================
// UTILIDADES
// ============================================================
function formatPrecio(n) {
  return new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", minimumFractionDigits: 0 }).format(n);
}

function toast(msg, tipo = "info") {
  const cont = document.getElementById("toasts");
  const t = document.createElement("div");
  t.className = `toast ${tipo}`;
  t.textContent = msg;
  cont.appendChild(t);
  setTimeout(() => t.remove(), 4000);
  t.onclick = () => t.remove();
}
