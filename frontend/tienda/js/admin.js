// ============================================================
// admin.js - Lógica del panel de administración EleJeserys
// ============================================================
const API = "/api";

let token   = localStorage.getItem("ej_token");
let usuario = JSON.parse(localStorage.getItem("ej_usuario") || "null");
let _categorias = [];

// Verificar que sea admin
if (!token || !usuario || usuario.rol !== "admin") {
  window.location.href = "/admin/login.html";
}

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

document.addEventListener("DOMContentLoaded", () => {
  initTheme();
  cargarStats();
  cargarCategorias();
});

// ============================================================
// NAVEGACIÓN SECCIONES
// ============================================================
function mostrarSeccion(id, btn) {
  document.querySelectorAll("[id^='sec-']").forEach(s => s.classList.add("oculto"));
  document.getElementById("sec-" + id).classList.remove("oculto");
  document.querySelectorAll(".admin-nav-item").forEach(b => b.classList.remove("activo"));
  btn.classList.add("activo");

  const titulos = { dashboard:"Dashboard", productos:"Productos", categorias:"Categorías", pedidos:"Pedidos", clientes:"Clientes", usuarios:"Usuarios" };
  document.getElementById("admin-titulo").textContent = titulos[id] || id;

  const loaders = { productos: cargarProductosAdmin, pedidos: cargarTodosPedidos, clientes: cargarClientesAdmin, categorias: cargarCategoriasAdmin, usuarios: cargarUsuarios };
  if (loaders[id]) loaders[id]();
}

function abrirModal(id) { document.getElementById(id).classList.add("open"); }
function cerrarModal(id) { document.getElementById(id).classList.remove("open"); }
document.querySelectorAll(".modal-overlay").forEach(o => o.addEventListener("click", e => { if (e.target === o) o.classList.remove("open"); }));

// ============================================================
// DASHBOARD STATS
// ============================================================
async function cargarStats() {
  try {
    const res = await fetch(`${API}/admin/stats`, { headers: { Authorization: `Bearer ${token}` } });
    const d = await res.json();

    document.getElementById("admin-stats").innerHTML = `
      <div class="stat"><div class="stat-label">Pedidos hoy</div><div class="stat-val">${d.pedidosHoy}</div></div>
      <div class="stat verde"><div class="stat-label">Ingresos hoy</div><div class="stat-val">${fmt(d.ingresosHoy)}</div></div>
      <div class="stat azul"><div class="stat-label">Pendientes</div><div class="stat-val">${d.pendientes}</div></div>
      <div class="stat rojo"><div class="stat-label">Stock bajo</div><div class="stat-val">${d.stockBajo}</div></div>
      <div class="stat"><div class="stat-label">Clientes</div><div class="stat-val">${d.totalClientes}</div></div>
    `;

    document.getElementById("tabla-pedidos-recientes").innerHTML =
      d.pedidosRecientes.map(p => `
        <tr>
          <td>#${p.id_pedido}</td>
          <td>${p.cliente}</td>
          <td style="color:var(--amarillo)">${fmt(p.total)}</td>
          <td><span class="estado-badge estado-${p.estado}">${p.estado}</span></td>
          <td style="color:var(--texto-muted);font-size:12px">${new Date(p.creado_en).toLocaleDateString("es-CO")}</td>
          <td><button class="btn btn-outline btn-sm" onclick="mostrarSeccion('pedidos', document.querySelector('[data-sec=pedidos]'))">Ver todos</button></td>
        </tr>
      `).join("");
  } catch (e) { console.error(e); }
}

// ============================================================
// PRODUCTOS ADMIN
// ============================================================
async function cargarProductosAdmin() {
  const tbody = document.getElementById("tabla-productos-admin");
  tbody.innerHTML = `<tr><td colspan="8"><div class="loading"><div class="spinner"></div></div></td></tr>`;
  try {
    const res = await fetch(`${API}/productos?`, { headers: { Authorization: `Bearer ${token}` } });
    // Admin necesita todos incluso inactivos; usar endpoint distinto si se desea
    const prods = await res.json();
    tbody.innerHTML = prods.map(p => `
      <tr>
        <td style="color:var(--texto-muted)">#${p.id_producto}</td>
        <td>
          ${p.imagen ? `<img src="${p.imagen}" style="width:40px;height:40px;object-fit:cover;border-radius:6px">` : "👕"}
        </td>
        <td><strong>${p.nombre}</strong></td>
        <td>${p.categoria_nombre || "—"}</td>
        <td style="color:var(--amarillo)">${fmt(p.precio)}</td>
        <td style="color:var(--texto-muted)">${p.precio_player ? fmt(p.precio_player) : "—"}</td>
        <td><span style="color:${p.activo ? 'var(--exito)' : 'var(--error)'}">${p.activo ? "✅" : "❌"}</span></td>
        <td>
          <button class="btn btn-outline btn-sm" onclick="editarProducto(${p.id_producto})">✏️ Editar</button>
        </td>
      </tr>
    `).join("") || `<tr><td colspan="8" class="vacio">Sin productos.</td></tr>`;
  } catch (e) { toast("Error cargando productos.", "error"); }
}

