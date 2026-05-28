// ============================================================
// js/api.js - Cliente HTTP centralizado para la API
// Todas las llamadas al backend pasan por aqui.
// Lee el token JWT del localStorage automaticamente.
// ============================================================

const API_BASE = "/api";

/**
 * Funcion base para fetch con manejo de errores y JWT.
 * @param {string} endpoint - Ruta relativa: '/productos', '/auth/login', etc.
 * @param {object} options  - Opciones fetch adicionales.
 */
async function apiFetch(endpoint, options = {}) {
  const token = localStorage.getItem("td_token");

  const headers = {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...options.headers,
  };

  const res = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    headers,
  });

  // Si devuelve 401, la sesion expiro -> redirigir a login
  if (res.status === 401) {
    localStorage.removeItem("td_token");
    localStorage.removeItem("td_user");
    window.location.href = "login.html";
    return;
  }

  const data = await res.json();

  if (!res.ok) {
    throw new Error(data.error || "Error en la solicitud.");
  }

  return data;
}

// ---- Metodos conveniencia -----------------------------------

const API = {
  // Auth
  login:    (body) => apiFetch("/auth/login",    { method: "POST", body: JSON.stringify(body) }),
  register: (body) => apiFetch("/auth/register", { method: "POST", body: JSON.stringify(body) }),

  // Productos
  getProductos:  ()     => apiFetch("/productos"),
  getProducto:   (id)   => apiFetch(`/productos/${id}`),
  createProducto:(body) => apiFetch("/productos", { method: "POST", body: JSON.stringify(body) }),
  updateProducto:(id, body) => apiFetch(`/productos/${id}`, { method: "PUT", body: JSON.stringify(body) }),
  deleteProducto:(id)   => apiFetch(`/productos/${id}`, { method: "DELETE" }),
  uploadImagen:  (id, file) => {
    const fd = new FormData(); fd.append("imagen", file);
    const token = localStorage.getItem("td_token");
    return fetch(`${API_BASE}/productos/${id}/imagen`, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: fd }).then(async (res) => { const data = await res.json(); if (!res.ok) throw new Error(data.error || "Error subiendo imagen."); return data; });
  },
  agregarStock:   (id, body) => apiFetch(`/productos/${id}/agregar-stock`, { method: "POST", body: JSON.stringify(body) }),
  getCostos:      () => apiFetch("/productos/costos"),
  getComprasMovimientos: () => apiFetch("/productos/compras"),
  getCompraDetalle: (ref) => apiFetch(`/productos/compras/${ref}`),
  getDashboardPeriodo: (periodo, query="") => apiFetch(`/dashboard/stats?periodo=${periodo}${query}`),
  getDashboardCompras: (periodo, query="") => apiFetch(`/dashboard/stats-compras?periodo=${periodo}${query}`),

  // Categorias
  getCategorias:  ()     => apiFetch("/categorias"),
  createCategoria:(body) => apiFetch("/categorias", { method: "POST", body: JSON.stringify(body) }),
  updateCategoria:(id, body) => apiFetch(`/categorias/${id}`, { method: "PUT", body: JSON.stringify(body) }),
  deleteCategoria:(id)   => apiFetch(`/categorias/${id}`, { method: "DELETE" }),

  // Clientes (con password)
  getClientes:      ()     => apiFetch("/clientes"),
  getCliente:       (id)   => apiFetch(`/clientes/${id}`),
  createCliente:    (body) => apiFetch("/clientes", { method: "POST", body: JSON.stringify(body) }),
  updateCliente:    (id, body) => apiFetch(`/clientes/${id}`, { method: "PUT", body: JSON.stringify(body) }),
  resetClientePass: (id)   => apiFetch(`/clientes/${id}/reset-password`, { method: "PUT" }),
  deleteCliente:    (id)   => apiFetch(`/clientes/${id}`, { method: "DELETE" }),

  // Ventas
  getVentas:     ()     => apiFetch("/ventas"),
  getVenta:      (id)   => apiFetch(`/ventas/${id}`),
  createVenta:   (body) => apiFetch("/ventas", { method: "POST", body: JSON.stringify(body) }),
  deleteVenta:   (id)   => apiFetch(`/ventas/${id}`, { method: "DELETE" }),

  // Dashboard
  getDashboard: () => apiFetch("/dashboard/stats"),

  // Pedidos pendientes (aprobacion)
  getPendientes:   ()   => apiFetch("/pedidos/pendientes"),
  getPedidosTodos: ()   => apiFetch("/pedidos/todos"),
  getDetallePedido:(id) => apiFetch(`/pedidos/${id}/detalle`),
  aprobarPedido:   (id) => apiFetch(`/pedidos/${id}/aprobar`, { method: "PUT" }),
  rechazarPedido:  (id) => apiFetch(`/pedidos/${id}/rechazar`, { method: "PUT" }),
  deletePedido:   (id) => apiFetch(`/pedidos/${id}`, { method: "DELETE" }),


  // Usuarios (admin)
  getUsuarios:       (buscar) => apiFetch(`/usuarios${buscar ? `?buscar=${encodeURIComponent(buscar)}` : ""}`),
  getUsuario:        (id)     => apiFetch(`/usuarios/${id}`),
  createUsuario:     (body)   => apiFetch("/usuarios", { method: "POST", body: JSON.stringify(body) }),
  updateUsuario:     (id, body) => apiFetch(`/usuarios/${id}`, { method: "PUT", body: JSON.stringify(body) }),
  resetPassword:     (id)     => apiFetch(`/usuarios/${id}/reset-password`, { method: "PUT" }),
  deleteUsuario:     (id)     => apiFetch(`/usuarios/${id}`, { method: "DELETE" }),

  getDevoluciones:   ()       => apiFetch(`/devoluciones`),
  createDevolucion:  (body)   => apiFetch(`/devoluciones`, { method: "POST", body: JSON.stringify(body) }),
  updateEstadoDevolucion: (id, estado) => apiFetch(`/devoluciones/${id}/estado`, { method: "PUT", body: JSON.stringify({ estado }) }),
  deleteDevolucion: (id) => apiFetch(`/devoluciones/${id}`, { method: "DELETE" }),

  // Proveedores
  getProveedores:    () => apiFetch("/proveedores"),
  getProveedor:     (id) => apiFetch(`/proveedores/${id}`),
  createProveedor:  (body) => apiFetch("/proveedores", { method: "POST", body: JSON.stringify(body) }),
  updateProveedor:  (id, body) => apiFetch(`/proveedores/${id}`, { method: "PUT", body: JSON.stringify(body) }),
  deleteProveedor:  (id) => apiFetch(`/proveedores/${id}`, { method: "DELETE" }),
};

