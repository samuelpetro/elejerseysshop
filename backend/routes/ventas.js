// ============================================================
// routes/ventas.js - Punto de Venta (POS) Tienda Deportiva
// ============================================================
// REGISTRO DE VENTA CON KARDEX (POST /api/ventas):
//   1. Valida stock disponible para cada producto
//   2. Calcula total sumando (precio × cantidad) de cada item
//   3. Inserta cabecera en tabla ventas
//   4. Inserta detalle en tabla detalle_ventas
//   5. Descuenta stock: UPDATE productos SET stock = stock - cantidad
//   6. Registra movimiento 'salida' en tabla movimientos:
//      - origen='tienda_deportiva'
//      - referencia='venta'
//      - id_referencia = id_venta
//      - talla=NULL, version=NULL (productos POS no usan talla)
//   7. Todo en una TRANSACCIÓN: si falla algo, se revierte (rollback)
//
// ENDPOINTS:
//   GET  /api/ventas          → Listar ventas recientes con cliente
//   GET  /api/ventas/:id      → Detalle completo (cabecera + productos vendidos)
//   POST /api/ventas          → Registrar nueva venta con kardex
// ============================================================
const express = require("express");
const router = express.Router();
const db = require("../db");
const { verificarToken } = require("../middleware/auth");
const KardexPonderado = require("../services/kardex_ponderado");

router.use(verificarToken);