// ============================================================
// MODAL PRODUCTO
// ============================================================
let _editandoProductoId = null;

async function abrirModalProducto() {
  _editandoProductoId = null;
  document.getElementById("modal-prod-titulo").textContent = "Nuevo producto";
  document.getElementById("prod-id").value = "";
  document.getElementById("prod-nombre").value = "";
  document.getElementById("prod-precio").value = "";
  document.getElementById("prod-precio-player").value = "";
  document.getElementById("prod-desc").value = "";
  document.getElementById("prod-destacado").checked = false;
  document.getElementById("img-preview").innerHTML = "";
  ["S","M","L","XL","XXL"].forEach(t => {
    document.getElementById(`inv-${t}-Fan`).value = 0;
    document.getElementById(`inv-${t}-Player`).value = 0;
  });
  await cargarCategoriasEnSelect();
  abrirModal("modal-producto");
}

async function editarProducto(id) {
  _editandoProductoId = id;
  try {
    const res = await fetch(`${API}/productos/${id}`);
    const p = await res.json();
    document.getElementById("modal-prod-titulo").textContent = "Editar producto";
    document.getElementById("prod-id").value = p.id_producto;
    document.getElementById("prod-nombre").value = p.nombre;
    document.getElementById("prod-precio").value = p.precio;
    document.getElementById("prod-precio-player").value = p.precio_player || "";
    document.getElementById("prod-desc").value = p.descripcion || "";
    document.getElementById("prod-destacado").checked = p.destacado == 1;
    if (p.imagen) document.getElementById("img-preview").innerHTML = `<img src="${p.imagen}" style="width:80px;height:80px;object-fit:cover;border-radius:8px;margin-top:8px">`;

    // Inventario existente
    p.inventario.forEach(i => {
      const el = document.getElementById(`inv-${i.talla}-${i.version}`);
      if (el) el.value = i.stock;
    });

    await cargarCategoriasEnSelect(p.id_categoria);
    abrirModal("modal-producto");
  } catch (e) { toast("Error cargando producto.", "error"); }
}

async function cargarCategoriasEnSelect(seleccionada = null) {
  const sel = document.getElementById("prod-categoria");
  sel.innerHTML = `<option value="">Sin categoría</option>` +
    _categorias.map(c => `<option value="${c.id_categoria}" ${c.id_categoria == seleccionada ? "selected" : ""}>${c.nombre}</option>`).join("");
}

async function guardarProducto() {
  const id = document.getElementById("prod-id").value;
  const nombre = document.getElementById("prod-nombre").value.trim();
  const precio = parseFloat(document.getElementById("prod-precio").value);
  if (!nombre || isNaN(precio)) { toast("Nombre y precio son requeridos.", "error"); return; }

  const body = {
    nombre,
    descripcion: document.getElementById("prod-desc").value,
    precio,
    precio_player: parseFloat(document.getElementById("prod-precio-player").value) || null,
    id_categoria: document.getElementById("prod-categoria").value || null,
    destacado: document.getElementById("prod-destacado").checked ? 1 : 0,
    activo: 1,
  };

  try {
    let prodId = id;
    if (id) {
      await fetchAdmin(`/productos/${id}`, "PUT", body);
      toast("Producto actualizado.", "exito");
    } else {
      const r = await fetchAdmin("/productos", "POST", body);
      prodId = r.id_producto;
      toast("Producto creado.", "exito");
    }

    // Actualizar inventario
    const inventario = [];
    ["S","M","L","XL","XXL"].forEach(t => {
      inventario.push({ talla: t, version: "Fan",    stock: parseInt(document.getElementById(`inv-${t}-Fan`).value) || 0 });
      inventario.push({ talla: t, version: "Player", stock: parseInt(document.getElementById(`inv-${t}-Player`).value) || 0 });
    });
    await fetchAdmin(`/productos/${prodId}/inventario`, "PUT", { inventario });

    // Subir imagen si hay
    const imgInput = document.getElementById("prod-imagen");
    if (imgInput.files[0]) {
      const fd = new FormData();
      fd.append("imagen", imgInput.files[0]);
      await fetch(`${API}/productos/${prodId}/imagen`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: fd,
      });
    }

    cerrarModal("modal-producto");
    cargarProductosAdmin();
  } catch (e) { toast(e.message, "error"); }
}

