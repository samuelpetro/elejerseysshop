// ============================================================
// js/app.js - Logica principal del panel de gestión
// Carga de datos, renderizado de tablas, modales y acciones
// ============================================================

// ---- Estado global de la aplicacion -----------------------
let _productos  = []; // cache de productos
let _clientes   = []; // cache de clientes
let _categorias = []; // cache de categorias
let _carrito    = []; // items del carrito actual
let _usuarios   = []; // cache de usuarios
let _productosPorCategoria = []; // cache de productos por categoria para el dashboard

// ============================================================
// INICIALIZACION
// ============================================================
document.addEventListener("DOMContentLoaded", () => {
  requireAuth(); // Redirige a login si no hay token
  initTheme(); // Inicializa el tema claro/oscuro

  // Cargar info del usuario en la sidebar
  const user = getCurrentUser();
  if (user) {
    document.getElementById("user-name").textContent = user.username;
    document.getElementById("user-role").textContent = user.rol;
    document.getElementById("user-avatar").textContent = user.username[0].toUpperCase();

    // Ocultar botones de admin a empleados
    if (user.rol !== "admin") {
      document.querySelectorAll(".admin-only").forEach(el => el.classList.add("hidden"));
    }
  }

  // Fecha en topbar
  document.getElementById("topbar-date").textContent =
    new Date().toLocaleDateString("es-CO", { weekday:"long", year:"numeric", month:"long", day:"numeric" });

  // Cargar la pagina inicial
  const paginaInicial = user?.rol === "admin" ? "dashboard" : "ventas";
  navigateTo(paginaInicial);
  
  // Actualizar badges cada 5 minutos
  updateBadges();
  setInterval(updateBadges, 300000);
});

async function updateBadges() {
  try {
    const pedidos = await API.getPendientes();
    const badge = document.getElementById("badge-pendientes");
    if (badge) {
      if (pedidos.length > 0) {
        badge.textContent = pedidos.length;
        badge.style.display = "inline-block";
      } else {
        badge.style.display = "none";
      }
    }
  } catch(e) {}
}

function logout() {
  localStorage.removeItem("td_token");
  localStorage.removeItem("td_user");
  window.location.href = "login.html";
}

function toggleNavGroup(groupId) {
  const group = document.getElementById(groupId);
  if (!group) return;
  const wasOpen = group.classList.contains("open");
  // Cerrar otros grupos opcionalmente, pero mejor dejamos que el usuario abra varios si quiere
  // document.querySelectorAll('.nav-group').forEach(g => g.classList.remove('open'));
  if (!wasOpen) group.classList.add("open");
  else group.classList.remove("open");
}

// ==== THEME ====
function initTheme() {
  const isLight = localStorage.getItem("td_theme") === "light";
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
    localStorage.setItem("td_theme", "light");
    if (btn) btn.innerHTML = "🌙 Oscuro";
  } else {
    document.documentElement.removeAttribute("data-theme");
    localStorage.setItem("td_theme", "dark");
    if (btn) btn.innerHTML = "💡 Claro";
  }
}


function abrirModal(id) {
  document.getElementById(id).classList.add("open");
}
function cerrarModal(id) {
  document.getElementById(id).classList.remove("open");
}

// ============================================================
let _dashboardPeriodo = "diario";

async function cargarDashboard(periodo) {
  if (periodo) _dashboardPeriodo = periodo;
  
  // Limpiar inputs si es un periodo predefinido
  if (periodo && periodo !== 'personalizado') {
    document.getElementById("dash-inicio").value = "";
    document.getElementById("dash-fin").value = "";
  }

  document.querySelectorAll("#btn-diario, #btn-semanal, #btn-mensual, #btn-anual").forEach(b => {
    if (b) {
      b.classList.remove("btn-primary");
      b.classList.add("btn-secondary");
    }
  });
  const btn = document.getElementById("btn-" + _dashboardPeriodo);
  if (btn) {
    btn.classList.remove("btn-secondary");
    btn.classList.add("btn-primary");
  }
  await loadDashboard();
}

async function loadDashboard() {
  const grid = document.getElementById("stats-grid");
  const catFilter = document.getElementById("dash-filtro-categoria");
  const prodFilter = document.getElementById("dash-filtro-producto");

  if (!_categorias.length || catFilter.options.length <= 1) {
    try {
      if (!_categorias.length) _categorias = await API.getCategorias().catch(()=>[]);
      if (!_productos.length) _productos = await API.getProductos().catch(()=>[]);
      
      const mainCats = _categorias.filter(c => !c.parent_id);
      catFilter.innerHTML = '<option value="">Categoría Padre</option>' + mainCats.map(c => `<option value="${c.id_categoria}">${c.nombre}</option>`).join("");
      prodFilter.innerHTML = '<option value="">Todos los productos</option>' + _productos.map(p => `<option value="${p.id_producto}">${p.nombre}</option>`).join("");
    } catch(e) {}
  }

  const idCatPadre = document.getElementById("dash-filtro-categoria").value;
  const idSubCat = document.getElementById("dash-filtro-subcategoria").value;
  const idCat = idSubCat || idCatPadre;
  const idProd = prodFilter.value;
  const fInicio = document.getElementById("dash-inicio").value;
  const fFin = document.getElementById("dash-fin").value;

  let params = "";
  if (idCat) params += `&id_categoria=${idCat}`;
  if (idProd) params += `&id_producto=${idProd}`;
  if (fInicio) params += `&fInicio=${fInicio}`;
  if (fFin) params += `&fFin=${fFin}`;

  const tablesEl = document.getElementById("dashboard-tables");
  grid.innerHTML = `<div class="loading"><div class="spinner"></div> Cargando...</div>`;
  if (tablesEl) tablesEl.innerHTML = "";
  try {
    const d = await API.getDashboardPeriodo(_dashboardPeriodo, params);

    _productosPorCategoria = d.productosPorCategoria || [];

    grid.innerHTML = `
      <div class="stat-card"><div class="stat-label">VENTAS NETAS</div><div class="stat-value">${d.totalVentas}</div><div class="stat-icon">🛒</div></div>
      <div class="stat-card success"><div class="stat-label">INGRESOS NETOS</div><div class="stat-value">${formatPrice(d.ingresos)}</div><div class="stat-icon">💰</div></div>
      <div class="stat-card"><div class="stat-label">COSTO</div><div class="stat-value">${formatPrice(d.costo)}</div><div class="stat-icon">📉</div></div>
      <div class="stat-card ${d.utilidad >= 0 ? 'success' : 'danger'}"><div class="stat-label">UTILIDAD</div><div class="stat-value">${formatPrice(d.utilidad)}</div><div class="stat-icon">📊</div></div>
      <div class="stat-card"><div class="stat-label">UNIDADES EN STOCK</div><div class="stat-value">${d.stockTotalUnits || 0}</div><div class="stat-icon">📦</div></div>
      <div class="stat-card info" style="position:relative;">
        <button onclick="verReporteProductosCategoria(event)" style="position: absolute; right: 10px; top: 10px; background: none; border: none; font-size: 20px; color: var(--text-muted); cursor: pointer; z-index: 10;" title="Ver reporte por categorías">⋮</button>
        <div class="stat-label">PRODUCTOS DISPONIBLES</div>
        <div class="stat-value">${d.totalProductos || 0}</div>
        <div class="stat-icon">👕</div>
      </div>
    `;

    const tablesEl = document.getElementById("dashboard-tables");
    const ventasData = d.ventas || [];
    if (_dashboardPeriodo === "diario") {
      const rows = ventasData.map(v => `<tr><td>#${v.id_venta}</td><td>${formatDate(v.fecha)}</td><td>${v.cliente||'--'}</td><td class="text-accent">${formatPrice(v.total)}</td></tr>`).join("") || `<tr><td colspan="4" class="text-muted">Sin ventas</td></tr>`;
      tablesEl.innerHTML = `<div class="table-card"><div class="table-header"><div class="table-title">Ventas - ${_dashboardPeriodo}</div></div><table><thead><tr><th>#</th><th>Fecha</th><th>Cliente</th><th>Total</th></tr></thead><tbody>${rows}</tbody></table></div>`;
    } else {
      const rows = ventasData.map(v => `<tr><td>${v.dia}</td><td>${v.ventas}</td><td class="text-accent">${formatPrice(v.ingresos)}</td></tr>`).join("") || `<tr><td colspan="3" class="text-muted">Sin ventas</td></tr>`;
      tablesEl.innerHTML = `<div class="table-card"><div class="table-header"><div class="table-title">Ventas - ${_dashboardPeriodo}</div></div><table><thead><tr><th>Dia</th><th>Ventas</th><th>Ingresos</th></tr></thead><tbody>${rows}</tbody></table></div>`;
    }
  } catch (err) { grid.innerHTML = `<div class="text-danger">Error: ${err.message}</div>`; }
}

function descargarPDF() {
  const token = localStorage.getItem("td_token");
  const catFilter = document.getElementById("dash-filtro-categoria");
  const subCatFilter = document.getElementById("dash-filtro-subcategoria");
  const prodFilter = document.getElementById("dash-filtro-producto");
  
  const idCatPadre = catFilter.value;
  const idSubCat = subCatFilter?.value;
  const idProd = prodFilter.value;
  
  // Si hay subcategoria seleccionada, usamos esa. Si no, la padre.
  const idCat = idSubCat || idCatPadre;
  
  let catNombre = "";
  if (idSubCat && subCatFilter.selectedIndex > 0) {
    catNombre = subCatFilter.selectedOptions[0].text;
  } else if (idCatPadre && catFilter.selectedIndex > 0) {
    catNombre = catFilter.selectedOptions[0].text;
  }
  
  const prodNombre = idProd && prodFilter.selectedIndex > 0 ? prodFilter.selectedOptions[0].text : "";
  const fInicio = document.getElementById("dash-inicio").value;
  const fFin = document.getElementById("dash-fin").value;

  let url = `/api/dashboard/reporte?periodo=${_dashboardPeriodo}&token=${token}`;
  if (idCat) url += `&id_categoria=${idCat}&cat_nombre=${encodeURIComponent(catNombre)}`;
  if (idProd) url += `&id_producto=${idProd}&prod_nombre=${encodeURIComponent(prodNombre)}`;
  if (fInicio) url += `&fInicio=${fInicio}`;
  if (fFin) url += `&fFin=${fFin}`;

  window.open(url, "_blank");
}

function descargarPDFGeneral() {
  const token = localStorage.getItem("td_token");
  const catFilter = document.getElementById("dash-filtro-categoria");
  const subCatFilter = document.getElementById("dash-filtro-subcategoria");
  const prodFilter = document.getElementById("dash-filtro-producto");
  
  const idCatPadre = catFilter.value;
  const idSubCat = subCatFilter?.value;
  const idProd = prodFilter.value;
  
  const idCat = idSubCat || idCatPadre;
  
  let catNombre = "";
  if (idSubCat && subCatFilter.selectedIndex > 0) {
    catNombre = subCatFilter.selectedOptions[0].text;
  } else if (idCatPadre && catFilter.selectedIndex > 0) {
    catNombre = catFilter.selectedOptions[0].text;
  }
  
  const prodNombre = idProd && prodFilter.selectedIndex > 0 ? prodFilter.selectedOptions[0].text : "";
  const fInicio = document.getElementById("dash-inicio").value;
  const fFin = document.getElementById("dash-fin").value;

  let url = `/api/dashboard/reporte-general?periodo=${_dashboardPeriodo}&token=${token}`;
  if (idCat) url += `&id_categoria=${idCat}&cat_nombre=${encodeURIComponent(catNombre)}`;
  if (idProd) url += `&id_producto=${idProd}&prod_nombre=${encodeURIComponent(prodNombre)}`;
  if (fInicio) url += `&fInicio=${fInicio}`;
  if (fFin) url += `&fFin=${fFin}`;

  window.open(url, "_blank");
}

function verReporteProductosCategoria(event) {
  if (event) event.stopPropagation();
  abrirModal("modal-productos-categoria");
  
  const tbody = document.getElementById("tbody-productos-categoria");
  if (!tbody) return;
  
  if (!_productosPorCategoria || !_productosPorCategoria.length) {
    tbody.innerHTML = `<tr><td colspan="2" class="text-muted text-center" style="padding: 20px;">Sin datos de productos por categoría.</td></tr>`;
    return;
  }
  
  tbody.innerHTML = _productosPorCategoria.map(item => `
    <tr>
      <td>${item.categoria}</td>
      <td class="text-center" style="font-weight: 700;">${item.total}</td>
    </tr>
  `).join("");
}

let _dashboardComprasPeriodo = "diario";

