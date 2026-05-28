// ============================================================
// routes/productos.js - Catálogo y gestión de camisetas EleJeserys
// ============================================================
// INVENTARIO POR TALLA/VERSIÓN CON KARDEX:
//   - Cada camiseta tiene inventario en tabla inventario (talla + versión)
//   - El producto también tiene un campo 'stock' genérico (para POS)
//   - PUT /:id/inventario → Calcula diferencia de stock y registra
//     movimiento de entrada o salida en tabla movimientos con origen='elejeserys'
//   - El costo unitario usa precio (Fan) o precio_player (Player)
//   - Las tallas permitidas: S, M, L, XL, XXL
//   - Las versiones: Fan (económica), Player (premium)
//
// ENDPOINTS:
//   GET  /api/productos            → Catálogo público con filtros
//   GET  /api/productos/destacados → Productos destacados (home)
//   GET  /api/productos/:id        → Detalle + inventario + imágenes
//   POST /api/productos            → Crear producto (admin)
//   PUT  /api/productos/:id        → Editar producto (admin)
//   DELETE /api/productos/:id      → Desactivar producto (admin)
//   POST /api/productos/:id/imagen → Subir imagen principal (admin, multer)
//   POST /api/productos/:id/galeria → Agregar imagen a galería
//   PUT  /api/productos/:id/inventario → Actualizar stock con KARDEX (admin)
// ============================================================
const express = require("express");
const router = express.Router();
const path = require("path");
const db = require("../db");
const { verificarToken, soloAdmin } = require("../middleware/auth");
const upload = require("../middleware/upload");
const KardexPonderado = require("../services/kardex_ponderado");
const { calcularPrecioVenta } = require("../services/priceService");

// ------------------------------------------------------------
// GET /api/productos - Catálogo público con filtros
// Query: ?categoria=1 &version=Fan &talla=M &buscar=colombia &pagina=1
// ------------------------------------------------------------
router.get("/", async (req, res) => {
  try {
    const { categoria, version, talla, buscar, pagina = 1 } = req.query;
    const limite = Math.min(parseInt(req.query.limite || "1000", 10) || 1000, 1000);
    const offset = (parseInt(pagina) - 1) * limite;
    const params = [];

    let sql = `
      SELECT DISTINCT p.id_producto, p.nombre, p.descripcion,
             p.precio, p.precio_player, p.precio_compra, p.stock,
             p.id_categoria, p.imagen, p.destacado, p.creado_en,
             c.nombre AS categoria_nombre, c.slug AS categoria_slug, c.parent_id AS categoria_parent_id
      FROM productos p
      LEFT JOIN categorias c ON p.id_categoria = c.id_categoria
      WHERE p.activo = 1
    `;

    if (categoria) {
      // Si es categoria padre, incluir hijos
      const [hijos] = await db.query(
        "SELECT id_categoria FROM categorias WHERE id_categoria=? OR parent_id=?",
        [categoria, categoria]
      );
      const ids = hijos.map(h => h.id_categoria);
      if (!ids.length) {
        sql += " AND 1 = 0";
      } else {
        sql += ` AND p.id_categoria IN (${ids.map(() => '?').join(',')})`;
        params.push(...ids);
      }
    }
    if (buscar)    { sql += " AND p.nombre LIKE ?"; params.push(`%${buscar}%`); }

    if (version || talla) {
      sql += ` AND EXISTS (
        SELECT 1 FROM inventario i WHERE i.id_producto = p.id_producto AND i.stock > 0`;
      if (version) { sql += " AND i.version = ?"; params.push(version); }
      if (talla)   { sql += " AND i.talla = ?";   params.push(talla); }
      sql += ")";
    }

    sql += " ORDER BY p.destacado DESC, p.creado_en DESC LIMIT ? OFFSET ?";
    params.push(limite, offset);

    const [productos] = await db.query(sql, params);
    res.json(productos);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error obteniendo productos." });
  }
});

