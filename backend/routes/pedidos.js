// ============================================================
// routes/pedidos.js - Pedidos EleJeserys + Aprobacion
// ============================================================
const express = require("express");
const router = express.Router();
const db = require("../db");
const { verificarToken, soloAdmin } = require("../middleware/auth");
const KardexPonderado = require("../services/kardex_ponderado");

router.use(verificarToken);

// POST /api/pedidos - Cliente crea pedido (pendiente, sin descontar stock)
router.post("/", async (req, res) => {
  const { items, direccion, notas } = req.body;
  if (!items?.length) return res.status(400).json({ error: "El pedido debe tener al menos un producto." });
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    let total = 0; const detalles = [];
    for (const item of items) {
      const [prod] = await conn.query("SELECT nombre, precio, precio_player FROM productos WHERE id_producto=? AND activo=1", [item.id_producto]);
      if (!prod.length) throw new Error(`Producto ID ${item.id_producto} no disponible.`);
      const precio = item.version === "Player" && prod[0].precio_player ? prod[0].precio_player : prod[0].precio;
      if (item.talla && item.version) {
        const [inv] = await conn.query("SELECT stock FROM inventario WHERE id_producto=? AND talla=? AND version=?", [item.id_producto, item.talla, item.version]);
        if (!inv.length || inv[0].stock < item.cantidad) throw new Error(`Stock insuficiente: ${prod[0].nombre} talla ${item.talla} ${item.version}.`);
      } else {
        const [[ps]] = await conn.query("SELECT stock FROM productos WHERE id_producto=?", [item.id_producto]);
        if (!ps || ps.stock < item.cantidad) throw new Error(`Stock insuficiente: ${prod[0].nombre}.`);
      }
      const subtotal = precio * item.cantidad; total += subtotal;
      detalles.push({ ...item, precio_unitario: precio, subtotal });
    }
    const [pedido] = await conn.query("INSERT INTO pedidos (id_usuario, total, estado, direccion, notas) VALUES (?,?,'pendiente',?,?)", [req.user.id, total, direccion || null, notas || null]);
    for (const d of detalles) {
      await conn.query("INSERT INTO detalle_pedidos (id_pedido,id_producto,talla,version,cantidad,precio_unitario,subtotal) VALUES (?,?,?,?,?,?,?)", [pedido.insertId, d.id_producto, d.talla || null, d.version || null, d.cantidad, d.precio_unitario, d.subtotal]);
    }
    await conn.commit();
    res.status(201).json({ mensaje: "Pedido creado. Pendiente de aprobacion.", id_pedido: pedido.insertId, total });
  } catch (err) { await conn.rollback(); res.status(400).json({ error: err.message }); }
  finally { conn.release(); }
});

// GET /api/pedidos/mis - Pedidos del cliente
router.get("/mis", async (req, res) => {
  try { const [rows] = await db.query("SELECT * FROM pedidos WHERE id_usuario=? ORDER BY creado_en DESC", [req.user.id]); res.json(rows); }
  catch (err) { res.status(500).json({ error: "Error." }); }
});

// Rutas especificas DEBEN ir antes de /:id
// GET /api/pedidos/pendientes
router.get("/pendientes", async (req, res) => {
  try {
    const [rows] = await db.query(`SELECT p.id_pedido, p.total, p.estado, p.direccion, p.notas, p.creado_en, COALESCE(c.nombre, u.nombre) AS cliente_nombre, COALESCE(c.apellido, u.apellido) AS cliente_apellido, COALESCE(c.telefono, u.telefono) AS cliente_telefono, COALESCE(c.email, u.email) AS cliente_email FROM pedidos p LEFT JOIN clientes c ON p.id_usuario = c.id_cliente LEFT JOIN usuarios u ON p.id_usuario = u.id_usuario WHERE p.estado = 'pendiente' ORDER BY p.creado_en DESC`);
    res.json(rows);
  } catch (err) { res.status(500).json({ error: "Error." }); }
});