async function cargarDashboardCompras(periodo) {
  if (periodo) _dashboardComprasPeriodo = periodo;
  
  // Limpiar inputs si es un periodo predefinido
  if (periodo && periodo !== 'personalizado') {
    document.getElementById("dash-compras-inicio").value = "";
    document.getElementById("dash-compras-fin").value = "";
  }

  document.querySelectorAll("#btn-compras-diario, #btn-compras-semanal, #btn-compras-mensual, #btn-compras-anual").forEach(b => {
    if (b) {
      b.classList.remove("btn-primary");
      b.classList.add("btn-secondary");
    }
  });
  const btn = document.getElementById("btn-compras-" + _dashboardComprasPeriodo);
  if (btn) {
    btn.classList.remove("btn-secondary");
    btn.classList.add("btn-primary");
  }
  await loadDashboardCompras();
}

async function loadDashboardCompras() {
  const grid = document.getElementById("stats-compras-grid");
  const catFilter = document.getElementById("dash-compras-filtro-categoria");
  const subCatFilter = document.getElementById("dash-compras-filtro-subcategoria");
  const prodFilter = document.getElementById("dash-compras-filtro-producto");

  if (!grid) return;

  if (!_categorias.length || catFilter.options.length <= 1) {
    try {
      if (!_categorias.length) _categorias = await API.getCategorias().catch(()=>[]);
      if (!_productos.length) _productos = await API.getProductos().catch(()=>[]);
      
      const mainCats = _categorias.filter(c => !c.parent_id);
      catFilter.innerHTML = '<option value="">Categoría Padre</option>' + mainCats.map(c => `<option value="${c.id_categoria}">${c.nombre}</option>`).join("");
      prodFilter.innerHTML = '<option value="">Todos los productos</option>' + _productos.map(p => `<option value="${p.id_producto}">${p.nombre}</option>`).join("");
    } catch(e) {}
  }

  const idCatPadre = catFilter.value;
  const idSubCat = subCatFilter ? subCatFilter.value : "";
  const idCat = idSubCat || idCatPadre;
  const idProd = prodFilter.value;
  const fInicio = document.getElementById("dash-compras-inicio").value;
  const fFin = document.getElementById("dash-compras-fin").value;

  let params = "";
  if (idCat) params += `&id_categoria=${idCat}`;
  if (idProd) params += `&id_producto=${idProd}`;
  if (fInicio) params += `&fInicio=${fInicio}`;
  if (fFin) params += `&fFin=${fFin}`;

  const tablesEl = document.getElementById("dashboard-compras-tables");
  grid.innerHTML = `<div class="loading"><div class="spinner"></div> Cargando...</div>`;
  if (tablesEl) tablesEl.innerHTML = "";

  try {
    const d = await API.getDashboardCompras(_dashboardComprasPeriodo, params);

    grid.innerHTML = `
      <div class="stat-card info"><div class="stat-label">INVERSIÓN COMPRAS</div><div class="stat-value">${formatPrice(d.totalCompras)}</div><div class="stat-icon">💰</div></div>
      <div class="stat-card"><div class="stat-label">UNIDADES COMPRADAS</div><div class="stat-value">${d.unidadesCompradas || 0}</div><div class="stat-icon">📥</div></div>
      <div class="stat-card danger"><div class="stat-label">TOTAL REEMBOLSADO</div><div class="stat-value">${formatPrice(d.totalReembolsado)}</div><div class="stat-icon">↪️</div></div>
      <div class="stat-card warning"><div class="stat-label">COSTO PÉRDIDAS</div><div class="stat-value">${formatPrice(d.costoPerdido)}</div><div class="stat-icon">⚠️</div></div>
    `;

    const comprasData = d.compras || [];
    const devData = d.devoluciones || [];

    let comprasHTML = "";
    let devHTML = "";

    if (_dashboardComprasPeriodo === "diario") {
      const cRows = comprasData.map(c => `
        <tr>
          <td>${c.referencia || '—'}</td>
          <td>${c.producto_nombre} ${c.talla ? `(${c.talla} | ${c.version})` : ''}</td>
          <td class="text-center">${c.cantidad}</td>
          <td class="text-accent text-right">${formatPrice(c.costo_total)}</td>
        </tr>
      `).join("") || `<tr><td colspan="4" class="text-muted text-center" style="padding:12px;">Sin compras hoy</td></tr>`;
      
      comprasHTML = `
        <div class="table-card">
          <div class="table-header"><div class="table-title">Compras - ${_dashboardComprasPeriodo}</div></div>
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Referencia</th>
                  <th>Producto</th>
                  <th class="text-center">Cant.</th>
                  <th class="text-right">Total</th>
                </tr>
              </thead>
              <tbody>${cRows}</tbody>
            </table>
          </div>
        </div>
      `;

      const dRows = devData.map(v => `
        <tr>
          <td>${v.codigo_devolucion}</td>
          <td>${v.motivo}</td>
          <td class="text-center">${v.volver_a_stock ? 'Sí' : 'No'}</td>
          <td class="text-accent text-right">${formatPrice(v.total_reembolsado)}</td>
        </tr>
      `).join("") || `<tr><td colspan="4" class="text-muted text-center" style="padding:12px;">Sin devoluciones hoy</td></tr>`;

      devHTML = `
        <div class="table-card">
          <div class="table-header"><div class="table-title">Devoluciones - ${_dashboardComprasPeriodo}</div></div>
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Código Dev</th>
                  <th>Motivo</th>
                  <th class="text-center">Restockeado</th>
                  <th class="text-right">Reembolsado</th>
                </tr>
              </thead>
              <tbody>${dRows}</tbody>
            </table>
          </div>
        </div>
      `;
    } else {
      const cRows = comprasData.map(c => `
        <tr>
          <td>${c.dia}</td>
          <td class="text-center">${c.unidades}</td>
          <td class="text-accent text-right">${formatPrice(c.total_compras)}</td>
        </tr>
      `).join("") || `<tr><td colspan="3" class="text-muted text-center" style="padding:12px;">Sin compras</td></tr>`;

      comprasHTML = `
        <div class="table-card">
          <div class="table-header"><div class="table-title">Compras por fecha</div></div>
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Día</th>
                  <th class="text-center">Unidades</th>
                  <th class="text-right">Inversión</th>
                </tr>
              </thead>
              <tbody>${cRows}</tbody>
            </table>
          </div>
        </div>
      `;

      const dRows = devData.map(v => `
        <tr>
          <td>${v.dia}</td>
          <td class="text-center">${v.unidades}</td>
          <td class="text-accent text-right">${formatPrice(v.total_reembolsado)}</td>
        </tr>
      `).join("") || `<tr><td colspan="3" class="text-muted text-center" style="padding:12px;">Sin devoluciones</td></tr>`;

      devHTML = `
        <div class="table-card">
          <div class="table-header"><div class="table-title">Devoluciones por fecha</div></div>
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Día</th>
                  <th class="text-center">Unidades</th>
                  <th class="text-right">Reembolsado</th>
                </tr>
              </thead>
              <tbody>${dRows}</tbody>
            </table>
          </div>
        </div>
      `;
    }

    if (tablesEl) {
      tablesEl.innerHTML = comprasHTML + devHTML;
    }
  } catch (err) { 
    if (grid) grid.innerHTML = `<div class="text-danger">Error: ${err.message}</div>`; 
  }
}

function onCambioCategoriaDashboardCompras() {
  const padSel = document.getElementById("dash-compras-filtro-categoria");
  const subSel = document.getElementById("dash-compras-filtro-subcategoria");
  const prodSel = document.getElementById("dash-compras-filtro-producto");
  if (!padSel) return;
  const pid = padSel.value;
  
  if (!pid) {
    if (subSel) {
      subSel.style.display = "none";
      subSel.value = "";
    }
    if (prodSel) {
      prodSel.innerHTML = '<option value="">Todos los productos</option>' + _productos.map(p => `<option value="${p.id_producto}">${p.nombre}</option>`).join("");
    }
  } else {
    const subs = _categorias.filter(c => c.parent_id == pid);
    if (subSel) {
      if (subs.length > 0) {
        subSel.style.display = "block";
        subSel.innerHTML = '<option value="">Todas las subcategorías</option>' + subs.map(c => `<option value="${c.id_categoria}">${c.nombre}</option>`).join("");
      } else {
        subSel.style.display = "none";
      }
      subSel.value = "";
    }
    
    if (prodSel) {
      const validCats = [Number(pid), ...subs.map(c => Number(c.id_categoria))];
      const filteredP = _productos.filter(p => validCats.includes(Number(p.id_categoria)));
      prodSel.innerHTML = '<option value="">Todos los productos</option>' + filteredP.map(p => `<option value="${p.id_producto}">${p.nombre}</option>`).join("");
    }
  }
  cargarDashboardCompras();
}

function onCambioSubcategoriaDashboardCompras() {
  const padSel = document.getElementById("dash-compras-filtro-categoria");
  const subSel = document.getElementById("dash-compras-filtro-subcategoria");
  const prodSel = document.getElementById("dash-compras-filtro-producto");
  if (!padSel) return;
  
  let validCats = [];
  if (subSel && subSel.value) {
     validCats = [Number(subSel.value)];
  } else if (padSel.value) {
     const subs = _categorias.filter(c => c.parent_id == padSel.value);
     validCats = [Number(padSel.value), ...subs.map(c => Number(c.id_categoria))];
  }
  
  if (prodSel) {
    if (validCats.length > 0) {
      const filteredP = _productos.filter(p => validCats.includes(Number(p.id_categoria)));
      prodSel.innerHTML = '<option value="">Todos los productos</option>' + filteredP.map(p => `<option value="${p.id_producto}">${p.nombre}</option>`).join("");
    } else {
      prodSel.innerHTML = '<option value="">Todos los productos</option>' + _productos.map(p => `<option value="${p.id_producto}">${p.nombre}</option>`).join("");
    }
  }
  loadDashboardCompras();
}

function descargarPDFCompras() {
  const token = localStorage.getItem("td_token");
  const catFilter = document.getElementById("dash-compras-filtro-categoria");
  const subCatFilter = document.getElementById("dash-compras-filtro-subcategoria");
  const prodFilter = document.getElementById("dash-compras-filtro-producto");
  
  const idCatPadre = catFilter ? catFilter.value : "";
  const idSubCat = subCatFilter ? subCatFilter.value : "";
  const idProd = prodFilter ? prodFilter.value : "";
  
  const idCat = idSubCat || idCatPadre;
  
  let catNombre = "";
  if (idSubCat && subCatFilter.selectedIndex > 0) {
    catNombre = subCatFilter.selectedOptions[0].text;
  } else if (idCatPadre && catFilter.selectedIndex > 0) {
    catNombre = catFilter.selectedOptions[0].text;
  }
  
  const prodNombre = idProd && prodFilter.selectedIndex > 0 ? prodFilter.selectedOptions[0].text : "";
  const fInicio = document.getElementById("dash-compras-inicio").value;
  const fFin = document.getElementById("dash-compras-fin").value;

  let url = `/api/dashboard/reporte-compras?periodo=${_dashboardComprasPeriodo}&token=${token}`;
  if (idCat) url += `&id_categoria=${idCat}&cat_nombre=${encodeURIComponent(catNombre)}`;
  if (idProd) url += `&id_producto=${idProd}&prod_nombre=${encodeURIComponent(prodNombre)}`;
  if (fInicio) url += `&fInicio=${fInicio}`;
  if (fFin) url += `&fFin=${fFin}`;

  window.open(url, "_blank");
}

function onCambioCategoriaDashboard() {
  const padSel = document.getElementById("dash-filtro-categoria");
  const subSel = document.getElementById("dash-filtro-subcategoria");
  const prodSel = document.getElementById("dash-filtro-producto");
  const pid = padSel.value;
  
  if (!pid) {
    subSel.style.display = "none";
    subSel.value = "";
    prodSel.innerHTML = '<option value="">Todos los productos</option>' + _productos.map(p => `<option value="${p.id_producto}">${p.nombre}</option>`).join("");
  } else {
    const subs = _categorias.filter(c => c.parent_id == pid);
    if (subs.length > 0) {
      subSel.style.display = "block";
      subSel.innerHTML = '<option value="">Todas las subcategorías</option>' + subs.map(c => `<option value="${c.id_categoria}">${c.nombre}</option>`).join("");
    } else {
      subSel.style.display = "none";
    }
    subSel.value = "";
    
    const validCats = [Number(pid), ...subs.map(c => Number(c.id_categoria))];
    const filteredP = _productos.filter(p => validCats.includes(Number(p.id_categoria)));
    prodSel.innerHTML = '<option value="">Todos los productos</option>' + filteredP.map(p => `<option value="${p.id_producto}">${p.nombre}</option>`).join("");
  }
  cargarDashboard();
}