// ============================================================
// js/utils.js - Utilidades globales
// ============================================================

/** Muestra un toast de notificacion. tipo: 'success' | 'error' | 'info' */
function showToast(msg, tipo = "success") {
  const container = document.getElementById("toast-container");
  if (!container) return;
  const t = document.createElement("div");
  t.className = `toast ${tipo}`;
  t.textContent = msg;
  container.appendChild(t);
  setTimeout(() => t.remove(), 3000);
  t.onclick = () => t.remove();
}

/** Formatea un numero como precio colombiano o comun */
function formatPrice(n) {
  return new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: "COP",
    minimumFractionDigits: 0,
  }).format(n);
}

/** Formatea una fecha ISO a legible */
function formatDate(d) {
  return new Date(d).toLocaleString("es-CO", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

/** Obtiene el usuario del localStorage */
function getCurrentUser() {
  try {
    return JSON.parse(localStorage.getItem("td_user") || "null");
  } catch { return null; }
}

/** Redirige a login si no hay sesion */
function requireAuth() {
  const token = localStorage.getItem("td_token");
  if (!token) {
    window.location.href = "login.html";
  }
}

/** Navega entre secciones (SPA simple) */
function navigateTo(page) {
  // Actualiza nav activo
  document.querySelectorAll(".nav-item").forEach(el => {
    el.classList.toggle("active", el.dataset.page === page);
  });
  // Actualiza titulo topbar
  const titles = {
    dashboard: "Dashboard",
    "dashboard-compras": "Dashboard Compras y Devoluciones",
    ventas: "Punto de Venta",
    historial: "Historial de Ventas",
    pendientes: "Ventas Pendientes",
    categorias: "Categorías",
    inventario: "Productos",
    compras: "Compras",
    clientes: "Clientes",
    usuarios: "Usuarios",
    devoluciones: "Devoluciones",
    proveedores: "Proveedores",
  };
  const titleEl = document.getElementById("page-title");
  if (titleEl) titleEl.textContent = titles[page] || page;

  // Oculta todas las secciones, muestra la correcta
  document.querySelectorAll(".page-section").forEach(s => s.classList.add("hidden"));
  const target = document.getElementById("section-" + page);
  if (target) {
    target.classList.remove("hidden");
    // Llama la funcion de carga si existe
    const loaders = {
      dashboard: loadDashboard,
      "dashboard-compras": cargarDashboardCompras,
      ventas: loadVentas,
      historial: loadHistorial,
      pendientes: loadPendientes,
      categorias: loadCategorias,
      inventario: loadInventario,
      compras: loadCompras,
      clientes: loadClientes,
      usuarios: loadUsuarios,
      devoluciones: loadDevoluciones,
      proveedores: loadProveedores,
    };
    if (loaders[page]) loaders[page]();
  }
}