// GET /api/pedidos/aprobados (historial)
router.get("/todos", soloAdmin, async (req, res) => {
  try {
    const [rows] = await db.query(`SELECT p.*, COALESCE(c.nombre, u.nombre) AS cliente_n, COALESCE(c.apellido, u.apellido) AS cliente_a, COALESCE(c.email, u.email) AS cliente_email FROM pedidos p LEFT JOIN clientes c ON p.id_usuario = c.id_cliente LEFT JOIN usuarios u ON p.id_usuario = u.id_usuario ORDER BY p.creado_en DESC LIMIT 100`);
    res.json(rows.map(r => ({...r, cliente: (r.cliente_n||'')+' '+(r.cliente_a||''), email: r.cliente_email})));
  } catch (err) { res.status(500).json({ error: "Error." }); }
});

// GET /api/pedidos/:id/detalle (especifico, antes de /:id)
router.get("/:id/detalle", async (req, res) => {
  try { const [d]=await db.query("SELECT dp.*, p.nombre AS producto_nombre, p.imagen FROM detalle_pedidos dp JOIN productos p ON dp.id_producto=p.id_producto WHERE dp.id_pedido=?", [req.params.id]); res.json(d); }
  catch (err) { res.status(500).json({ error: "Error." }); }
});

// PUT /api/pedidos/:id/aprobar (especifico)
router.put("/:id/aprobar", async (req, res) => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const [[pedido]] = await conn.query("SELECT * FROM pedidos WHERE id_pedido=? AND estado='pendiente'", [req.params.id]);
    if (!pedido) throw new Error("Pedido no encontrado o ya procesado.");
    const [detalle] = await conn.query("SELECT dp.*, COALESCE(p.precio_player, p.precio) AS costo, p.nombre AS producto_nombre FROM detalle_pedidos dp JOIN productos p ON dp.id_producto=p.id_producto WHERE dp.id_pedido=?", [req.params.id]);
    for (const item of detalle) {
      if (item.talla && item.version) {
        const [[inv]] = await conn.query("SELECT stock FROM inventario WHERE id_producto=? AND talla=? AND version=?", [item.id_producto, item.talla, item.version]);
        if (!inv || inv.stock < item.cantidad) throw new Error("Stock insuficiente: "+item.producto_nombre);
        await conn.query("UPDATE inventario SET stock=stock-? WHERE id_producto=? AND talla=? AND version=?", [item.cantidad, item.id_producto, item.talla, item.version]);
      } else {
        const [[prod]] = await conn.query("SELECT stock FROM productos WHERE id_producto=?", [item.id_producto]);
        if (!prod || prod.stock < item.cantidad) throw new Error("Stock insuficiente: "+item.producto_nombre);
        await conn.query("UPDATE productos SET stock=stock-? WHERE id_producto=?", [item.cantidad, item.id_producto]);
      }
      await KardexPonderado.registrarMovimiento(conn, { id_producto: item.id_producto, tipo: "salida", cantidad: item.cantidad, costo_unitario: item.costo, origen: "elejeserys", referencia: "pedido_aprobado", id_referencia: req.params.id, talla: item.talla || null, version: item.version || null });
    }
    await conn.query("UPDATE pedidos SET estado='confirmado' WHERE id_pedido=?", [req.params.id]);
    await conn.commit(); res.json({ message: "Pedido aprobado. Stock descontado." });
  } catch (err) { await conn.rollback(); res.status(400).json({ error: err.message }); }
  finally { conn.release(); }
});

// PUT /api/pedidos/:id/rechazar (especifico)
router.put("/:id/rechazar", async (req, res) => {
  try {
    const [r]=await db.query("UPDATE pedidos SET estado='cancelado' WHERE id_pedido=? AND estado='pendiente'", [req.params.id]);
    if (r.affectedRows===0) return res.status(404).json({ error: "Pedido no encontrado o ya procesado." });
    res.json({ message: "Pedido rechazado." });
  } catch (err) { res.status(500).json({ error: "Error." }); }
});