function onCambioSubcategoriaDashboard() {
  const padSel = document.getElementById("dash-filtro-categoria");
  const subSel = document.getElementById("dash-filtro-subcategoria");
  const prodSel = document.getElementById("dash-filtro-producto");
  
  let validCats = [];
  if (subSel.value) {
     validCats = [Number(subSel.value)];
  } else if (padSel.value) {
     const subs = _categorias.filter(c => c.parent_id == padSel.value);
     validCats = [Number(padSel.value), ...subs.map(c => Number(c.id_categoria))];
  }
  
  if (validCats.length > 0) {
    const filteredP = _productos.filter(p => validCats.includes(Number(p.id_categoria)));
    prodSel.innerHTML = '<option value="">Todos los productos</option>' + filteredP.map(p => `<option value="${p.id_producto}">${p.nombre}</option>`).join("");
  } else {
    prodSel.innerHTML = '<option value="">Todos los productos</option>' + _productos.map(p => `<option value="${p.id_producto}">${p.nombre}</option>`).join("");
  }
  loadDashboard();
}

// Dashboard unificado: Ventas, Compras a proveedor y Devoluciones en una sola ventana.
let _dashboardFiltrosListos = false;

function setDashboardFechas(periodo) {
  const inicio = document.getElementById("dash-inicio");
  const fin = document.getElementById("dash-fin");
  if (!inicio || !fin) return;

  const hoy = new Date();
  const desde = new Date(hoy);
  if (periodo === "semanal") desde.setDate(hoy.getDate() - 6);
  else if (periodo === "mensual") desde.setDate(1);
  else if (periodo === "anual") {
    desde.setMonth(0);
    desde.setDate(1);
  }

  inicio.value = desde.toISOString().slice(0, 10);
  fin.value = hoy.toISOString().slice(0, 10);
}

async function prepararDashboardUnificado() {
  if (_dashboardFiltrosListos) return;
  if (!_categorias.length) _categorias = await API.getCategorias().catch(() => []);
  if (!_productos.length) _productos = await API.getProductos().catch(() => []);

  const catSel = document.getElementById("dash-filtro-categoria");
  const subSel = document.getElementById("dash-filtro-subcategoria");
  const prodSel = document.getElementById("dash-filtro-producto");
  if (!catSel || !subSel || !prodSel) return;

  catSel.innerHTML = `<option value="">Todas las categorías</option>` +
    _categorias.filter(c => !c.parent_id).map(c => `<option value="${c.id_categoria}">${c.nombre}</option>`).join("");
  subSel.innerHTML = `<option value="">Todas las subcategorías</option>`;
  prodSel.innerHTML = `<option value="">Todos los productos</option>` +
    _productos.map(p => `<option value="${p.id_producto}">${p.nombre}</option>`).join("");

  setDashboardFechas(_dashboardPeriodo);
  _dashboardFiltrosListos = true;
}

async function cargarDashboard(periodo) {
  if (periodo) _dashboardPeriodo = periodo;
  if (periodo && periodo !== "personalizado") setDashboardFechas(periodo);

  document.querySelectorAll("#btn-diario, #btn-semanal, #btn-mensual, #btn-anual").forEach(b => {
    b.classList.remove("btn-primary");
    b.classList.add("btn-secondary");
  });
  const activo = document.getElementById("btn-" + _dashboardPeriodo);
  if (activo) {
    activo.classList.add("btn-primary");
    activo.classList.remove("btn-secondary");
  }

  await loadDashboard();
}

function getDashboardParams() {
  const catPadre = document.getElementById("dash-filtro-categoria")?.value || "";
  const subcat = document.getElementById("dash-filtro-subcategoria")?.value || "";
  const producto = document.getElementById("dash-filtro-producto")?.value || "";
  const inicio = document.getElementById("dash-inicio")?.value || "";
  const fin = document.getElementById("dash-fin")?.value || "";
  let params = "";
  if (subcat || catPadre) params += `&id_categoria=${subcat || catPadre}`;
  if (producto) params += `&id_producto=${producto}`;
  if (inicio) params += `&fInicio=${inicio}`;
  if (fin) params += `&fFin=${fin}`;
  return params;
}

async function loadDashboard() {
  await prepararDashboardUnificado();
  const ventasStats = document.getElementById("stats-grid");
  const comprasStats = document.getElementById("stats-compras-grid");
  const devolucionesStats = document.getElementById("stats-devoluciones-grid");
  if (!ventasStats || !comprasStats || !devolucionesStats) return;

  ventasStats.innerHTML = `<div class="loading"><div class="spinner"></div> Cargando ventas...</div>`;
  comprasStats.innerHTML = `<div class="loading"><div class="spinner"></div> Cargando compras...</div>`;
  devolucionesStats.innerHTML = `<div class="loading"><div class="spinner"></div> Cargando devoluciones...</div>`;
  document.getElementById("dashboard-tables").innerHTML = "";
  document.getElementById("dashboard-compras-tables").innerHTML = "";
  document.getElementById("dashboard-devoluciones-tables").innerHTML = "";

  try {
    const params = getDashboardParams();
    const [ventas, comprasDev] = await Promise.all([
      API.getDashboardPeriodo(_dashboardPeriodo, params),
      API.getDashboardCompras(_dashboardPeriodo, params),
    ]);

    _productosPorCategoria = ventas.productosPorCategoria || [];
    renderDashboardVentas(ventas);
    renderDashboardComprasProveedor(comprasDev);
    renderDashboardDevoluciones(comprasDev);
  } catch (err) {
    ventasStats.innerHTML = `<div class="text-danger">Error: ${err.message}</div>`;
    comprasStats.innerHTML = `<div class="text-danger">Error: ${err.message}</div>`;
    devolucionesStats.innerHTML = `<div class="text-danger">Error: ${err.message}</div>`;
  }
}

function renderDashboardVentas(d) {
  document.getElementById("stats-grid").innerHTML = `
    <div class="stat-card"><div class="stat-label">Ventas netas</div><div class="stat-value">${d.totalVentas}</div><div class="stat-icon">🛒</div></div>
    <div class="stat-card success"><div class="stat-label">Ingresos netos</div><div class="stat-value">${formatPrice(d.ingresos)}</div><div class="stat-icon">💰</div></div>
    <div class="stat-card"><div class="stat-label">Costo</div><div class="stat-value">${formatPrice(d.costo)}</div><div class="stat-icon">📉</div></div>
    <div class="stat-card ${d.utilidad >= 0 ? 'success' : 'danger'}"><div class="stat-label">Utilidad</div><div class="stat-value">${formatPrice(d.utilidad)}</div><div class="stat-icon">📊</div></div>
    <div class="stat-card"><div class="stat-label">Unidades stock</div><div class="stat-value">${d.stockTotalUnits || 0}</div><div class="stat-icon">📦</div></div>
    <div class="stat-card info" style="position:relative;">
      <button onclick="verReporteProductosCategoria(event)" style="position:absolute;right:10px;top:10px;background:none;border:none;font-size:20px;color:var(--text-muted);cursor:pointer;z-index:10" title="Ver reporte por categorías">⋮</button>
      <div class="stat-label">Productos disponibles</div><div class="stat-value">${d.totalProductos || 0}</div><div class="stat-icon">👕</div>
    </div>
  `;

  const rows = (d.ventas || []).map(v => v.fecha
    ? `<tr><td>#${v.id_venta}</td><td>${formatDate(v.fecha)}</td><td>${v.cliente || "--"}</td><td class="text-accent">${formatPrice(v.total)}</td></tr>`
    : `<tr><td>${v.dia}</td><td>${v.ventas}</td><td></td><td class="text-accent">${formatPrice(v.ingresos)}</td></tr>`
  ).join("") || `<tr><td colspan="4" class="text-muted" style="text-align:center;padding:16px">Sin ventas</td></tr>`;

  document.getElementById("dashboard-tables").innerHTML =
    `<div class="table-card"><div class="table-header"><div class="table-title">Ventas</div></div><div class="table-wrap"><table><thead><tr><th># / Día</th><th>Fecha / Ventas</th><th>Cliente</th><th>Total</th></tr></thead><tbody>${rows}</tbody></table></div></div>`;
}

function renderDashboardComprasProveedor(d) {
  const registros = (d.compras || []).length;
  const promedio = Number(d.unidadesCompradas || 0) > 0 ? Number(d.totalCompras || 0) / Number(d.unidadesCompradas) : 0;
  document.getElementById("stats-compras-grid").innerHTML = `
    <div class="stat-card info"><div class="stat-label">Inversión compras</div><div class="stat-value">${formatPrice(d.totalCompras)}</div><div class="stat-icon">📥</div></div>
    <div class="stat-card success"><div class="stat-label">Unidades compradas</div><div class="stat-value">${d.unidadesCompradas || 0}</div><div class="stat-icon">📦</div></div>
    <div class="stat-card"><div class="stat-label">Registros</div><div class="stat-value">${registros}</div><div class="stat-icon">🧾</div></div>
    <div class="stat-card"><div class="stat-label">Costo promedio</div><div class="stat-value">${formatPrice(promedio)}</div><div class="stat-icon">📊</div></div>
  `;

  const rows = (d.compras || []).map(c => c.fecha
    ? `<tr><td>${formatDate(c.fecha)}</td><td>${c.producto_nombre} ${c.talla ? `(${c.talla} | ${c.version})` : ""}</td><td>${c.cantidad}</td><td>${formatPrice(c.costo_unitario || 0)}</td><td class="text-accent">${formatPrice(c.costo_total || 0)}</td></tr>`
    : `<tr><td>${c.dia}</td><td>${c.unidades} unidades</td><td></td><td></td><td class="text-accent">${formatPrice(c.total_compras || 0)}</td></tr>`
  ).join("") || `<tr><td colspan="5" class="text-muted" style="text-align:center;padding:16px">Sin compras</td></tr>`;

  document.getElementById("dashboard-compras-tables").innerHTML =
    `<div class="table-card"><div class="table-header"><div class="table-title">Compras a proveedor</div></div><div class="table-wrap"><table><thead><tr><th>Fecha</th><th>Producto</th><th>Unid.</th><th>Costo unit.</th><th>Total</th></tr></thead><tbody>${rows}</tbody></table></div></div>`;
}

function renderDashboardDevoluciones(d) {
  const registros = (d.devoluciones || []).length;
  document.getElementById("stats-devoluciones-grid").innerHTML = `
    <div class="stat-card danger"><div class="stat-label">Reembolsado</div><div class="stat-value">${formatPrice(d.totalReembolsado)}</div><div class="stat-icon">↪️</div></div>
    <div class="stat-card"><div class="stat-label">Unidades devueltas</div><div class="stat-value">${d.unidadesDevueltas || 0}</div><div class="stat-icon">📦</div></div>
    <div class="stat-card warning"><div class="stat-label">Costo pérdidas</div><div class="stat-value">${formatPrice(d.costoPerdido)}</div><div class="stat-icon">⚠️</div></div>
    <div class="stat-card"><div class="stat-label">Registros</div><div class="stat-value">${registros}</div><div class="stat-icon">📋</div></div>
  `;

  const rows = (d.devoluciones || []).map(v => v.fecha
    ? `<tr><td>${v.codigo_devolucion || `#${v.id_devolucion}`}</td><td>${formatDate(v.fecha)}</td><td>${v.motivo || ""}</td><td>${v.volver_a_stock ? "Sí" : "No"}</td><td>${v.total_cantidad || v.unidades || 0}</td><td class="text-accent">${formatPrice(v.total_reembolsado || 0)}</td></tr>`
    : `<tr><td>${v.dia}</td><td></td><td></td><td></td><td>${v.unidades || 0}</td><td class="text-accent">${formatPrice(v.total_reembolsado || 0)}</td></tr>`
  ).join("") || `<tr><td colspan="6" class="text-muted" style="text-align:center;padding:16px">Sin devoluciones</td></tr>`;

  document.getElementById("dashboard-devoluciones-tables").innerHTML =
    `<div class="table-card"><div class="table-header"><div class="table-title">Devoluciones</div></div><div class="table-wrap"><table><thead><tr><th>Código / Día</th><th>Fecha</th><th>Motivo</th><th>Restock</th><th>Unid.</th><th>Reembolso</th></tr></thead><tbody>${rows}</tbody></table></div></div>`;
}

function onCambioCategoriaDashboard() {
  const catSel = document.getElementById("dash-filtro-categoria");
  const subSel = document.getElementById("dash-filtro-subcategoria");
  const prodSel = document.getElementById("dash-filtro-producto");
  const padre = catSel.value;
  const hijas = padre ? _categorias.filter(c => c.parent_id == padre) : [];

  subSel.innerHTML = `<option value="">Todas las subcategorías</option>` +
    hijas.map(c => `<option value="${c.id_categoria}">${c.nombre}</option>`).join("");

  const ids = padre ? [Number(padre), ...hijas.map(c => Number(c.id_categoria))] : [];
  const productos = ids.length ? _productos.filter(p => ids.includes(Number(p.id_categoria))) : _productos;
  prodSel.innerHTML = `<option value="">Todos los productos</option>` +
    productos.map(p => `<option value="${p.id_producto}">${p.nombre}</option>`).join("");

  cargarDashboard();
}