// ------------------------------------------------------------
// GET /api/productos/destacados - Top 100 más vendidos
// ------------------------------------------------------------
router.get("/destacados", async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT p.*, c.nombre AS categoria_nombre,
             COALESCE(SUM(dv.cantidad), 0) AS total_vendido
      FROM productos p
      LEFT JOIN categorias c ON p.id_categoria = c.id_categoria
      LEFT JOIN detalle_ventas dv ON p.id_producto = dv.id_producto
      WHERE p.activo = 1
      GROUP BY p.id_producto
      HAVING total_vendido > 0 OR p.destacado = 1
      ORDER BY total_vendido DESC, p.creado_en DESC
      LIMIT 100
    `);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error obteniendo productos destacados." });
  }
});

router.get("/costos", verificarToken, async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT id_producto, nombre, stock, precio, precio_compra as costo_promedio
      FROM productos ORDER BY nombre
    `);
    rows.forEach(r => {
      r.costo_total = Number(r.stock) * Number(r.costo_promedio);
      r.costo_promedio = Number(r.costo_promedio);
    });
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ------------------------------------------------------------
// GET /api/productos/compras - Obtener todos los movimientos de compras agrupados
// ------------------------------------------------------------
router.get("/compras", verificarToken, async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT m.referencia, MAX(m.creado_en) AS fecha, COALESCE(SUM(m.costo_total), 0) AS total,
             GROUP_CONCAT(CONCAT(p.nombre, ' (', m.cantidad, ' u.)') SEPARATOR ', ') AS productos
      FROM movimientos m
      JOIN productos p ON p.id_producto = m.id_producto
      WHERE m.tipo = 'entrada' AND m.referencia LIKE 'COM%'
      GROUP BY m.referencia
      ORDER BY fecha DESC
    `);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ------------------------------------------------------------
// GET /api/productos/compras/:referencia - Obtener el detalle de una compra
// ------------------------------------------------------------
router.get("/compras/:referencia", verificarToken, async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT m.id_movimiento, m.creado_en AS fecha, p.nombre AS producto_nombre,
             m.talla, m.version, m.cantidad, m.costo_unitario, m.costo_total
      FROM movimientos m
      JOIN productos p ON p.id_producto = m.id_producto
      WHERE m.referencia = ?
      ORDER BY m.id_movimiento ASC
    `, [req.params.referencia]);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ------------------------------------------------------------
// GET /api/productos/:id - Detalle completo con inventario
// ------------------------------------------------------------
router.get("/:id", async (req, res) => {
  try {
    const [prod] = await db.query(`
      SELECT p.*, c.nombre AS categoria_nombre, c.slug AS categoria_slug
      FROM productos p
      LEFT JOIN categorias c ON p.id_categoria = c.id_categoria
      WHERE p.id_producto = ? AND p.activo = 1
    `, [req.params.id]);

    if (!prod.length) return res.status(404).json({ error: "Producto no encontrado." });

    // Inventario por talla y versión
    const [inventario] = await db.query(
      "SELECT talla, version, stock FROM inventario WHERE id_producto = ? ORDER BY FIELD(talla,'S','M','L','XL','XXL'), version",
      [req.params.id]
    );

    res.json({ ...prod[0], inventario });
  } catch (err) {
    res.status(500).json({ error: "Error obteniendo producto." });
  }
});

// ------------------------------------------------------------
// POST /api/productos - Crear producto (admin)
// Body: { nombre, descripcion, precio, precio_player, id_categoria, destacado }
// ------------------------------------------------------------
router.post("/", verificarToken, soloAdmin, async (req, res) => {
  const { nombre, descripcion, precio_compra, id_categoria, destacado = 0, margen_porcentaje, precio_player } = req.body;
  if (!nombre) return res.status(400).json({ error: "Nombre es requerido." });
  
  try {
    // Calcular precio automáticamente si hay costo
    let finalPrecio = req.body.precio || 0;
    if (precio_compra) {
      const [[cat]] = await db.query("SELECT margen_porcentaje FROM categorias WHERE id_categoria=?", [id_categoria]);
      finalPrecio = calcularPrecioVenta(precio_compra, margen_porcentaje, cat?.margen_porcentaje);
    }

    const [r] = await db.query(
      "INSERT INTO productos (nombre, descripcion, precio, precio_player, id_categoria, destacado, precio_compra, margen_porcentaje) VALUES (?,?,?,?,?,?,?,?)",
      [nombre, descripcion, finalPrecio, precio_player || null, id_categoria || null, destacado, precio_compra || 0, margen_porcentaje || null]
    );
    res.status(201).json({ mensaje: "Producto creado.", id_producto: r.insertId });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error creando producto." });
  }
});

