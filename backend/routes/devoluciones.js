const express = require("express");
const router = express.Router();
const db = require("../db");
const { verificarToken } = require("../middleware/auth");
const KardexPonderado = require("../services/kardex_ponderado");

router.use(verificarToken);

// GET /api/devoluciones
router.get("/", async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT d.id_devolucion, d.codigo_devolucion, d.id_venta, d.fecha, d.motivo, d.estado, d.tipo, d.volver_a_stock,
             CASE WHEN d.tipo = 'POS' THEN v.codigo_ticket ELSE CONCAT('Pedido #', d.id_venta) END as ticket_original,
             CASE 
               WHEN d.tipo = 'POS' THEN CONCAT(c_pos.nombre, ' ', c_pos.apellido)
               ELSE COALESCE(CONCAT(c_web.nombre, ' ', c_web.apellido), u_web.nombre)
             END as cliente_nombre,
             (SELECT SUM(monto_reembolsado) FROM detalle_devoluciones dd WHERE dd.id_devolucion = d.id_devolucion) as total_reembolsado
      FROM devoluciones d
      LEFT JOIN ventas v ON d.id_venta = v.id_venta AND d.tipo = 'POS'
      LEFT JOIN clientes c_pos ON v.id_cliente = c_pos.id_cliente
      LEFT JOIN pedidos p ON d.id_venta = p.id_pedido AND d.tipo = 'WEB'
      LEFT JOIN clientes c_web ON p.id_usuario = c_web.id_cliente
      LEFT JOIN usuarios u_web ON p.id_usuario = u_web.id_usuario
      ORDER BY d.fecha DESC
    `);
    
    // Traer los detalles de cada devolucion
    for (const dev of rows) {
      const [detalles] = await db.query(`
        SELECT dd.*, p.nombre as producto_nombre
        FROM detalle_devoluciones dd
        JOIN productos p ON dd.id_producto = p.id_producto
        WHERE dd.id_devolucion = ?
      `, [dev.id_devolucion]);
      dev.detalles = detalles;
    }

    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error obteniendo devoluciones." });
  }
});

// POST /api/devoluciones
router.post("/", async (req, res) => {
  const { id_venta, motivo, detalles, volver_a_stock = true, tipo = 'POS' } = req.body;
  if (!id_venta || !motivo || !detalles || !detalles.length) {
    return res.status(400).json({ error: "Faltan datos obligatorios." });
  }

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    // 1. Obtener información de la venta original para el ticket
    let codigo_ticket_base = id_venta;
    if (tipo === 'POS') {
      const [[v]] = await conn.query("SELECT codigo_ticket FROM ventas WHERE id_venta = ?", [id_venta]);
      if (v) codigo_ticket_base = v.codigo_ticket;
    }

    const prefix = tipo === 'POS' ? 'DEV-' : 'DEV-WEB-';
    const codigo_devolucion = `${prefix}${codigo_ticket_base}`;

    // 2. Validar cantidades para evitar devoluciones duplicadas o excesivas
    for (const item of detalles) {
      // Cantidad original comprada
      let queryOrig = tipo === 'POS' 
        ? "SELECT cantidad FROM detalle_ventas WHERE id_venta = ? AND id_producto = ?"
        : "SELECT cantidad FROM detalle_pedidos WHERE id_pedido = ? AND id_producto = ?";
      
      const [[orig]] = await conn.query(queryOrig, [id_venta, item.id_producto]);
      if (!orig) throw new Error(`El producto ${item.id_producto} no pertenece a esta venta.`);

      // Cantidad ya devuelta
      const [[devueltos]] = await conn.query(`
        SELECT COALESCE(SUM(dd.cantidad), 0) as total
        FROM detalle_devoluciones dd
        JOIN devoluciones d ON dd.id_devolucion = d.id_devolucion
        WHERE d.id_venta = ? AND dd.id_producto = ? AND d.estado != 'RECHAZADA' AND d.tipo = ?
      `, [id_venta, item.id_producto, tipo]);

      if (parseInt(devueltos.total) + parseInt(item.cantidad) > parseInt(orig.cantidad)) {
        throw new Error(`Cantidad excedida para el producto ${item.id_producto}. Ya se devolvieron ${devueltos.total} de ${orig.cantidad}.`);
      }
    }

    const [result] = await conn.query(
      "INSERT INTO devoluciones (codigo_devolucion, id_venta, motivo, estado, volver_a_stock, tipo) VALUES (?, ?, ?, 'PENDIENTE', ?, ?)",
      [codigo_devolucion, id_venta, motivo, volver_a_stock, tipo]
    );
    const id_devolucion = result.insertId;

    for (const item of detalles) {
      await conn.query(
        "INSERT INTO detalle_devoluciones (id_devolucion, id_producto, cantidad, monto_reembolsado, talla, version) VALUES (?, ?, ?, ?, ?, ?)",
        [id_devolucion, item.id_producto, item.cantidad, item.monto_reembolsado, item.talla || null, item.version || null]
      );
    }

    await conn.commit();
    res.status(201).json({ message: "Devolución registrada.", id_devolucion });
  } catch (err) {
    await conn.rollback();
    console.error(err);
    res.status(500).json({ error: "Error registrando la devolución." });
  } finally {
    conn.release();
  }
});

// PUT /api/devoluciones/:id/estado
router.put("/:id/estado", async (req, res) => {
  const { id } = req.params;
  const { estado } = req.body;
  if (!['APROBADA', 'RECHAZADA'].includes(estado)) {
    return res.status(400).json({ error: "Estado no válido." });
  }

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const [[devolucion]] = await conn.query("SELECT * FROM devoluciones WHERE id_devolucion = ?", [id]);
    if (!devolucion) throw new Error("Devolución no encontrada.");

    if (devolucion.estado !== 'PENDIENTE') {
      throw new Error("La devolución ya fue procesada.");
    }

    // Actualizamos el estado
    await conn.query("UPDATE devoluciones SET estado = ? WHERE id_devolucion = ?", [estado, id]);

    // Si se aprueba, procesar inventario y kardex
    if (estado === 'APROBADA') {
      const [detalles] = await conn.query("SELECT * FROM detalle_devoluciones WHERE id_devolucion = ?", [id]);
      
      for (const item of detalles) {
        const [[prod]] = await conn.query("SELECT precio_compra, nombre FROM productos WHERE id_producto = ?", [item.id_producto]);
        
        if (devolucion.volver_a_stock) {
          // 1. Regresar stock
          if (item.talla && item.version) {
            await conn.query("UPDATE inventario SET stock = stock + ? WHERE id_producto = ? AND talla = ? AND version = ?", 
              [item.cantidad, item.id_producto, item.talla, item.version]);
            // Recalcular stock global
            const [[tot]] = await conn.query("SELECT SUM(stock) as s FROM inventario WHERE id_producto=?", [item.id_producto]);
            await conn.query("UPDATE productos SET stock=? WHERE id_producto=?", [tot.s || 0, item.id_producto]);
          } else {
            await conn.query("UPDATE productos SET stock = stock + ? WHERE id_producto = ?", [item.cantidad, item.id_producto]);
          }

          // 2. Registrar ENTRADA en kardex
          await KardexPonderado.registrarMovimiento(conn, {
            id_producto: item.id_producto,
            tipo: "entrada",
            cantidad: item.cantidad,
            costo_unitario: prod.precio_compra,
            referencia: "devolucion_restock",
            id_referencia: id,
            talla: item.talla,
            version: item.version,
            origen: item.talla ? "elejeserys" : "tienda_deportiva"
          });
        } else {
          // Es una PÉRDIDA: No regresa al stock, pero registramos el movimiento para trazabilidad
          await KardexPonderado.registrarMovimiento(conn, {
            id_producto: item.id_producto,
            tipo: "salida", // Sigue siendo salida porque se perdió definitivamente
            cantidad: 0, // No altera cantidad pero queremos el log
            costo_unitario: prod.precio_compra,
            referencia: "devolucion_perdida",
            id_referencia: id,
            talla: item.talla,
            version: item.version,
            origen: item.talla ? "elejeserys" : "tienda_deportiva"
          });
        }
      }
    }

    await conn.commit();
    res.json({ message: "Estado de devolución actualizado exitosamente." });
  } catch (err) {
    await conn.rollback();
    console.error(err);
    res.status(500).json({ error: err.message || "Error procesando devolución." });
  } finally {
    conn.release();
  }
});

// DELETE /api/devoluciones/:id
router.delete("/:id", async (req, res) => {
  const { id } = req.params;
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const [[devolucion]] = await conn.query("SELECT * FROM devoluciones WHERE id_devolucion = ?", [id]);
    if (!devolucion) return res.status(404).json({ error: "Devolución no encontrada." });

    const diffMs = new Date() - new Date(devolucion.fecha);
    if (diffMs / (1000 * 60 * 60) > 24) {
      return res.status(400).json({ error: "No se puede eliminar después de 24 horas." });
    }

    // Si estaba aprobada, revertir efectos en stock
    if (devolucion.estado === 'APROBADA') {
      const [detalles] = await conn.query("SELECT * FROM detalle_devoluciones WHERE id_devolucion = ?", [id]);
      for (const item of detalles) {
        if (devolucion.volver_a_stock) {
          // Descontar lo que se había restockeado
          if (item.talla && item.version) {
            await conn.query("UPDATE inventario SET stock = stock - ? WHERE id_producto = ? AND talla = ? AND version = ?", 
              [item.cantidad, item.id_producto, item.talla, item.version]);
            const [[tot]] = await conn.query("SELECT SUM(stock) as s FROM inventario WHERE id_producto=?", [item.id_producto]);
            await conn.query("UPDATE productos SET stock=? WHERE id_producto=?", [tot.s || 0, item.id_producto]);
          } else {
            await conn.query("UPDATE productos SET stock = stock - ? WHERE id_producto = ?", [item.cantidad, item.id_producto]);
          }
        }
        // Borrar del kardex
        await conn.query("DELETE FROM movimientos WHERE id_referencia = ? AND referencia LIKE 'devolucion_%' AND id_producto = ?", [id, item.id_producto]);
      }
    }

    await conn.query("DELETE FROM detalle_devoluciones WHERE id_devolucion = ?", [id]);
    await conn.query("DELETE FROM devoluciones WHERE id_devolucion = ?", [id]);

    await conn.commit();
    res.json({ message: "Devolución eliminada correctamente." });
  } catch (err) {
    await conn.rollback();
    res.status(500).json({ error: err.message });
  } finally {
    conn.release();
  }
});

module.exports = router;