function onCambioSubcategoriaDashboard() {
  const subcat = document.getElementById("dash-filtro-subcategoria").value;
  const cat = document.getElementById("dash-filtro-categoria").value;
  const prodSel = document.getElementById("dash-filtro-producto");
  const hijas = cat ? _categorias.filter(c => c.parent_id == cat) : [];
  const ids = subcat ? [Number(subcat)] : (cat ? [Number(cat), ...hijas.map(c => Number(c.id_categoria))] : []);
  const productos = ids.length ? _productos.filter(p => ids.includes(Number(p.id_categoria))) : _productos;
  prodSel.innerHTML = `<option value="">Todos los productos</option>` +
    productos.map(p => `<option value="${p.id_producto}">${p.nombre}</option>`).join("");
  cargarDashboard();
}

function descargarPDF(modulo = "ventas") {
  const token = localStorage.getItem("td_token");
  const catSel = document.getElementById("dash-filtro-categoria");
  const subSel = document.getElementById("dash-filtro-subcategoria");
  const prodSel = document.getElementById("dash-filtro-producto");
  const idCat = subSel.value || catSel.value;
  const idProd = prodSel.value;
  const catNombre = idCat
    ? (subSel.value ? subSel.selectedOptions[0].text : catSel.selectedOptions[0].text)
    : "";
  const prodNombre = idProd ? prodSel.selectedOptions[0].text : "";
  const fInicio = document.getElementById("dash-inicio").value;
  const fFin = document.getElementById("dash-fin").value;

  let url = modulo === "ventas"
    ? `/api/dashboard/reporte?periodo=${_dashboardPeriodo}&token=${token}`
    : `/api/dashboard/reporte-compras?periodo=${_dashboardPeriodo}&token=${token}`;
  if (idCat) url += `&id_categoria=${idCat}&cat_nombre=${encodeURIComponent(catNombre)}`;
  if (idProd) url += `&id_producto=${idProd}&prod_nombre=${encodeURIComponent(prodNombre)}`;
  if (fInicio) url += `&fInicio=${fInicio}`;
  if (fFin) url += `&fFin=${fFin}`;
  window.open(url, "_blank");
}

function descargarPDFCompras() {
  descargarPDF("compras");
}

// ============================================================
// INVENTARIO
// ============================================================
async function loadInventario() {
  try {
    const [prods, cats, costos] = await Promise.all([API.getProductos(), API.getCategorias(), API.getCostos().catch(()=>[])]);
    _productos = prods.map(p => {
      const c = costos.find(x => x.id_producto == p.id_producto);
      return { ...p, costo_promedio: c?.costo_promedio || p.precio_compra || 0, costo_total: c?.costo_total || 0 };
    });
    _categorias = cats;
    renderTablaProductos(_productos);
    const sel = document.getElementById("prod-categoria");
    sel.innerHTML = `<option value="">Sin categoría</option>` + _categorias.filter(c => !c.parent_id).map(c => `<option value="${c.id_categoria}">${c.nombre}</option>`).join("");
    sel.onchange = actualizarSubcategoria;
  } catch (err) { showToast("Error cargando inventario: " + err.message, "error"); }
}

function actualizarSubcategoria() {
  const parentId = document.getElementById("prod-categoria").value;
  const subcatSel = document.getElementById("prod-subcategoria");
  const grupo = document.getElementById("grupo-subcategoria");
  const grupoTallas = document.getElementById("grupo-tallas");
  if (!parentId) {
    grupo.style.display = "none";
    if (grupoTallas) grupoTallas.style.display = "none";
    return;
  }
  const hijos = _categorias.filter(c => c.parent_id == parentId);
  if (!hijos.length) {
    grupo.style.display = "none";
    if (grupoTallas) grupoTallas.style.display = "none";
    return;
  }
  subcatSel.innerHTML = `<option value="">Selecciona...</option>` + hijos.map(c => `<option value="${c.id_categoria}">${c.nombre}</option>`).join("");
  grupo.style.display = "block";
  // Ocultar grid si no hay subcategoria seleccionada
  if (!subcatSel.value && grupoTallas) grupoTallas.style.display = "none";
  // Si pertenece a Camisetas, mostrar tallas.
  subcatSel.onchange = function() {
    const esCamiseta = categoriaEsCamiseta(this.value);
    const stockInput = document.getElementById("prod-stock");
    if (stockInput) stockInput.disabled = esCamiseta;
    if (esCamiseta && grupoTallas) {
      renderizarGridTallas([]);
      grupoTallas.style.display = "block";
    } else {
      if (grupoTallas) grupoTallas.style.display = "none";
    }
  };
  // Ejecutar onchange si hay valor
  if (subcatSel.value) subcatSel.onchange();
}

function renderizarGridTallas(inventario) {
  const tallas = ["S","M","L","XL","XXL"];
  const versiones = ["Fan","Player"];
  const tbody = document.getElementById("grid-tallas");
  const foot = document.getElementById("foot-tallas");
  if (!tbody || !foot) return;
  let total = 0;
  let html = "";
  tallas.forEach(t => {
    html += `<tr><td style="padding:4px 8px;font-weight:bold">${t}</td>`;
    versiones.forEach(v => {
      const inv = inventario.find(i => i.talla === t && i.version === v);
      const val = inv ? inv.stock : 0;
      total += Number(val);
      html += `<td style="padding:2px"><input type="number" class="form-control" id="inv-${t}-${v}" value="${val}" min="0" style="width:70px;text-align:center;padding:4px" onchange="actualizarStockTotal()"></td>`;
    });
    html += `</tr>`;
  });
  tbody.innerHTML = html;
  foot.innerHTML = `<tr style="background:var(--bg-secondary)"><td style="padding:6px 8px;font-weight:bold">Total</td><td colspan="2" style="padding:6px 8px;text-align:center;font-weight:bold;font-size:14px" id="total-stock-tallas">${total}</td></tr>`;
}

function actualizarStockTotal() {
  const tallas = ["S","M","L","XL","XXL"];
  const versiones = ["Fan","Player"];
  let total = 0;
  tallas.forEach(t => versiones.forEach(v => total += Number(document.getElementById(`inv-${t}-${v}`).value || 0)));
  document.getElementById("total-stock-tallas").textContent = total;
  document.getElementById("prod-stock").value = total;
}

function categoriaEsODescendiente(idCategoria, idPadre) {
  if (!idCategoria || !idPadre || !_categorias?.length) return false;
  let cat = _categorias.find(c => c.id_categoria == idCategoria);
  while (cat) {
    if (cat.id_categoria == idPadre) return true;
    cat = _categorias.find(c => c.id_categoria == cat.parent_id);
  }
  return false;
}

function categoriaEsCamiseta(idCategoria) {
  if (!idCategoria || !_categorias?.length) return false;
  let cat = _categorias.find(c => c.id_categoria == idCategoria);
  while (cat) {
    const nombre = (cat.nombre || "").toLowerCase();
    const slug = (cat.slug || "").toLowerCase();
    if (slug === "camisetas" || nombre.includes("camiseta")) return true;
    cat = _categorias.find(c => c.id_categoria == cat.parent_id);
  }
  return false;
}

function renderTablaProductos(lista) {
  const tbody = document.getElementById("tabla-productos");
  if (!lista.length) {
    tbody.innerHTML = `<tr><td colspan="9" class="text-muted" style="text-align:center;padding:24px">No hay productos registrados.</td></tr>`;
    return;
  }
  tbody.innerHTML = lista.map(p => `
    <tr>
      <td class="text-muted">#${p.id_producto}</td>
      <td class="fw-bold">${p.nombre}</td>
      <td>${p.categoria_nombre || '<span class="text-muted">—</span>'}</td>
      <td class="text-accent">${formatPrice(p.precio)}</td>
      <td>${p.stock}</td>
      <td class="text-muted">${formatPrice(p.costo_promedio)}</td>
      <td class="text-muted">${formatPrice(p.costo_total)}</td>
      <td><span class="badge ${p.stock < 5 ? 'badge-low' : 'badge-ok'}">${p.stock < 5 ? 'Bajo' : 'OK'}</span></td>
      <td>
        <button class="btn btn-secondary btn-sm btn-icon" title="Editar" onclick="editarProducto(${p.id_producto})">✏️</button>
        <button class="btn btn-danger btn-sm btn-icon" title="Eliminar" onclick="eliminarProducto(${p.id_producto}, '${p.nombre.replace(/'/g, "\\'")}')">🗑️</button>
      </td>
    </tr>
  `).join("");
}

function filtrarProductos() {
  const q = document.getElementById("search-producto").value.toLowerCase();
  const filtrados = _productos.filter(p =>
    p.nombre.toLowerCase().includes(q) ||
    (p.categoria_nombre || "").toLowerCase().includes(q)
  );
  renderTablaProductos(filtrados);
}

function abrirModalProducto() {
  document.getElementById("modal-producto-titulo").textContent = "Nuevo Producto";
  document.getElementById("prod-id").value = "";
  document.getElementById("prod-nombre").value = "";
  document.getElementById("prod-precio").value = "";
  document.getElementById("prod-margen").value = "";
  document.getElementById("prod-stock").value = "0";
  document.getElementById("prod-descripcion").value = "";
  document.getElementById("prod-categoria").value = "";
  document.getElementById("prod-subcategoria").innerHTML = `<option value="">Selecciona...</option>`;
  document.getElementById("grupo-subcategoria").style.display = "none";
  document.getElementById("prod-imagen").value = "";
  document.getElementById("prod-img-preview").style.display = "none";
  abrirModal("modal-producto");
}

async function editarProducto(id) {
  const p = _productos.find(x => String(x.id_producto) === String(id));
  if (!p) {
    showToast("Producto no encontrado. Recarga la lista e intenta de nuevo.", "error");
    return;
  }
  document.getElementById("modal-producto-titulo").textContent = "Editar Producto";
  document.getElementById("prod-id").value = p.id_producto;
  document.getElementById("prod-nombre").value = p.nombre;
  document.getElementById("prod-precio").value = p.precio;
  document.getElementById("prod-margen").value = p.margen_porcentaje || "";
  document.getElementById("prod-stock").value = p.stock;
  document.getElementById("prod-descripcion").value = p.descripcion || "";
  document.getElementById("prod-imagen").value = "";
  const preview = document.getElementById("prod-img-preview");
  if (p.imagen) {
    preview.src = p.imagen;
    preview.style.display = "block";
  } else {
    preview.style.display = "none";
  }

  const cat = _categorias.find(c => c.id_categoria == p.id_categoria);
  if (cat && cat.parent_id) {
    document.getElementById("prod-categoria").value = cat.parent_id;
    actualizarSubcategoria();
    document.getElementById("prod-subcategoria").value = p.id_categoria;
  } else {
    document.getElementById("prod-categoria").value = p.id_categoria || "";
    actualizarSubcategoria();
    document.getElementById("prod-subcategoria").value = "";
  }
  abrirModal("modal-producto");
}

async function guardarProducto() {
  const id = document.getElementById("prod-id").value;
  const subcat = document.getElementById("prod-subcategoria").value;
  const cat = document.getElementById("prod-categoria").value;
  const precioVal = parseFloat(document.getElementById("prod-precio").value);
  const margenVal = parseFloat(document.getElementById("prod-margen").value);

  const body = {
    nombre:            document.getElementById("prod-nombre").value.trim(),
    descripcion:       document.getElementById("prod-descripcion").value.trim(),
    id_categoria:      subcat || cat || null,
    margen_porcentaje: isNaN(margenVal) ? null : margenVal,
  };

  // Solo incluir precio si fue ingresado manualmente y es valido
  if (!isNaN(precioVal) && precioVal > 0) body.precio = precioVal;

  if (!body.nombre) {
    showToast("El nombre es requerido.", "error"); return;
  }

  try {
    let productoId = id;
    if (id) {
      await API.updateProducto(id, body);
      showToast("Producto actualizado.", "success");
    } else {
      const creado = await API.createProducto(body);
      productoId = creado.id_producto;
      showToast("Producto creado. El stock se gestiona desde Compras.", "success");
    }
    const imagen = document.getElementById("prod-imagen").files[0];
    if (imagen && productoId) await API.uploadImagen(productoId, imagen);
    cerrarModal("modal-producto");
    loadInventario();
  } catch (err) { showToast(err.message, "error"); }
}

async function eliminarProducto(id, nombre) {
  if (!confirm(`¿Eliminar "${nombre}"? Esta acción no se puede deshacer.`)) return;
  try {
    await API.deleteProducto(id);
    showToast("Producto eliminado.", "info");
    loadInventario();
  } catch (err) {
    showToast(err.message, "error");
  }
}

// ============================================================
// PUNTO DE VENTA
// ============================================================
async function loadVentas() {
  try {
    [_productos, _clientes] = await Promise.all([API.getProductos(), API.getClientes()]);
    renderTablaProductosVenta(_productos);

    // Llenar select de clientes
    const sel = document.getElementById("venta-cliente");
    sel.innerHTML = `<option value="">Sin cliente registrado</option>` +
      _clientes.map(c => `<option value="${c.id_cliente}">${c.nombre} ${c.apellido}</option>`).join("");
  } catch (err) {
    showToast("Error cargando productos: " + err.message, "error");
  }
}