// ------------------------------------------------------------
// PUT /api/productos/:id - Editar producto (admin)
// ------------------------------------------------------------
router.put("/:id", verificarToken, soloAdmin, async (req, res) => {
  const camposPermitidos = ["nombre", "descripcion", "precio", "precio_player", "id_categoria", "destacado", "activo", "margen_porcentaje", "precio_compra"];
  const updates = [];
  const params = [];

  for (const campo of camposPermitidos) {
    if (Object.prototype.hasOwnProperty.call(req.body, campo)) {
      const val = req.body[campo] === "" ? null : req.body[campo];
      // No actualizar precio a null (columna NOT NULL; se recalcula por margen)
      if (campo === "precio" && (val === null || val === undefined)) continue;
      updates.push(`${campo}=?`);
      params.push(val);
    }
  }

  if (!updates.length) {
    return res.status(400).json({ error: "No hay datos para actualizar." });
  }

  try {
    params.push(req.params.id);
    await db.query(
      `UPDATE productos SET ${updates.join(",")} WHERE id_producto=?`,
      params
    );

    // Si se actualizó margen, categoría o precio_compra, recalcular precio final
    if (req.body.margen_porcentaje !== undefined || req.body.id_categoria !== undefined || req.body.precio_compra !== undefined) {
      const [[p]] = await db.query(`
        SELECT p.precio_compra, p.margen_porcentaje, c.margen_porcentaje as margen_cat
        FROM productos p
        LEFT JOIN categorias c ON p.id_categoria = c.id_categoria
        WHERE p.id_producto = ?
      `, [req.params.id]);
      
      if (p && p.precio_compra > 0) {
        const nuevoPrecio = calcularPrecioVenta(p.precio_compra, p.margen_porcentaje, p.margen_cat);
        await db.query("UPDATE productos SET precio = ? WHERE id_producto = ?", [nuevoPrecio, req.params.id]);
      }
    }

    res.json({ mensaje: "Producto actualizado." });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error actualizando." });
  }
});

// ------------------------------------------------------------
// POST /api/productos/:id/imagen - Subir imagen principal (admin)
// Form-data: imagen (archivo)
// ------------------------------------------------------------
router.post("/:id/imagen", verificarToken, soloAdmin, upload.single("imagen"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No se recibió imagen." });
  const url = `/uploads/${req.file.filename}`;
  try {
    await db.query("UPDATE productos SET imagen=? WHERE id_producto=?", [url, req.params.id]);
    res.json({ mensaje: "Imagen subida.", url });
  } catch (err) {
    res.status(500).json({ error: "Error guardando imagen." });
  }
});

// ------------------------------------------------------------
// POST /api/productos/:id/galeria - Agregar imagen a galería
// ------------------------------------------------------------
router.post("/:id/galeria", verificarToken, soloAdmin, upload.single("imagen"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No se recibió imagen." });
  const url = `/uploads/${req.file.filename}`;
  try {
    await db.query(
      "INSERT INTO producto_imagenes (id_producto, url) VALUES (?,?)",
      [req.params.id, url]
    );
    res.json({ mensaje: "Imagen agregada a galería.", url });
  } catch (err) {
    res.status(500).json({ error: "Error." });
  }
});