// GET /api/pedidos/:id (generico, DEBE ir al final)
router.get("/:id", async (req, res) => {
  try {
    const [pedido] = await db.query("SELECT * FROM pedidos WHERE id_pedido=?", [req.params.id]);
    if (!pedido.length) return res.status(404).json({ error: "Pedido no encontrado." });
    if (req.user.rol !== "admin" && pedido[0].id_usuario !== req.user.id) return res.status(403).json({ error: "Sin acceso." });
    const [detalle] = await db.query("SELECT dp.*, p.nombre AS producto_nombre, p.imagen FROM detalle_pedidos dp JOIN productos p ON dp.id_producto = p.id_producto WHERE dp.id_pedido = ?", [req.params.id]);
    res.json({ ...pedido[0], detalle });
  } catch (err) { res.status(500).json({ error: "Error." }); }
});

// PUT /api/pedidos/:id/estado (generico, al final)
router.put("/:id/estado", soloAdmin, async (req, res) => {
  const { estado } = req.body;
  const estados = ["pendiente","confirmado","enviado","entregado","cancelado"];
  if (!estados.includes(estado)) return res.status(400).json({ error: "Estado invalido." });
  try { await db.query("UPDATE pedidos SET estado=? WHERE id_pedido=?", [estado, req.params.id]); res.json({ mensaje: "Estado actualizado." }); }
  catch (err) { res.status(500).json({ error: "Error." }); }
});

// DELETE /api/pedidos/:id - Eliminar pedido (máximo 24h)
router.delete("/:id", soloAdmin, async (req, res) => {
  const { id } = req.params;
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    // 1. Obtener el pedido y verificar el tiempo
    const [[pedido]] = await conn.query("SELECT creado_en, estado FROM pedidos WHERE id_pedido = ?", [id]);
    if (!pedido) return res.status(404).json({ error: "Pedido no encontrado." });

    const diffMs = new Date() - new Date(pedido.creado_en);
    const diffHours = diffMs / (1000 * 60 * 60);

    if (diffHours > 24) {
      return res.status(400).json({ error: "No se puede eliminar un pedido después de 24 horas." });
    }

    // 2. Si el pedido afectó stock, revertir
    const estadosQueAfectanStock = ['confirmado', 'enviado', 'entregado'];
    if (estadosQueAfectanStock.includes(pedido.estado)) {
      const [detalles] = await conn.query("SELECT id_producto, cantidad, talla, version FROM detalle_pedidos WHERE id_pedido = ?", [id]);

      for (const d of detalles) {
        if (d.talla && d.version) {
          await conn.query("UPDATE inventario SET stock = stock + ? WHERE id_producto = ? AND talla = ? AND version = ?", [d.cantidad, d.id_producto, d.talla, d.version]);
        } else {
          await conn.query("UPDATE productos SET stock = stock + ? WHERE id_producto = ?", [d.cantidad, d.id_producto]);
        }
        
        // Borrar del kardex
        await conn.query("DELETE FROM movimientos WHERE id_referencia = ? AND referencia = 'pedido_aprobado' AND id_producto = ?", [id, d.id_producto]);
      }
    }

    // 3. Borrar registros del pedido
    await conn.query("DELETE FROM detalle_pedidos WHERE id_pedido = ?", [id]);
    await conn.query("DELETE FROM pedidos WHERE id_pedido = ?", [id]);

    await conn.commit();
    res.json({ message: "Pedido eliminado correctamente y stock restaurado." });
  } catch (err) {
    await conn.rollback();
    console.error(err);
    res.status(500).json({ error: "Error eliminando el pedido." });
  } finally {
    conn.release();
  }
});

module.exports = router;