function renderTablaProductosVenta(lista) {
  const tbody = document.getElementById("tabla-productos-venta");
  if (!lista.length) {
    tbody.innerHTML = `<tr><td colspan="4" class="text-muted" style="text-align:center;padding:20px">Sin productos</td></tr>`;
    return;
  }
  tbody.innerHTML = lista.map(p => `
    <tr>
      <td>
        <div class="fw-bold">${p.nombre}</div>
        <div class="text-muted" style="font-size:12px">${p.categoria_nombre || ''}</div>
      </td>
      <td class="text-accent">${formatPrice(p.precio)}</td>
      <td>${p.stock}</td>
      <td>
        <button class="btn btn-primary btn-sm" ${p.stock < 1 ? 'disabled' : ''}
                onclick="agregarAlCarrito(${p.id_producto})">
          + Agregar
        </button>
      </td>
    </tr>
  `).join("");
}

function filtrarProductosVenta() {
  const q = document.getElementById("search-venta-producto").value.toLowerCase();
  renderTablaProductosVenta(_productos.filter(p => p.nombre.toLowerCase().includes(q)));
}

// ============================================================
// AGREGAR STOCK (dual: simple / por tallas)
// ============================================================
let _stockProductId = null;

function esCamiseta(idCategoria) {
  return categoriaEsCamiseta(idCategoria);
}

function toggleCostMode(modo) {
  const isTotal = modo === "total";
  const unitGroup = document.getElementById("stock-group-precio-unitario");
  const totalGroup = document.getElementById("stock-group-precio-total");
  const batchContainer = document.getElementById("cost-total-batch-container");
  
  // Para modo simple
  if (unitGroup) unitGroup.style.display = isTotal ? "none" : "block";
  if (totalGroup) totalGroup.style.display = isTotal ? "block" : "none";
  
  // Para modo tallas
  if (batchContainer) batchContainer.style.display = isTotal ? "block" : "none";
  
  // Deshabilitar inputs de precio y subtotal en el grid si es modo total
  document.querySelectorAll("[id^='stock-p-'], [id^='stock-s-']").forEach(input => {
    input.disabled = isTotal;
    if (isTotal) input.value = "";
  });
  updateStockSummary();
}

function updateStockRow(t, v, field) {
  const qEl = document.getElementById(`stock-t-${t}-${v}`);
  const pEl = document.getElementById(`stock-p-${t}-${v}`);
  const sEl = document.getElementById(`stock-s-${t}-${v}`);
  
  const q = parseInt(qEl.value) || 0;
  const p = parseFloat(pEl.value) || 0;
  const s = parseFloat(sEl.value) || 0;

  if (field === 'q' || field === 'p') {
    if (q > 0 && p > 0) sEl.value = (q * p).toFixed(0);
    else sEl.value = "";
  } else if (field === 's') {
    if (q > 0 && s > 0) pEl.value = (s / q).toFixed(0);
    else pEl.value = "";
  }
  updateStockSummary();
}

function updateStockSummary() {
  const costMode = document.querySelector("input[name='cost-mode']:checked")?.value || "unit";
  const summaryEl = document.getElementById("stock-summary-total");
  let totalUnits = 0;
  let totalCost = 0;

  ["S","M","L","XL","XXL"].forEach(t => {
    ["Fan","Player"].forEach(v => {
      const q = parseInt(document.getElementById(`stock-t-${t}-${v}`)?.value) || 0;
      const s = parseFloat(document.getElementById(`stock-s-${t}-${v}`)?.value) || 0;
      totalUnits += q;
      if (costMode === "unit") totalCost += s;
    });
  });

  // Si es modo simple (balones)
  const qSimple = parseInt(document.getElementById("stock-cantidad")?.value) || 0;
  if (qSimple > 0 && document.getElementById("stock-modo-simple").style.display !== "none") {
      totalUnits = qSimple;
      if (costMode === "unit") {
          totalCost = qSimple * (parseFloat(document.getElementById("stock-precio-compra").value) || 0);
      } else {
          totalCost = parseFloat(document.getElementById("stock-precio-total-simple").value) || 0;
      }
  }

  if (costMode === "total") {
      totalCost = parseFloat(document.getElementById("stock-costo-total-global").value) || 0;
  }

  if (summaryEl) {
    summaryEl.innerHTML = `Resumen: ${totalUnits} unidades | Costo Total: ${formatPrice(totalCost)}`;
  }
}

function abrirModalStock(id) {
  _stockProductId = id;
  document.getElementById("stock-product-id").value = id;

  // Buscar producto en cualquier cache disponible
  const p = (_productos || window._comprasData || []).find(x => x.id_producto == id);
  const esCam = p && esCamiseta(p.id_categoria);

  const modoSimple = document.getElementById("stock-modo-simple");
  const modoTallas = document.getElementById("stock-modo-tallas");
  const simpleInfo = document.getElementById("stock-modo-simple-info");

  if (esCam) {
    modoSimple.style.display = "none";
    modoTallas.style.display = "block";
    simpleInfo.style.display = "none";
    document.getElementById("modal-stock-titulo").textContent = "Comprar " + (p?.nombre || "") + " por talla";
    
    // Headers del grid
    document.getElementById("modal-stock").querySelector("thead").innerHTML = `
      <tr>
        <th rowspan="2">Talla</th>
        <th colspan="3" style="text-align:center;border-bottom:1px solid var(--border-color)">Fan</th>
        <th colspan="3" style="text-align:center;border-bottom:1px solid var(--border-color)">Player</th>
      </tr>
      <tr>
        <th style="font-size:10px">Cant</th><th style="font-size:10px">$/u</th><th style="font-size:10px">Total</th>
        <th style="font-size:10px">Cant</th><th style="font-size:10px">$/u</th><th style="font-size:10px">Total</th>
      </tr>
    `;

    const tallas = ["S","M","L","XL","XXL"];
    const versiones = ["Fan","Player"];
    let html = "";
    tallas.forEach(t => {
      html += `<tr><td style="padding:4px 6px;font-weight:bold">${t}</td>`;
      versiones.forEach(v => {
        html += `<td style="padding:2px"><input type="number" class="form-control" id="stock-t-${t}-${v}" value="0" min="0" style="width:45px;text-align:center;padding:3px;font-size:12px" oninput="updateStockRow('${t}','${v}','q')"></td>`;
        html += `<td style="padding:2px"><input type="number" class="form-control" id="stock-p-${t}-${v}" value="0" min="0" style="width:65px;text-align:center;padding:3px;font-size:12px" oninput="updateStockRow('${t}','${v}','p')"></td>`;
        html += `<td style="padding:2px"><input type="number" class="form-control" id="stock-s-${t}-${v}" value="0" min="0" style="width:75px;text-align:center;padding:3px;font-size:12px" oninput="updateStockRow('${t}','${v}','s')"></td>`;
      });
      html += `</tr>`;
    });
    document.getElementById("stock-grid-body").innerHTML = html;
    document.getElementById("stock-referencia").value = "";
  } else {
    modoSimple.style.display = "block";
    modoTallas.style.display = "none";
    simpleInfo.style.display = "block";
    document.getElementById("modal-stock-titulo").textContent = "Agregar Stock" + (p ? " - " + p.nombre : "");
    document.getElementById("stock-cantidad").value = "";
    document.getElementById("stock-precio-compra").value = "";
    document.getElementById("stock-precio-total-simple").value = "";
    document.getElementById("stock-referencia-simple").value = "";
    
    // Listeners para modo simple
    document.getElementById("stock-cantidad").oninput = updateStockSummary;
    document.getElementById("stock-precio-compra").oninput = updateStockSummary;
    document.getElementById("stock-precio-total-simple").oninput = updateStockSummary;
  }
  
  // Resetear modo de costo
  document.querySelector("input[name='cost-mode'][value='unit']").checked = true;
  document.getElementById("stock-costo-total-global").value = "";
  document.getElementById("stock-costo-total-global").oninput = updateStockSummary;
  toggleCostMode("unit");

  abrirModal("modal-stock");
}

async function guardarStock() {
  const modoTallas = document.getElementById("stock-modo-tallas");
  const isGrid = modoTallas.style.display !== "none";

  const costMode = document.querySelector("input[name='cost-mode']:checked").value; // 'unit' o 'total'

  try {
    if (isGrid) {
      const items = [];
      let totalQty = 0;
      
      ["S","M","L","XL","XXL"].forEach(t => {
        ["Fan","Player"].forEach(v => {
          const c = parseInt(document.getElementById("stock-t-"+t+"-"+v).value) || 0;
          const p = costMode === "unit" ? (parseFloat(document.getElementById("stock-p-"+t+"-"+v).value) || 0) : 0;
          if (c > 0) {
            items.push({ talla: t, version: v, cantidad: c, precio_compra: p });
            totalQty += c;
          }
        });
      });

      if (!items.length) { showToast("Ingresa al menos una cantidad.", "error"); return; }

      if (costMode === "total") {
        const totalCost = parseFloat(document.getElementById("stock-costo-total-global").value) || 0;
        if (totalCost <= 0) { showToast("Ingresa el costo total del paquete.", "error"); return; }
        const unitPrice = totalCost / totalQty;
        items.forEach(i => i.precio_compra = unitPrice);
      } else {
        if (items.some(i => i.precio_compra <= 0)) { showToast("Ingresa el precio de compra para cada talla.", "error"); return; }
      }

      await API.agregarStock(_stockProductId, { items, referencia: document.getElementById("stock-referencia").value || "compra" });
      showToast("Stock por tallas agregado.", "success");
    } else {
      const c = parseInt(document.getElementById("stock-cantidad").value);
      let p = 0;
      
      if (costMode === "unit") {
        p = parseFloat(document.getElementById("stock-precio-compra").value);
      } else {
        const total = parseFloat(document.getElementById("stock-precio-total-simple").value);
        if (total > 0 && c > 0) p = total / c;
      }

      if (!c || c <= 0) { showToast("Ingresa una cantidad válida.", "error"); return; }
      await API.agregarStock(_stockProductId, { cantidad: c, referencia: document.getElementById("stock-referencia-simple").value || "compra" });
      showToast("+"+c+" unidades agregadas.", "success");
    }
    cerrarModal("modal-stock");
    // Recargar la pagina activa
    const active = document.querySelector(".nav-item.active");
    if (active) navigateTo(active.dataset.page);
  } catch (err) { showToast(err.message, "error"); }
}

function agregarAlCarrito(id) {
  const prod = _productos.find(p => p.id_producto === id);
  if (!prod) return;
  const item = _carrito.find(i => i.id_producto === id);
  if (item) {
    if (item.cantidad >= prod.stock) {
      showToast("No hay más stock disponible.", "error"); return;
    }
    item.cantidad++;
  } else {
    _carrito.push({ ...prod, cantidad: 1 });
  }
  renderCarrito();
}

function cambiarCantidad(id, delta) {
  const idx = _carrito.findIndex(i => i.id_producto === id);
  if (idx === -1) return;
  _carrito[idx].cantidad += delta;
  if (_carrito[idx].cantidad <= 0) _carrito.splice(idx, 1);
  renderCarrito();
}

function limpiarCarrito() {
  _carrito = [];
  renderCarrito();
}

function renderCarrito() {
  const el = document.getElementById("carrito-items");
  if (!_carrito.length) {
    el.innerHTML = `<div class="text-muted" style="text-align:center;padding:20px;font-size:13px">Carrito vacío</div>`;
    document.getElementById("cart-total").textContent = "$0";
    return;
  }
  let subtotal = 0;
  el.innerHTML = _carrito.map(item => {
    const sub = item.precio * item.cantidad;
    subtotal += sub;
    return `
      <div class="cart-item">
        <div class="cart-item-name">${item.nombre}</div>
        <div class="cart-item-qty">
          <button class="qty-btn" onclick="cambiarCantidad(${item.id_producto}, -1)">-</button>
          <span>${item.cantidad}</span>
          <button class="qty-btn" onclick="cambiarCantidad(${item.id_producto}, 1)">+</button>
        </div>
        <div class="cart-item-total">${formatPrice(sub)}</div>
      </div>
    `;
  }).join("");

  const descTipo = document.getElementById("venta-descuento-tipo")?.value || "monto";
  const descVal = parseFloat(document.getElementById("venta-descuento")?.value) || 0;
  let total = subtotal;
  if (descTipo === "porcentaje" && descVal > 0) total = subtotal - (subtotal * descVal / 100);
  else total = subtotal - descVal;
  if (total < 0) total = 0;

  document.getElementById("cart-total").textContent = formatPrice(total);
}