// ------------------------------------------------------------
// PUT /api/productos/:id/inventario - Actualizar stock de tallas (admin)
// Body: { inventario: [{talla, version, stock}, ...] }
// ------------------------------------------------------------
router.put("/:id/inventario", verificarToken, soloAdmin, async (req, res) => {
  const { inventario } = req.body;
  if (!Array.isArray(inventario)) return res.status(400).json({ error: "Formato inválido." });
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    for (const item of inventario) {
      const [[actual]] = await conn.query(
        "SELECT stock FROM inventario WHERE id_producto=? AND talla=? AND version=?",
        [req.params.id, item.talla, item.version]
      );
      const stockActual = Number(actual?.stock || 0);
      const stockNuevo = Number(item.stock || 0);

      await conn.query(
        `INSERT INTO inventario (id_producto, talla, version, stock)
         VALUES (?,?,?,?)
         ON DUPLICATE KEY UPDATE stock = ?`,
        [req.params.id, item.talla, item.version, stockNuevo, stockNuevo]
      );

      const diferencia = stockNuevo - stockActual;
      if (diferencia !== 0) {
        const [[producto]] = await conn.query(
          "SELECT precio, precio_player FROM productos WHERE id_producto=?",
          [req.params.id]
        );
        await KardexPonderado.registrarMovimiento(conn, {
          id_producto: req.params.id,
          tipo: diferencia > 0 ? "entrada" : "salida",
          cantidad: Math.abs(diferencia),
          costo_unitario: item.version === "Player" ? (producto?.precio_player || producto?.precio) : producto?.precio,
          origen: "elejeserys",
          referencia: "ajuste_inventario",
          id_referencia: req.params.id,
          talla: item.talla,
          version: item.version,
        });
      }
    }
    await conn.commit();
    res.json({ mensaje: "Inventario actualizado." });
  } catch (err) {
    await conn.rollback();
    res.status(500).json({ error: "Error actualizando inventario." });
  } finally {
    conn.release();
  }
});

// ------------------------------------------------------------
// DELETE /api/productos/:id - Desactivar producto (admin)
// ------------------------------------------------------------
router.delete("/:id", verificarToken, soloAdmin, async (req, res) => {
  try {
    const [[producto]] = await db.query("SELECT activo FROM productos WHERE id_producto=?", [req.params.id]);
    if (!producto) return res.status(404).json({ error: "Producto no encontrado." });
    if (!producto.activo) return res.status(400).json({ error: "El producto ya está inactivo." });
    await db.query("UPDATE productos SET activo=0 WHERE id_producto=?", [req.params.id]);
    res.json({ message: "Producto desactivado." });
  } catch (err) {
    res.status(500).json({ error: "Error desactivando producto." });
  }
});