// Preview imagen al seleccionar
document.getElementById("prod-imagen")?.addEventListener("change", function() {
  const file = this.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    document.getElementById("img-preview").innerHTML =
      `<img src="${e.target.result}" style="width:80px;height:80px;object-fit:cover;border-radius:8px;margin-top:8px">`;
  };
  reader.readAsDataURL(file);
});

// ============================================================
// CATEGORÍAS ADMIN
// ============================================================
async function cargarCategorias() {
  const res = await fetch(`${API}/categorias`);
  _categorias = await res.json();
}

async function cargarCategoriasAdmin() {
  await cargarCategorias();
  const tbody = document.getElementById("tabla-categorias-admin");
  tbody.innerHTML = _categorias.map(c => `
    <tr>
      <td>#${c.id_categoria}</td>
      <td><strong>${c.nombre}</strong></td>
      <td style="color:var(--texto-muted)">${c.slug}</td>
      <td>${c.descripcion || "—"}</td>
      <td><button class="btn btn-outline btn-sm" onclick="editarCategoria(${c.id_categoria})">✏️</button></td>
    </tr>
  `).join("");
}

function abrirModalCategoria() {
  document.getElementById("modal-cat-titulo").textContent = "Nueva categoría";
  document.getElementById("cat-id").value = "";
  document.getElementById("cat-nombre").value = "";
  document.getElementById("cat-slug").value = "";
  document.getElementById("cat-desc").value = "";
  abrirModal("modal-categoria");
}

function editarCategoria(id) {
  const c = _categorias.find(x => x.id_categoria === id);
  if (!c) return;
  document.getElementById("modal-cat-titulo").textContent = "Editar categoría";
  document.getElementById("cat-id").value = c.id_categoria;
  document.getElementById("cat-nombre").value = c.nombre;
  document.getElementById("cat-slug").value = c.slug;
  document.getElementById("cat-desc").value = c.descripcion || "";
  abrirModal("modal-categoria");
}

// Auto-generar slug
document.getElementById("cat-nombre")?.addEventListener("input", function() {
  const slugEl = document.getElementById("cat-slug");
  if (!document.getElementById("cat-id").value) {
    slugEl.value = this.value.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
  }
});

async function guardarCategoria() {
  const id = document.getElementById("cat-id").value;
  const body = {
    nombre: document.getElementById("cat-nombre").value.trim(),
    slug:   document.getElementById("cat-slug").value.trim(),
    descripcion: document.getElementById("cat-desc").value,
    activo: 1,
  };
  if (!body.nombre || !body.slug) { toast("Nombre y slug son requeridos.", "error"); return; }
  try {
    if (id) {
      await fetchAdmin(`/categorias/${id}`, "PUT", body);
      toast("Categoría actualizada.", "exito");
    } else {
      await fetchAdmin("/categorias", "POST", body);
      toast("Categoría creada.", "exito");
    }
    cerrarModal("modal-categoria");
    cargarCategoriasAdmin();
    cargarCategorias();
  } catch (e) { toast(e.message, "error"); }
}