async function procesarVenta() {
  if (!_carrito.length) {
    showToast("Agrega productos al carrito.", "error"); return;
  }
  const btn = document.getElementById("btn-vender");
  btn.textContent = "Procesando...";
  btn.disabled = true;

  try {
    const id_cliente = document.getElementById("venta-cliente").value || null;
    const items = _carrito.map(i => ({ id_producto: i.id_producto, cantidad: i.cantidad }));
    const descVal = parseFloat(document.getElementById("venta-descuento")?.value) || 0;
    const descTipo = document.getElementById("venta-descuento-tipo")?.value || "monto";

    const res = await API.createVenta({ id_cliente, items, descuento: descVal, descuento_tipo: descTipo });
    showToast(`✅ Venta #${res.id_venta} registrada. Total: ${formatPrice(res.total)}`, "success");
    limpiarCarrito();
    loadVentas(); // recargar stock
  } catch (err) {
    showToast(err.message, "error");
  } finally {
    btn.textContent = "Cobrar";
    btn.disabled = false;
  }
}

// ============================================================
// CLIENTES
// ============================================================
async function loadClientes() {
  try {
    _clientes = await API.getClientes();
    renderTablaClientes(_clientes);
  } catch (err) {
    showToast("Error cargando clientes: " + err.message, "error");
  }
}

function renderTablaClientes(lista) {
  const tbody = document.getElementById("tabla-clientes");
  if (!lista.length) {
    tbody.innerHTML = `<tr><td colspan="5" class="text-muted" style="text-align:center;padding:24px">No hay clientes registrados.</td></tr>`;
    return;
  }
  tbody.innerHTML = lista.map(c => `
    <tr>
      <td class="text-muted">#${c.id_cliente}</td>
      <td class="fw-bold">${c.nombre || ''} ${c.apellido || ''}</td>
      <td>${c.telefono || '<span class="text-muted">—</span>'}</td>
      <td>${c.email || '<span class="text-muted">—</span>'}</td>
      <td>
        <button class="btn btn-secondary btn-sm btn-icon" onclick="editarCliente(${c.id_cliente})">✏️</button>
        <button class="btn btn-danger btn-sm btn-icon" onclick="eliminarCliente(${c.id_cliente}, '${(c.nombre||'').replace(/'/g,"\\'")}')">🗑️</button>
      </td>
    </tr>
  `).join("");
}

function abrirModalCliente() {
  document.getElementById("modal-cliente-titulo").textContent = "Nuevo Cliente";
  document.getElementById("cli-id").value = "";
  ["cli-nombre","cli-apellido","cli-telefono","cli-email"].forEach(id => {
    document.getElementById(id).value = "";
  });
  abrirModal("modal-cliente");
}

function editarCliente(id) {
  const c = _clientes.find(x => x.id_cliente === id);
  if (!c) return;
  document.getElementById("modal-cliente-titulo").textContent = "Editar Cliente";
  document.getElementById("cli-id").value = c.id_cliente;
  document.getElementById("cli-nombre").value = c.nombre || "";
  document.getElementById("cli-apellido").value = c.apellido || "";
  document.getElementById("cli-telefono").value = c.telefono || "";
  document.getElementById("cli-email").value = c.email || "";
  abrirModal("modal-cliente");
}

async function guardarCliente() {
  const id = document.getElementById("cli-id").value;
  const body = {
    nombre:   document.getElementById("cli-nombre").value.trim(),
    apellido: document.getElementById("cli-apellido").value.trim(),
    telefono: document.getElementById("cli-telefono").value.trim(),
    email:    document.getElementById("cli-email").value.trim(),
  };
  try {
    if (id) {
      await API.updateCliente(id, body);
      showToast("Cliente actualizado.", "success");
    } else {
      await API.createCliente(body);
      showToast("Cliente creado.", "success");
    }
    cerrarModal("modal-cliente");
    loadClientes();
  } catch (err) {
    showToast(err.message, "error");
  }
}

async function eliminarCliente(id, nombre) {
  if (!confirm(`¿Desactivar cliente "${nombre}"? El historial se conserva.`)) return;
  try {
    const res = await API.deleteCliente(id);
    showToast(res.message || "Cliente desactivado.", "info");
    loadClientes();
  } catch (err) {
    showToast(err.message, "error");
  }
}

// ============================================================
// HISTORIAL DE VENTAS
// ============================================================
async function loadHistorial() {
  try {
    const [ventas, pedidos, devoluciones, compras] = await Promise.all([
      API.getVentas().catch(()=>[]),
      API.getPedidosTodos().catch(()=>[]),
      API.getDevoluciones().catch(()=>[]),
      API.getComprasMovimientos().catch(()=>[]),
    ]);
    const todos = [
      ...ventas.map(v => ({ ...v, tipo: "POS" })),
      ...pedidos
        .filter(p => p.estado !== "cancelado")
        .map(p => ({ ...p, tipo: "Web", id: p.id_pedido, fecha: p.creado_en, cliente: p.cliente || "Cliente web" })),
      ...devoluciones
        .filter(d => d.estado === 'APROBADA')
        .map(d => ({ ...d, tipo: "Devolución", id: d.id_devolucion, fecha: d.fecha, total: -d.total_reembolsado, cliente: d.cliente_nombre || "Anónimo", motivo: d.motivo, volver_a_stock: d.volver_a_stock })),
      ...compras.map(c => ({
        id: c.referencia,
        tipo: "Compra",
        fecha: c.fecha,
        cliente: "Proveedor",
        total: c.total,
        codigo_ticket: c.referencia
      })),
    ];
    todos.sort((a,b) => new Date(b.fecha) - new Date(a.fecha));

    const tbody = document.getElementById("tabla-historial");
    if (!todos.length) {
      tbody.innerHTML = `<tr><td colspan="6" class="text-muted" style="text-align:center;padding:24px">Sin ventas registradas.</td></tr>`;
      return;
    }
    tbody.innerHTML = todos.map(v => {
      const diffMs = new Date() - new Date(v.fecha);
      const puedeEliminar = diffMs < (24 * 60 * 60 * 1000) && v.tipo !== 'Compra';
      const clickHandler = v.tipo === 'Devolución' 
        ? `eliminarDevolucion(${v.id})` 
        : (v.tipo === 'Web' ? `eliminarPedido(${v.id})` : `eliminarVenta(${v.id_venta})`);

      const btnEliminar = puedeEliminar 
        ? `<button class="btn btn-danger btn-sm btn-icon" onclick="${clickHandler}" title="Eliminar (24h)">✕</button>` 
        : "";

      let badgeClass = "badge-danger";
      if (v.tipo === 'POS') badgeClass = "badge-ok";
      else if (v.tipo === 'Web') badgeClass = "badge-low";
      else if (v.tipo === 'Compra') badgeClass = "badge-compra";

      return `
      <tr>
        <td class="text-muted fw-bold">${v.codigo_ticket || (v.tipo === 'Devolución' ? 'DEV-' + v.id : 'WEB-' + v.id)}</td>
        <td><span class="badge ${badgeClass}">${v.tipo}${v.estado && v.tipo !== 'Devolución' ? ` - ${v.estado}` : ""}</span></td>
        <td>${formatDate(v.fecha)}</td>
        <td>${v.cliente_nombre || v.cliente || '<span class="text-muted">—</span>'}</td>
        <td class="fw-bold ${v.tipo==='Devolución' ? 'text-danger' : 'text-accent'}">${formatPrice(v.total)}</td>
        <td style="display:flex;gap:4px">
          ${v.tipo === 'Devolución' 
            ? `<button class="btn btn-secondary btn-sm" onclick="verMotivoDevolucion('${(v.cliente||'').replace(/'/g,"\\'")}', '${(v.motivo||'').replace(/'/g,"\\'")}', ${v.volver_a_stock})">Ver Motivo</button>`
            : (v.tipo === 'Compra' 
                ? `<button class="btn btn-secondary btn-sm" onclick="verDetalleCompra('${v.id}')">Ver detalle</button>`
                : `<button class="btn btn-secondary btn-sm" onclick="${v.tipo==='POS' ? `verDetalleVenta(${v.id_venta})` : `verDetallePedido(${v.id})`}">Ver detalle</button>`
              )
          }
          ${btnEliminar}
        </td>
      </tr>
      `;
    }).join("");
  } catch (err) { showToast("Error: " + err.message, "error"); }
}

async function verDetalleVenta(id) {
  const body = document.getElementById("modal-venta-body");
  body.innerHTML = `<div class="loading"><div class="spinner"></div> Cargando...</div>`;
  abrirModal("modal-venta-detalle");

  try {
    const v = await API.getVenta(id);
    const detalleHTML = v.detalle.map(d => `
      <tr>
        <td>${d.producto_nombre}</td>
        <td>${d.cantidad}</td>
        <td>${formatPrice(d.precio_unitario)}</td>
        <td class="text-accent">${formatPrice(d.subtotal)}</td>
      </tr>
    `).join("");

    body.innerHTML = `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px">
        <div>
          <div class="form-label">Venta #</div>
          <div class="fw-bold">${v.id_venta}</div>
        </div>
        <div>
          <div class="form-label">Fecha</div>
          <div>${formatDate(v.fecha)}</div>
        </div>
        <div>
          <div class="form-label">Cliente</div>
          <div>${v.cliente_nombre || 'Sin cliente'}</div>
        </div>
        <div>
          <div class="form-label">Total</div>
          <div class="text-accent fw-bold" style="font-size:20px">${formatPrice(v.total)}</div>
        </div>
      </div>
      <table>
        <thead><tr><th>Producto</th><th>Cant.</th><th>Precio Unit.</th><th>Subtotal</th></tr></thead>
        <tbody>${detalleHTML}</tbody>
      </table>
    `;
  } catch (err) {
    body.innerHTML = `<div class="text-danger">Error: ${err.message}</div>`;
  }
}

async function verDetalleCompra(ref) {
  const body = document.getElementById("modal-compra-body");
  body.innerHTML = `<div class="loading"><div class="spinner"></div> Cargando...</div>`;
  abrirModal("modal-compra-detalle");

  try {
    const detalle = await API.getCompraDetalle(ref);
    if (!detalle || !detalle.length) {
      body.innerHTML = `<div class="text-muted" style="text-align:center;padding:20px">No hay detalles para esta compra.</div>`;
      return;
    }
    const fecha = detalle[0].fecha;
    let totalCompra = 0;
    const detalleHTML = detalle.map(d => {
      totalCompra += Number(d.costo_total || 0);
      const tallaVersion = [d.talla, d.version].filter(Boolean).join(" ") || '<span class="text-muted">—</span>';
      return `
        <tr>
          <td>${d.producto_nombre}</td>
          <td>${tallaVersion}</td>
          <td>${d.cantidad}</td>
          <td>${formatPrice(d.costo_unitario)}</td>
          <td class="text-accent">${formatPrice(d.costo_total)}</td>
        </tr>
      `;
    }).join("");

    body.innerHTML = `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px">
        <div>
          <div class="form-label">Referencia</div>
          <div class="fw-bold">${ref}</div>
        </div>
        <div>
          <div class="form-label">Fecha</div>
          <div>${formatDate(fecha)}</div>
        </div>
        <div>
          <div class="form-label">Proveedor</div>
          <div>Proveedor Externo</div>
        </div>
        <div>
          <div class="form-label">Costo Total</div>
          <div class="text-accent fw-bold" style="font-size:20px">${formatPrice(totalCompra)}</div>
        </div>
      </div>
      <table>
        <thead><tr><th>Producto</th><th>Talla/Versión</th><th>Cant.</th><th>Costo Unit.</th><th>Subtotal</th></tr></thead>
        <tbody>${detalleHTML}</tbody>
      </table>
    `;
  } catch (err) {
    body.innerHTML = `<div class="text-danger">Error: ${err.message}</div>`;
  }
}

// ============================================================
// USUARIOS (CRUD - solo admin)
// ============================================================
async function loadUsuarios() {
  try {
    _usuarios = await API.getUsuarios().catch(() => []);
    renderTablaUsuarios(_usuarios);
  } catch (err) {
    showToast("Error cargando usuarios: " + err.message, "error");
  }
}

function renderTablaUsuarios(lista) {
  const tbody = document.getElementById("tabla-usuarios");
  if (!lista.length) {
    tbody.innerHTML = `<tr><td colspan="7" class="text-muted" style="text-align:center;padding:24px">No hay usuarios registrados.</td></tr>`;
    return;
  }
  tbody.innerHTML = lista.map(u => `
    <tr>
      <td class="text-muted">${u.cedula || "—"}</td>
      <td class="fw-bold">${u.nombre} ${u.apellido}</td>
      <td>${u.email}</td>
      <td>${u.telefono || '<span class="text-muted">—</span>'}</td>
      <td><span class="badge ${u.rol==='admin' ? 'badge-low' : u.rol==='empleado' ? 'badge-ok' : ''}">${u.rol}</span></td>
      <td><span style="color:${u.activo ? 'var(--success)' : 'var(--danger)'}">${u.activo ? "Activo" : "Inactivo"}</span></td>
      <td>
        <button class="btn btn-secondary btn-sm btn-icon" onclick="editarUsuario(${u.id_usuario})" title="Editar">✏️</button>
      </td>
    </tr>
  `).join("");
}

function filtrarUsuarios() {
  const q = document.getElementById("search-usuario").value.toLowerCase();
  const filtrados = _usuarios.filter(u =>
    (u.cedula || "").toLowerCase().includes(q) ||
    (u.nombre || "").toLowerCase().includes(q) ||
    (u.apellido || "").toLowerCase().includes(q) ||
    (u.email || "").toLowerCase().includes(q)
  );
  renderTablaUsuarios(filtrados);
}

function abrirModalUsuario(modo) {
  document.getElementById("usr-modo").value = modo;
  const titulo = modo === "cliente" ? "Registrar Cliente" : "Nuevo Empleado / Admin";
  document.getElementById("modal-usuario-titulo").textContent = titulo;
  document.getElementById("usr-id").value = "";
  document.getElementById("usr-cedula").value = "";
  document.getElementById("usr-nombre").value = "";
  document.getElementById("usr-apellido").value = "";
  document.getElementById("usr-email").value = "";
  document.getElementById("usr-telefono").value = "";
  document.getElementById("usr-direccion").value = "";
  document.getElementById("usr-username").value = "";
  document.getElementById("usr-info-password").style.display = "block";
  document.getElementById("btn-eliminar-usuario").style.display = "none";
  document.getElementById("btn-reset-password").style.display = "none";

  if (modo === "empleado") {
    document.getElementById("usr-fields-empleado").style.display = "block";
    document.getElementById("usr-fields-cliente").style.display = "none";
    document.getElementById("usr-rol").innerHTML = '<option value="empleado">Empleado</option>';
    document.getElementById("usr-rol").value = "empleado";
  } else {
    document.getElementById("usr-fields-empleado").style.display = "none";
    document.getElementById("usr-fields-cliente").style.display = "block";
  }
  abrirModal("modal-usuario");
}

async function editarUsuario(id) {
  try {
    const item = _usuarios.find(x => x.id_usuario === id);
    if (!item) { showToast("Usuario no encontrado.", "error"); return; }

    const esCliente = item._origen === "clientes";
    const u = esCliente ? await API.getCliente(id) : await API.getUsuario(id);

    const modo = u.rol === "cliente" ? "cliente" : "empleado";
    document.getElementById("usr-modo").value = modo;
    document.getElementById("modal-usuario-titulo").textContent = "Editar Usuario";
    document.getElementById("usr-id").value = u.id_usuario || u.id_cliente;
    document.getElementById("usr-cedula").value = u.cedula || "";
    document.getElementById("usr-nombre").value = u.nombre || "";
    document.getElementById("usr-apellido").value = u.apellido || "";
    document.getElementById("usr-email").value = u.email || "";
    document.getElementById("usr-telefono").value = u.telefono || "";
    document.getElementById("usr-direccion").value = u.direccion || "";
    document.getElementById("usr-username").value = u.username || "";
    document.getElementById("usr-info-password").style.display = "none";
    document.getElementById("btn-eliminar-usuario").style.display = "inline-flex";
    document.getElementById("btn-reset-password").style.display = "inline-flex";

    if (esCliente || u.rol === "cliente") {
      document.getElementById("usr-fields-empleado").style.display = "none";
      document.getElementById("usr-fields-cliente").style.display = "block";
    } else {
      document.getElementById("usr-fields-empleado").style.display = "block";
      document.getElementById("usr-fields-cliente").style.display = "none";
      if (u.rol === "admin") {
        document.getElementById("usr-rol").innerHTML = '<option value="admin">Administrador</option>';
      }
      document.getElementById("usr-rol").value = u.rol;
    }
    abrirModal("modal-usuario");
  } catch (err) {
    showToast("Error cargando usuario.", "error");
  }
}

async function guardarUsuario() {
  const id = document.getElementById("usr-id").value;
  const modo = document.getElementById("usr-modo").value;
  const cedula = document.getElementById("usr-cedula").value.trim();
  const nombre = document.getElementById("usr-nombre").value.trim();
  const apellido = document.getElementById("usr-apellido").value.trim();
  const email = document.getElementById("usr-email").value.trim();
  const telefono = document.getElementById("usr-telefono").value.trim();
  const direccion = document.getElementById("usr-direccion").value.trim();
  const rol = modo === "cliente" ? "cliente" : document.getElementById("usr-rol").value;
  const username = modo === "empleado" ? document.getElementById("usr-username").value.trim() : "";

  if (!cedula || !nombre || !apellido || !email) {
    showToast("Cedula, nombre, apellido y correo son obligatorios.", "error");
    return;
  }
  if (modo === "empleado" && !username) {
    showToast("Username es obligatorio para empleados/admins.", "error");
    return;
  }

  const body = { cedula, nombre, apellido, email, telefono, direccion };
  if (modo === "empleado") { body.rol = rol; body.username = username; }

  try {
    if (id) {
      if (modo === "cliente") {
        await API.updateCliente(id, body);
      } else {
        await API.updateUsuario(id, body);
      }
      showToast("Actualizado.", "success");
    } else {
      if (modo === "cliente") {
        await API.createCliente(body);
      } else {
        await API.createUsuario(body);
      }
      showToast("Creado. Contrasena: la cedula.", "success");
    }
    cerrarModal("modal-usuario");
    loadUsuarios();
  } catch (err) {
    showToast(err.message, "error");
  }
}

async function eliminarUsuario() {
  const id = document.getElementById("usr-id").value;
  const modo = document.getElementById("usr-modo").value;
  const nombre = document.getElementById("usr-nombre").value;
  if (!confirm(`¿Eliminar "${nombre}"?`)) return;
  try {
    let res;
    if (modo === "cliente") {
      res = await API.deleteCliente(id);
    } else {
      res = await API.deleteUsuario(id);
    }
    showToast(res.message || "Eliminado.", "info");
    cerrarModal("modal-usuario");
    loadUsuarios();
  } catch (err) {
    showToast(err.message, "error");
  }
}

async function resetPasswordUsuario() {
  const id = document.getElementById("usr-id").value;
  const modo = document.getElementById("usr-modo").value;
  const cedula = document.getElementById("usr-cedula").value;
  if (!confirm(`¿Restablecer contraseña a la cédula "${cedula}"?`)) return;
  try {
    if (modo === "cliente") {
      await API.resetClientePass(id);
    } else {
      await API.resetPassword(id);
    }
    showToast("Contraseña restablecida.", "success");
  } catch (err) {
    showToast(err.message, "error");
  }
}

// ============================================================
// VENTAS PENDIENTES (aprobacion de pedidos web)
// ============================================================
async function loadPendientes() {
  const tbody = document.getElementById("tabla-pendientes");
  tbody.innerHTML = `<tr><td colspan="6"><div class="loading"><div class="spinner"></div></div></td></tr>`;
  try {
    const pedidos = await API.getPendientes();
    if (!pedidos.length) {
      tbody.innerHTML = `<tr><td colspan="6" class="text-muted" style="text-align:center;padding:24px">No hay pedidos pendientes.</td></tr>`;
      return;
    }
    tbody.innerHTML = pedidos.map(p => `
      <tr>
        <td class="text-muted">#${p.id_pedido}</td>
        <td class="fw-bold">${p.cliente_nombre || ''} ${p.cliente_apellido || ''}</td>
        <td style="font-size:12px">${p.cliente_telefono || ''}<br>${p.cliente_email || ''}</td>
        <td class="text-accent fw-bold">${formatPrice(p.total)}</td>
        <td style="font-size:12px">${formatDate(p.creado_en)}</td>
        <td>
          <button class="btn btn-primary btn-sm" onclick="aprobarPedido(${p.id_pedido})">✅ Aprobar</button>
          <button class="btn btn-danger btn-sm" onclick="rechazarPedido(${p.id_pedido})">❌ Rechazar</button>
          <button class="btn btn-secondary btn-sm" onclick="verDetallePedido(${p.id_pedido})">Ver</button>
        </td>
      </tr>
    `).join("");
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:24px;color:var(--danger)">Error: ${err.message}</td></tr>`;
  }
}