// ------------------------------------------------------------
// POST /api/productos/:id/agregar-stock - Agregar stock con precio de compra
// Body: { cantidad, precio_compra, talla, version, referencia }
// ------------------------------------------------------------
router.post("/:id/agregar-stock", verificarToken, soloAdmin, async (req, res) => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    
    const id_proveedor = req.body.id_proveedor || null;

    let ref = req.body.referencia;
    if (!ref || ref === "compra" || ref.trim() === "") {
      let catName = "GEN";
      const [[prodCat]] = await conn.query(`
        SELECT c.nombre as cat_nombre, parent.nombre as parent_nombre
        FROM productos p
        LEFT JOIN categorias c ON p.id_categoria = c.id_categoria
        LEFT JOIN categorias parent ON c.parent_id = parent.id_categoria
        WHERE p.id_producto = ?
      `, [req.params.id]);

      if (prodCat) {
        const nameToUse = prodCat.parent_nombre || prodCat.cat_nombre || "GEN";
        catName = nameToUse.substring(0, 3).toUpperCase();
      }

      const prefix = `COM${catName}`;
      const [[lastMov]] = await conn.query(
        "SELECT referencia FROM movimientos WHERE referencia LIKE ? ORDER BY id_movimiento DESC LIMIT 1",
        [`${prefix}%`]
      );
      let nextNum = 1;
      if (lastMov && lastMov.referencia) {
        const lastRef = lastMov.referencia;
        const numStr = lastRef.substring(prefix.length);
        const parsedNum = parseInt(numStr, 10);
        if (!isNaN(parsedNum)) {
          nextNum = parsedNum + 1;
        }
      }
      ref = `${prefix}${nextNum.toString().padStart(7, '0')}`;
    }

    // 1. Obtener datos actuales del producto para ponderar
    const [[prod]] = await conn.query("SELECT stock, precio_compra FROM productos WHERE id_producto=?", [req.params.id]);
    let stockActual = Number(prod.stock || 0);
    let costoActual = Number(prod.precio_compra || 0);

    // Modo simple: un solo producto/precio (balones, etc.)
    if (req.body.cantidad) {
      const qty = Number(req.body.cantidad);
      let costo = Number(req.body.precio_compra);
      if (!qty || qty <= 0) throw new Error("Cantidad requerida.");
      if (!costo || costo <= 0) {
        const [[prod]] = await conn.query("SELECT precio, precio_compra FROM productos WHERE id_producto=?", [req.params.id]);
        costo = prod?.precio_compra || prod?.precio || 0;
      }
      
      const nuevoStock = stockActual + qty;
      const nuevoCosto = (stockActual * costoActual + qty * costo) / nuevoStock;
      
      await conn.query("UPDATE productos SET stock=?, precio_compra=? WHERE id_producto=?", [nuevoStock, nuevoCosto, req.params.id]);
      
      if (req.body.talla && req.body.version) {
        await conn.query("INSERT INTO inventario (id_producto,talla,version,stock) VALUES (?,?,?,?) ON DUPLICATE KEY UPDATE stock=stock+?", [req.params.id, req.body.talla, req.body.version, qty, qty]);
      }
      await KardexPonderado.registrarMovimiento(conn, { id_producto: req.params.id, tipo: "entrada", cantidad: qty, costo_unitario: costo, referencia: ref, id_referencia: req.params.id, talla: req.body.talla || null, version: req.body.version || null, id_proveedor });
    }

    // Modo tallas: array de items (camisetas)
    if (req.body.items && Array.isArray(req.body.items)) {
      const [[prodDef]] = await conn.query("SELECT precio, precio_compra FROM productos WHERE id_producto=?", [req.params.id]);
      const precioDefecto = prodDef?.precio_compra || prodDef?.precio || 0;
      let stockAgregadoTotal = 0;
      let costoAgregadoTotal = 0;

      for (const item of req.body.items) {
        const qty = Number(item.cantidad);
        let costo = Number(item.precio_compra);
        if (!qty || qty <= 0) continue;
        if (!costo || costo <= 0) costo = precioDefecto;
        
        stockAgregadoTotal += qty;
        costoAgregadoTotal += (qty * costo);

        await conn.query("INSERT INTO inventario (id_producto,talla,version,stock) VALUES (?,?,?,?) ON DUPLICATE KEY UPDATE stock=stock+?", [req.params.id, item.talla, item.version, qty, qty]);
        await KardexPonderado.registrarMovimiento(conn, { id_producto: req.params.id, tipo: "entrada", cantidad: qty, costo_unitario: costo, referencia: ref, id_referencia: req.params.id, talla: item.talla, version: item.version, id_proveedor });
      }

      if (stockAgregadoTotal > 0) {
        const nuevoStock = stockActual + stockAgregadoTotal;
        const nuevoCosto = (stockActual * costoActual + costoAgregadoTotal) / nuevoStock;
        
        // Recalcular precio de venta
        const [[margenes]] = await conn.query(`
          SELECT p.margen_porcentaje, c.margen_porcentaje as margen_cat
          FROM productos p
          LEFT JOIN categorias c ON p.id_categoria = c.id_categoria
          WHERE p.id_producto = ?
        `, [req.params.id]);
        
        const nuevoPrecioVenta = calcularPrecioVenta(nuevoCosto, margenes.margen_porcentaje, margenes.margen_cat);
        
        await conn.query(
          "UPDATE productos SET stock=?, precio_compra=?, precio=? WHERE id_producto=?", 
          [nuevoStock, nuevoCosto, nuevoPrecioVenta, req.params.id]
        );
      }
    }

    await conn.commit();
    res.json({ message: "Stock agregado." });
  } catch (err) { await conn.rollback(); res.status(500).json({ error: err.message }); }
  finally { conn.release(); }
});

module.exports = router;