// ============================================================
// PEDIDOS ADMIN
// ============================================================
async function cargarTodosPedidos() {
  const tbody = document.getElementById("tabla-todos-pedidos");
  tbody.innerHTML = `<tr><td colspan="6"><div class="loading"><div class="spinner"></div></div></td></tr>`;
  try {
    const pedidos = await fetchAdmin("/admin/pedidos", "GET");
    tbody.innerHTML = pedidos.map(p => `
      <tr>
        <td>#${p.id_pedido}</td>
        <td><div>${p.cliente}</div><div style="font-size:11px;color:var(--texto-muted)">${p.email}</div></td>
        <td style="color:var(--amarillo)">${fmt(p.total)}</td>
        <td><span class="estado-badge estado-${p.estado}">${p.estado}</span></td>
        <td style="font-size:12px;color:var(--texto-muted)">${new Date(p.creado_en).toLocaleDateString("es-CO")}</td>
        <td>
          <select onchange="cambiarEstado(${p.id_pedido}, this.value)" style="background:var(--gris2);border:1px solid var(--borde);color:var(--texto);padding:5px 8px;border-radius:6px;font-size:12px">
            ${["pendiente","confirmado","enviado","entregado","cancelado"].map(e =>
              `<option value="${e}" ${e === p.estado ? "selected" : ""}>${e}</option>`
            ).join("")}
          </select>
        </td>
      </tr>
    `).join("") || `<tr><td colspan="6" class="vacio">Sin pedidos.</td></tr>`;
  } catch (e) { toast("Error cargando pedidos.", "error"); }
}

async function cambiarEstado(id, estado) {
  try {
    await fetchAdmin(`/pedidos/${id}/estado`, "PUT", { estado });
    toast("Estado actualizado.", "exito");
    cargarStats();
  } catch (e) { toast(e.message, "error"); }
}

// ============================================================
// CLIENTES ADMIN
// ============================================================
async function cargarClientesAdmin() {
  const tbody = document.getElementById("tabla-clientes-admin");
  tbody.innerHTML = `<tr><td colspan="5"><div class="loading"><div class="spinner"></div></div></td></tr>`;
  try {
    const clientes = await fetchAdmin("/admin/clientes", "GET");
    tbody.innerHTML = clientes.map(c => `
      <tr>
        <td style="color:var(--texto-muted)">${c.cedula || "—"}</td>
        <td>${c.nombre} ${c.apellido}</td>
        <td>${c.email}</td>
        <td>${c.telefono || "—"}</td>
        <td style="font-size:12px;color:var(--texto-muted)">${new Date(c.creado_en).toLocaleDateString("es-CO")}</td>
      </tr>
    `).join("") || `<tr><td colspan="5" class="vacio">Sin clientes.</td></tr>`;
  } catch (e) { toast("Error cargando clientes.", "error"); }
}

// ============================================================
// UTILIDADES
// ============================================================
async function fetchAdmin(endpoint, method = "GET", body = null) {
  const opts = { method, headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` } };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${API}${endpoint}`, opts);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Error en la solicitud.");
  return data;
}

function fmt(n) {
  return new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", minimumFractionDigits: 0 }).format(n);
}

function toast(msg, tipo = "info") {
  const cont = document.getElementById("toasts");
  const t = document.createElement("div");
  t.className = `toast ${tipo === "exito" ? "exito" : tipo === "error" ? "error" : "info"}`;
  t.textContent = msg;
  cont.appendChild(t);
  setTimeout(() => t.remove(), 4000);
  t.onclick = () => t.remove();
}

function cerrarSesionAdmin() {
  localStorage.removeItem("ej_token");
  localStorage.removeItem("ej_usuario");
  window.location.href = "/admin/login.html";
}