async function aprobarPedido(id) {
  if (!confirm(`¿Aprobar pedido #${id}? Se descontar del inventario.`)) return;
  try {
    await API.aprobarPedido(id);
    showToast(`Pedido #${id} aprobado. Stock descontado.`, "success");
    loadPendientes();
  } catch (err) {
    showToast(err.message, "error");
  }
}

async function rechazarPedido(id) {
  if (!confirm(`¿Rechazar pedido #${id}?`)) return;
  try {
    await API.rechazarPedido(id);
    showToast(`Pedido #${id} rechazado.`, "info");
    loadPendientes();
  } catch (err) {
    showToast(err.message, "error");
  }
}

async function verDetallePedido(id) {
  try {
    const detalle = await API.getDetallePedido(id);
    let html = `<div class="table-title" style="margin-bottom:12px">Productos del pedido #${id}</div>`;
    html += `<table><thead><tr><th>Producto</th><th>Talla</th><th>Versión</th><th>Cant.</th><th>Precio</th><th>Subtotal</th></tr></thead><tbody>`;
    html += detalle.map(d => `
      <tr>
        <td>${d.producto_nombre}</td>
        <td>${d.talla}</td>
        <td>${d.version}</td>
        <td>${d.cantidad}</td>
        <td>${formatPrice(d.precio_unitario)}</td>
        <td class="text-accent">${formatPrice(d.subtotal)}</td>
      </tr>
    `).join("");
    html += `</tbody></table>`;
    showToastHTML(html);
  } catch (err) {
    showToast("Error cargando detalle.", "error");
  }
}

// Toast con HTML (para detalle de pedidos)
function showToastHTML(html) {
  const container = document.getElementById("toast-container");
  if (!container) return;
  const t = document.createElement("div");
  t.className = "toast info";
  t.innerHTML = html;
  t.style.maxWidth = "600px";
  t.style.cursor = "pointer";
  container.appendChild(t);
  t.onclick = () => t.remove();
}

// ============================================================
// CATEGORÍAS
// ============================================================
async function loadCategorias() {
  const tbody = document.getElementById("tabla-categorias-panel");
  tbody.innerHTML = `<tr><td colspan="5"><div class="loading"><div class="spinner"></div></div></td></tr>`;
  try {
    const cats = _categorias = await API.getCategorias();
    tbody.innerHTML = cats.map(c => {
      const padre = c.parent_id ? cats.find(x => x.id_categoria == c.parent_id) : null;
      return `<tr><td class="text-muted">#${c.id_categoria}</td><td class="fw-bold">${c.nombre}</td><td>${c.slug||''}</td><td>${padre ? padre.nombre : '<span class="text-muted">—</span>'}</td><td><button class="btn btn-secondary btn-sm" onclick="editarCategoriaPanel(${c.id_categoria})">✏️</button></td></tr>`;
    }).join("") || `<tr><td colspan="5" class="text-muted" style="text-align:center;padding:24px">Sin categorías.</td></tr>`;
  } catch (err) { showToast("Error: "+err.message, "error"); }
}

/** Genera slug a partir del nombre de la categoría */
function autoSlugCategoria(nombre) {
  const slug = nombre
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "") // quitar tildes
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-");
  document.getElementById("cat-panel-slug").value = slug;
}

function abrirModalCategoria() {
  document.getElementById("cat-panel-titulo").textContent = "Nueva Categoría";
  document.getElementById("cat-panel-id").value = "";
  document.getElementById("cat-panel-nombre").value = "";
  document.getElementById("cat-panel-slug").value = "";
  document.getElementById("cat-panel-margen").value = "";
  document.getElementById("cat-panel-desc").value = "";
  const sel = document.getElementById("cat-panel-padre");
  sel.innerHTML = `<option value="">📁 Categoría Padre (raíz)</option>` +
    _categorias.filter(c => !c.parent_id)
      .sort((a, b) => a.nombre.localeCompare(b.nombre))
      .map(c => `<option value="${c.id_categoria}">📂 ${c.nombre}</option>`).join("");
  sel.value = "";
  abrirModal("modal-categoria-panel");
}

async function editarCategoriaPanel(id) {
  const c = _categorias.find(x => x.id_categoria == id);
  if (!c) return;
  document.getElementById("cat-panel-titulo").textContent = `Editar: ${c.nombre}`;
  document.getElementById("cat-panel-id").value = c.id_categoria;
  document.getElementById("cat-panel-nombre").value = c.nombre;
  document.getElementById("cat-panel-slug").value = c.slug || "";
  document.getElementById("cat-panel-margen").value = c.margen_porcentaje || "";
  document.getElementById("cat-panel-desc").value = c.descripcion || "";
  const sel = document.getElementById("cat-panel-padre");
  sel.innerHTML = `<option value="">📁 Categoría Padre (raíz)</option>` +
    _categorias.filter(x => !x.parent_id && x.id_categoria != id)
      .sort((a, b) => a.nombre.localeCompare(b.nombre))
      .map(x => `<option value="${x.id_categoria}">📂 ${x.nombre}</option>`).join("");
  sel.value = c.parent_id || "";
  abrirModal("modal-categoria-panel");
}