// ------------------------------------------------------------
// GET /api/ventas - Listar ventas recientes con cliente
// ------------------------------------------------------------
router.get("/", async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT v.id_venta, v.codigo_ticket, v.fecha, v.total,
             CONCAT(c.nombre, ' ', c.apellido) AS cliente_nombre,
             c.id_cliente
      FROM ventas v
      LEFT JOIN clientes c ON v.id_cliente = c.id_cliente
      ORDER BY v.fecha DESC
      LIMIT 100
    `);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error obteniendo ventas." });
  }
});

// ------------------------------------------------------------
// GET /api/ventas/ticket/:codigo - Detalle completo usando ticket (Ventas o Pedidos)
// ------------------------------------------------------------
router.get("/ticket/:codigo", async (req, res) => {
  try {
    let codigo = req.params.codigo;
    let esPedido = codigo.toUpperCase().startsWith("WEB-");
    let idPedido = esPedido ? codigo.substring(4) : null;

    // 1. Intentar buscar en ventas (POS)
    const [venta] = await db.query(`
      SELECT v.id_venta, v.codigo_ticket, v.fecha, v.total, v.id_cliente,
             CONCAT(c.nombre, ' ', c.apellido) AS cliente_nombre, c.email, c.telefono
      FROM ventas v
      LEFT JOIN clientes c ON v.id_cliente = c.id_cliente
      WHERE v.codigo_ticket = ? OR v.id_venta = ?
    `, [codigo, codigo]);

    if (venta.length > 0) {
      const [detalle] = await db.query(`
        SELECT dv.id_producto, dv.cantidad, dv.precio_unitario, dv.subtotal, p.nombre AS producto_nombre
        FROM detalle_ventas dv
        JOIN productos p ON dv.id_producto = p.id_producto
        WHERE dv.id_venta = ?
      `, [venta[0].id_venta]);
      return res.json({ cabecera: venta[0], detalles: detalle, tipo: 'POS' });
    }

    // 2. Intentar buscar en pedidos (WEB)
    const searchId = idPedido || (isNaN(codigo) ? null : codigo);
    if (searchId) {
      const [pedido] = await db.query(`
        SELECT p.id_pedido as id_venta, CONCAT('WEB-', p.id_pedido) as codigo_ticket, p.creado_en as fecha, p.total, p.id_usuario as id_cliente,
               COALESCE(c.nombre, u.nombre) as nombre, COALESCE(c.apellido, u.apellido) as apellido,
               COALESCE(c.email, u.email) as email, COALESCE(c.telefono, u.telefono) as telefono
        FROM pedidos p
        LEFT JOIN clientes c ON p.id_usuario = c.id_cliente
        LEFT JOIN usuarios u ON p.id_usuario = u.id_usuario
        WHERE p.id_pedido = ?
      `, [searchId]);

      if (pedido.length > 0) {
        pedido[0].cliente_nombre = (pedido[0].nombre || '') + ' ' + (pedido[0].apellido || '');
        const [detalle] = await db.query(`
          SELECT dp.id_producto, dp.cantidad, dp.precio_unitario, dp.subtotal, dp.talla, dp.version, p.nombre AS producto_nombre
          FROM detalle_pedidos dp
          JOIN productos p ON dp.id_producto = p.id_producto
          WHERE dp.id_pedido = ?
        `, [pedido[0].id_venta]);
        return res.json({ cabecera: pedido[0], detalles: detalle, tipo: 'WEB' });
      }
    }

    res.status(404).json({ error: "Transacción no encontrada." });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error obteniendo detalle de transacción." });
  }
});


// ------------------------------------------------------------
// GET /api/ventas/:id - Detalle completo con productos vendidos
// ------------------------------------------------------------
router.get("/:id", async (req, res) => {
  try {
    // Info de la venta y cliente
    const [venta] = await db.query(`
      SELECT v.*, CONCAT(c.nombre, ' ', c.apellido) AS cliente_nombre, c.email, c.telefono
      FROM ventas v
      LEFT JOIN clientes c ON v.id_cliente = c.id_cliente
      WHERE v.id_venta = ?
    `, [req.params.id]);

    if (venta.length === 0) return res.status(404).json({ error: "Venta no encontrada." });

    // Productos del detalle
    const [detalle] = await db.query(`
      SELECT dv.*, p.nombre AS producto_nombre
      FROM detalle_ventas dv
      JOIN productos p ON dv.id_producto = p.id_producto
      WHERE dv.id_venta = ?
    `, [req.params.id]);

    res.json({ ...venta[0], detalle });
  } catch (err) {
    res.status(500).json({ error: "Error obteniendo detalle de venta." });
  }
});

// ------------------------------------------------------------
// POST /api/ventas - Registrar nueva venta
// Body: {
//   id_cliente: 1,
//   items: [ { id_producto, cantidad }, ... ]
// }
// Se calcula el total automaticamente con los precios actuales
// Se descuenta el stock de cada producto
// ------------------------------------------------------------
router.post("/", async (req, res) => {
  const { id_cliente, items, descuento, descuento_tipo } = req.body;

  if (!items || items.length === 0) {
    return res.status(400).json({ error: "La venta debe tener al menos un producto." });
  }

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    let subtotal = 0;
    const detalles = [];

    for (const item of items) {
      const [prod] = await conn.query(
        "SELECT id_producto, precio, stock, nombre FROM productos WHERE id_producto = ?",
        [item.id_producto]
      );

      if (prod.length === 0) throw new Error(`Producto ID ${item.id_producto} no existe.`);
      if (prod[0].stock < item.cantidad) {
        throw new Error(`Stock insuficiente para "${prod[0].nombre}". Disponible: ${prod[0].stock}`);
      }

      const lineaSubtotal = prod[0].precio * item.cantidad;
      subtotal += lineaSubtotal;

      detalles.push({
        id_producto: item.id_producto,
        cantidad: item.cantidad,
        precio_unitario: prod[0].precio,
        subtotal: lineaSubtotal,
      });
    }

    // Aplicar descuento
    const descVal = parseFloat(descuento) || 0;
    const total = descuento_tipo === "porcentaje" && descVal > 0
      ? subtotal - (subtotal * descVal / 100)
      : subtotal - descVal;

    // Insertar cabecera de venta con un código temporal único para la restricción UNIQUE NOT NULL
    const temp_codigo = `TEMP-${Date.now()}-${Math.floor(Math.random() * 1000000)}`;

    // Insertar cabecera de venta
    const [ventaResult] = await conn.query(
      "INSERT INTO ventas (id_cliente, total, codigo_ticket) VALUES (?, ?, ?)",
      [id_cliente || null, total, temp_codigo]
    );
    const id_venta = ventaResult.insertId;

    // Generar y actualizar con el ticket consecutivo definitivo FK000xxx
    const codigo_ticket = `FK${id_venta.toString().padStart(6, '0')}`;
    await conn.query(
      "UPDATE ventas SET codigo_ticket = ? WHERE id_venta = ?",
      [codigo_ticket, id_venta]
    );

    // Insertar detalle y descontar stock
    for (const d of detalles) {
      await conn.query(
        "INSERT INTO detalle_ventas (id_venta, id_producto, cantidad, precio_unitario, subtotal) VALUES (?, ?, ?, ?, ?)",
        [id_venta, d.id_producto, d.cantidad, d.precio_unitario, d.subtotal]
      );
      await conn.query(
        "UPDATE productos SET stock = stock - ? WHERE id_producto = ?",
        [d.cantidad, d.id_producto]
      );
      await KardexPonderado.registrarMovimiento(conn, {
        id_producto: d.id_producto,
        tipo: "salida",
        cantidad: d.cantidad,
        costo_unitario: d.precio_unitario,
        referencia: "venta",
        id_referencia: id_venta,
      });
    }

    await conn.commit();
    res.status(201).json({ message: "Venta registrada correctamente.", id_venta, total });
  } catch (err) {
    await conn.rollback(); // Si algo falla, revertir todo
    console.error("Error en venta:", err.message);
    res.status(400).json({ error: err.message });
  } finally {
    conn.release();
  }
});

// ------------------------------------------------------------
// DELETE /api/ventas/:id - Eliminar una venta (máximo 24h)
// ------------------------------------------------------------
router.delete("/:id", async (req, res) => {
  const { id } = req.params;
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    // 1. Obtener la venta y verificar el tiempo
    const [[venta]] = await conn.query("SELECT fecha FROM ventas WHERE id_venta = ?", [id]);
    if (!venta) return res.status(404).json({ error: "Venta no encontrada." });

    const diffMs = new Date() - new Date(venta.fecha);
    const diffHours = diffMs / (1000 * 60 * 60);

    if (diffHours > 24) {
      return res.status(400).json({ error: "No se puede eliminar una venta después de 24 horas." });
    }

    // 2. Obtener detalles para devolver el stock
    const [detalles] = await conn.query("SELECT id_producto, cantidad FROM detalle_ventas WHERE id_venta = ?", [id]);

    for (const d of detalles) {
      // Regresar stock
      await conn.query("UPDATE productos SET stock = stock + ? WHERE id_producto = ?", [d.cantidad, d.id_producto]);
      
      // Borrar del kardex
      await conn.query("DELETE FROM movimientos WHERE id_referencia = ? AND referencia = 'venta' AND id_producto = ?", [id, d.id_producto]);
    }

    // 3. Borrar registros de la venta
    await conn.query("DELETE FROM detalle_ventas WHERE id_venta = ?", [id]);
    await conn.query("DELETE FROM ventas WHERE id_venta = ?", [id]);

    await conn.commit();
    res.json({ message: "Venta eliminada correctamente y stock restaurado." });
  } catch (err) {
    await conn.rollback();
    console.error(err);
    res.status(500).json({ error: "Error eliminando la venta." });
  } finally {
    conn.release();
  }
});

module.exports = router;