// ============================================================
// CRUD USUARIOS
// ============================================================
async function cargarUsuarios() {
  const tbody = document.getElementById("tabla-usuarios-admin");
  tbody.innerHTML = `<tr><td colspan="7"><div class="loading"><div class="spinner"></div></div></td></tr>`;
  try {
    const buscar = document.getElementById("buscar-usuario")?.value || "";
    const q = buscar ? `?buscar=${encodeURIComponent(buscar)}` : "";
    const usuarios = await fetchAdmin(`/admin/usuarios${q}`, "GET");
    if (!usuarios.length) {
      tbody.innerHTML = `<tr><td colspan="7" class="vacio">No hay usuarios registrados.</td></tr>`;
      return;
    }
    tbody.innerHTML = usuarios.map(u => `
      <tr>
        <td style="color:var(--texto-muted)">${u.cedula || "—"}</td>
        <td><strong>${u.nombre} ${u.apellido}</strong></td>
        <td>${u.email}</td>
        <td>${u.telefono || "—"}</td>
        <td><span style="color:${u.rol==='admin' ? 'var(--amarillo)' : u.rol==='empleado' ? 'var(--exito)' : 'var(--texto)'}">${u.rol}</span></td>
        <td><span style="color:${u.activo ? 'var(--exito)' : 'var(--error)'}">${u.activo ? "✅" : "❌"}</span></td>
        <td>
          <button class="btn btn-outline btn-sm" onclick="editarUsuario(${u.id_usuario})">✏️</button>
        </td>
      </tr>
    `).join("");
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="7" class="vacio">Error cargando usuarios.</td></tr>`;
  }
}

function abrirModalUsuario() {
  document.getElementById("modal-usr-titulo").textContent = "Nuevo usuario";
  document.getElementById("usr-id").value = "";
  document.getElementById("usr-cedula").value = "";
  document.getElementById("usr-nombre").value = "";
  document.getElementById("usr-apellido").value = "";
  document.getElementById("usr-email").value = "";
  document.getElementById("usr-telefono").value = "";
  document.getElementById("usr-direccion").value = "";
  document.getElementById("usr-rol").value = "cliente";
  document.getElementById("usr-info-password").style.display = "block";
  document.getElementById("btn-eliminar-usuario").style.display = "none";
  document.getElementById("btn-reset-password").style.display = "none";
  abrirModal("modal-usuario");
}

async function editarUsuario(id) {
  try {
    const u = await fetchAdmin(`/admin/usuarios/${id}`, "GET");
    document.getElementById("modal-usr-titulo").textContent = "Editar usuario";
    document.getElementById("usr-id").value = u.id_usuario;
    document.getElementById("usr-cedula").value = u.cedula || "";
    document.getElementById("usr-nombre").value = u.nombre || "";
    document.getElementById("usr-apellido").value = u.apellido || "";
    document.getElementById("usr-email").value = u.email || "";
    document.getElementById("usr-telefono").value = u.telefono || "";
    document.getElementById("usr-direccion").value = u.direccion || "";
    document.getElementById("usr-rol").value = u.rol;
    document.getElementById("usr-info-password").style.display = "none";
    document.getElementById("btn-eliminar-usuario").style.display = "inline-flex";
    document.getElementById("btn-reset-password").style.display = "inline-flex";
    abrirModal("modal-usuario");
  } catch (e) {
    toast("Error cargando usuario.", "error");
  }
}

async function guardarUsuario() {
  const id = document.getElementById("usr-id").value;
  const body = {
    cedula: document.getElementById("usr-cedula").value.trim(),
    nombre: document.getElementById("usr-nombre").value.trim(),
    apellido: document.getElementById("usr-apellido").value.trim(),
    email: document.getElementById("usr-email").value.trim(),
    telefono: document.getElementById("usr-telefono").value.trim(),
    direccion: document.getElementById("usr-direccion").value.trim(),
    rol: document.getElementById("usr-rol").value,
  };

  if (!body.cedula || !body.nombre || !body.apellido || !body.email) {
    toast("Cedula, nombre, apellido y correo son obligatorios.", "error");
    return;
  }

  try {
    if (id) {
      await fetchAdmin(`/admin/usuarios/${id}`, "PUT", body);
      toast("Usuario actualizado.", "exito");
    } else {
      await fetchAdmin("/admin/usuarios", "POST", body);
      toast("Usuario creado. Contraseña: la cédula.", "exito");
    }
    cerrarModal("modal-usuario");
    cargarUsuarios();
  } catch (e) {
    toast(e.message, "error");
  }
}

async function eliminarUsuario() {
  const id = document.getElementById("usr-id").value;
  const nombre = document.getElementById("usr-nombre").value;
  if (!confirm(`¿Desactivar usuario "${nombre}"?`)) return;
  try {
    await fetchAdmin(`/admin/usuarios/${id}`, "DELETE");
    toast("Usuario desactivado.", "exito");
    cerrarModal("modal-usuario");
    cargarUsuarios();
  } catch (e) {
    toast(e.message, "error");
  }
}

async function resetPasswordUsuario() {
  const id = document.getElementById("usr-id").value;
  const cedula = document.getElementById("usr-cedula").value;
  if (!confirm(`¿Restablecer contraseña a la cédula "${cedula}"?`)) return;
  try {
    await fetchAdmin(`/admin/usuarios/${id}/reset-password`, "PUT");
    toast("Contraseña restablecida a la cédula.", "exito");
  } catch (e) {
    toast(e.message, "error");
  }
}