async function guardarCategoriaPanel() {
  const id = document.getElementById("cat-panel-id").value;
  const nombre = document.getElementById("cat-panel-nombre").value.trim();
  // Auto-generar slug si está vacío
  let slug = document.getElementById("cat-panel-slug").value.trim();
  if (!slug && nombre) {
    slug = nombre.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9\s-]/g, "").trim().replace(/\s+/g, "-");
    document.getElementById("cat-panel-slug").value = slug;
  }
  const body = {
    nombre,
    slug,
    descripcion: document.getElementById("cat-panel-desc").value.trim(),
    parent_id: document.getElementById("cat-panel-padre").value || null,
    margen_porcentaje: parseFloat(document.getElementById("cat-panel-margen").value) || null,
  };
  if (!body.nombre) { showToast("El nombre es requerido.", "error"); return; }
  if (!body.slug)   { showToast("No se pudo generar el slug. Ingrésalo manualmente.", "error"); return; }
  try {
    id ? await API.updateCategoria(id, body) : await API.createCategoria(body);
    showToast(id ? "Actualizada." : "Creada.", "success");
    cerrarModal("modal-categoria-panel");
    loadCategorias();
  } catch (err) { showToast(err.message, "error"); }
}

// ============================================================
// COMPRAS
// ============================================================
async function loadCompras() {
  try {
    const [prods, cats, costos] = await Promise.all([API.getProductos(), API.getCategorias(), API.getCostos().catch(()=>[])]);
    _categorias = cats;
    const sel = document.getElementById("filtro-categoria-compra");
    sel.innerHTML = `<option value="">Todas las categorías</option>` + cats.filter(c => !c.parent_id).map(c => `<option value="${c.id_categoria}">${c.nombre}</option>`).join("");
    window._comprasData = prods.map(p => {
      const c = costos.find(x => x.id_producto == p.id_producto);
      return { ...p, costo_promedio: c?.costo_promedio || p.precio_compra || 0, costo_total: c?.costo_total || 0 };
    });
    _productos = window._comprasData;
    renderCompras(window._comprasData);
  } catch (err) { showToast("Error: "+err.message, "error"); }
}

function renderCompras(lista) {
  const tbody = document.getElementById("tabla-compras");
  tbody.innerHTML = lista.map(p => `<tr><td class="fw-bold">${p.nombre}</td><td>${p.categoria_nombre||''}</td><td>${p.stock}</td><td>${formatPrice(p.costo_promedio)}</td><td>${formatPrice(p.costo_total)}</td><td><button class="btn btn-primary btn-sm" onclick="abrirModalStock(${p.id_producto})">+ Comprar</button></td></tr>`).join("") || `<tr><td colspan="6" class="text-muted" style="text-align:center;padding:24px">Sin productos.</td></tr>`;
}

function filtrarCompras() {
  const q = (document.getElementById("search-compra").value || "").toLowerCase();
  const cat = document.getElementById("filtro-categoria-compra").value;
  const filtrados = window._comprasData.filter(p =>
    p.nombre.toLowerCase().includes(q) &&
    (!cat || categoriaEsODescendiente(p.id_categoria, cat))
  );
  renderCompras(filtrados);
}

// ============================================================
// CERRAR MODALES CON CLICK AFUERA
// ============================================================
document.querySelectorAll(".modal-overlay").forEach(overlay => {
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) overlay.classList.remove("open");
  });
});

// Preview de imagen al seleccionar archivo
document.addEventListener("DOMContentLoaded", () => {
  const imgInput = document.getElementById("prod-imagen");
  if (imgInput) {
    imgInput.addEventListener("change", function() {
      const file = this.files[0];
      const preview = document.getElementById("prod-img-preview");
      if (file) {
        const reader = new FileReader();
        reader.onload = e => { preview.src = e.target.result; preview.style.display = "block"; };
        reader.readAsDataURL(file);
      } else {
        preview.style.display = "none";
      }
    });
  }
});

// ============================================================
// DEVOLUCIONES
// ============================================================
let _devolucionVentaCache = null;

async function loadDevoluciones() {
  try {
    const list = await API.getDevoluciones();
    const tbody = document.getElementById("tabla-devoluciones");
    if (!list.length) {
      tbody.innerHTML = `<tr><td colspan="7" class="text-muted" style="text-align:center;padding:24px">No hay devoluciones registradas.</td></tr>`;
      return;
    }
    
    tbody.innerHTML = list.map(d => {
      let estadoBadge = `<span class="badge badge-low">${d.estado}</span>`;
      if (d.estado === 'APROBADA') estadoBadge = `<span class="badge badge-ok">Aprobada</span>`;
      else if (d.estado === 'RECHAZADA') estadoBadge = `<span class="badge badge-error">Rechazada</span>`;
      
      const diffMs = new Date() - new Date(d.fecha);
      const puedeEliminar = diffMs < (24 * 60 * 60 * 1000);
      const btnEliminar = puedeEliminar 
        ? `<button class="btn btn-danger btn-sm btn-icon" onclick="eliminarDevolucion(${d.id_devolucion})" title="Eliminar (24h)">✕</button>` 
        : "";

      let acciones = "";
      if (d.estado === 'PENDIENTE') {
        acciones = `
          <button class="btn btn-primary btn-sm" onclick="resolverDevolucion(${d.id_devolucion}, 'APROBADA')">✔ Aprobar</button>
          <button class="btn btn-secondary btn-sm" style="color:var(--error)" onclick="resolverDevolucion(${d.id_devolucion}, 'RECHAZADA')">✕ Rechazar</button>
        `;
      }
      
      return `
      <tr>
        <td class="fw-bold">${d.codigo_devolucion}</td>
        <td>
          <a href="#" onclick="${d.tipo === 'POS' ? `verDetalleVenta(${d.id_venta})` : `verDetallePedido(${d.id_venta})`};return false;">
            ${d.ticket_original}
          </a>
        </td>
        <td>${formatDate(d.fecha)}</td>
        <td>${d.motivo}</td>
        <td class="text-accent">${formatPrice(d.total_reembolsado)}</td>
        <td>${estadoBadge}</td>
        <td style="display:flex;gap:4px">
          ${acciones}
          ${btnEliminar}
        </td>
      </tr>
      `;
    }).join("");
  } catch (err) {
    showToast("Error cargando devoluciones: " + err.message, "error");
  }
}

async function resolverDevolucion(id, estado) {
  if (!confirm(`¿Estás seguro de ${estado === 'APROBADA'?'Aprobar':'Rechazar'} la devolución #${id}? Esta acción es irreversible.`)) return;
  try {
    await API.updateEstadoDevolucion(id, estado);
    showToast(`Devolución ${estado.toLowerCase()} exitosamente.`, "success");
    loadDevoluciones();
  } catch (err) {
    showToast(err.message, "error");
  }
}

function abrirModalNuevaDevolucion() {
  document.getElementById("dev-id-venta").value = "";
  document.getElementById("dev-motivo").value = "";
  document.getElementById("dev-productos-container").style.display = "none";
  document.getElementById("dev-productos-lista").innerHTML = "";
  document.getElementById("dev-total-reembolso").textContent = "$0";
  document.getElementById("btn-save-dev").disabled = true;
  _devolucionVentaCache = null;
  abrirModal("modal-devolucion");
}

async function buscarVentaParaDevolucion() {
  const vId = document.getElementById("dev-id-venta").value;
  if (!vId) return showToast("Ingresa un ID de Venta", "error");
  try {
    const res = await fetch(`/api/ventas/ticket/${vId}`, { headers: { "Authorization": "Bearer "+localStorage.getItem("td_token") }});
    if (!res.ok) throw new Error("Venta/Ticket no encontrado");
    const data = await res.json();
    
    _devolucionVentaCache = data;
    const tbody = document.getElementById("dev-productos-lista");
    tbody.innerHTML = data.detalles.map(d => `
      <tr>
        <td style="padding:4px">
          ${d.producto_nombre}
          ${d.talla ? `<br><small class="text-muted">${d.talla} | ${d.version}</small>` : ''}
        </td>
        <td style="padding:4px;text-align:center;">${d.cantidad}</td>
        <td style="padding:4px;text-align:right;">${formatPrice(d.subtotal/d.cantidad)}</td>
        <td style="padding:4px;text-align:right;">
          <input type="number" class="form-control" id="dev-cant-${d.id_producto}-${d.talla||'NA'}" min="0" max="${d.cantidad}" value="0" oninput="calcTotalDevolucion()" data-precio="${d.subtotal/d.cantidad}" style="padding:2px;text-align:center;width:60px">
        </td>
      </tr>
    `).join("");
    document.getElementById("dev-productos-container").style.display = "block";
    calcTotalDevolucion();
  } catch (e) {
    showToast(e.message, "error");
  }
}

function calcTotalDevolucion() {
  if (!_devolucionVentaCache) return;
  let total = 0;
  let devolverAlgo = false;
  _devolucionVentaCache.detalles.forEach(d => {
    const input = document.getElementById(`dev-cant-${d.id_producto}-${d.talla||'NA'}`);
    let cant = parseInt(input.value) || 0;
    if (cant > d.cantidad) { cant = d.cantidad; input.value = d.cantidad; }
    if (cant < 0) { cant = 0; input.value = 0; }
    if (cant > 0) devolverAlgo = true;
    const precio = parseFloat(input.dataset.precio) || 0;
    total += cant * precio;
  });
  document.getElementById("dev-total-reembolso").textContent = formatPrice(total);
  document.getElementById("btn-save-dev").disabled = !devolverAlgo;
}

async function guardarDevolucion() {
  const motivo = document.getElementById("dev-motivo").value.trim();
  if (!motivo) return showToast("El motivo es obligatorio", "error");
  
  const volver_a_stock = document.querySelector("input[name='dev-restock']:checked").value === "true";
  
  const detalles = [];
  _devolucionVentaCache.detalles.forEach(d => {
    const input = document.getElementById(`dev-cant-${d.id_producto}-${d.talla||'NA'}`);
    const cant = parseInt(input.value) || 0;
    const precio = parseFloat(input.dataset.precio) || 0;
    if (cant > 0) {
      detalles.push({ id_producto: d.id_producto, cantidad: cant, monto_reembolsado: cant * precio, talla: d.talla, version: d.version });
    }
  });
  
  if (!detalles.length) return showToast("Debes devolver al menos 1 producto", "error");
  
  const body = { 
    id_venta: _devolucionVentaCache.cabecera.id_venta, 
    tipo: _devolucionVentaCache.tipo, // 'POS' o 'WEB'
    motivo, 
    detalles, 
    volver_a_stock 
  };
  try {
    document.getElementById("btn-save-dev").disabled = true;
    await API.createDevolucion(body);
    cerrarModal("modal-devolucion");
    showToast("Devolución solicitada con éxito. Pendiente de aprobación.", "success");
    loadDevoluciones();
  } catch(e) {
    showToast(e.message, "error");
    document.getElementById("btn-save-dev").disabled = false;
  }
}

async function eliminarVenta(id) {
  if (!confirm(`¿Eliminar venta #${id} definitivamente? Esto restaurará el stock.`)) return;
  try {
    const res = await API.deleteVenta(id);
    showToast(res.message, "success");
    loadHistorial();
  } catch (err) {
    showToast(err.message, "error");
  }
}

async function eliminarDevolucion(id) {
  if (!confirm(`¿Eliminar devolución #${id} definitivamente? Si ya estaba aprobada, se revertirá el stock.`)) return;
  try {
    const res = await API.deleteDevolucion(id);
    showToast(res.message, "success");
    loadDevoluciones();
    loadHistorial(); // Podría estar en el historial también
  } catch (err) {
    showToast(err.message, "error");
  }
}

async function eliminarPedido(id) {
  if (!confirm(`¿Eliminar pedido #${id} definitivamente? Esto restaurará el stock si ya estaba aprobado.`)) return;
  try {
    const res = await API.deletePedido(id);
    showToast(res.message, "success");
    loadHistorial();
  } catch (err) {
    showToast(err.message, "error");
  }
}

function verMotivoDevolucion(cliente, motivo, volver_a_stock) {
  const destino = volver_a_stock ? "<span style='color:var(--success)'>🟢 Volvió al Inventario</span>" : "<span style='color:var(--danger)'>🔴 Pérdida Total (Dañado)</span>";
  const html = `
    <div class="table-title">Detalle de Devolución</div>
    <div style="margin-bottom:10px; font-size: 15px;">
      <p style="margin-bottom:6px"><strong>👤 Cliente:</strong> ${cliente}</p>
      <p style="margin-bottom:6px"><strong>📝 Motivo:</strong> ${motivo}</p>
      <p style="margin-bottom:6px"><strong>📦 Destino:</strong> ${destino}</p>
    </div>
  `;
  showToastHTML(html);
}
