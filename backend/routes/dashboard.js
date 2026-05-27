// ============================================================
// routes/dashboard.js - Dashboard con periodos y reportes
// GET /api/dashboard/stats?periodo=diario|semanal|mensual
// GET /api/dashboard/reporte?periodo=diario|semanal|mensual -> HTML para PDF
// ============================================================
const express = require("express");
const router = express.Router();
const db = require("../db");
const { verificarToken } = require("../middleware/auth");
// Allow token in query string for PDF download (new tab can't set headers)
router.use((req, res, next) => {
  if (req.query.token && !req.headers.authorization) {
    req.headers.authorization = "Bearer " + req.query.token;
  }
  next();
});
router.use(verificarToken);

function getFechaRange(periodo, fInicio, fFin) {
  const offset = new Date().getTimezoneOffset() * 60000;
  const hoyStr = new Date(Date.now() - offset).toISOString().slice(0,10);
  
  if (fInicio && fFin) {
    let label = "Personalizado";
    if (fInicio === fFin) label = "Día: " + fInicio;
    return { inicio: fInicio, fin: fFin, label };
  }

  if (periodo === "semanal") {
    const ini = new Date(Date.now() - offset); ini.setDate(ini.getDate() - 6);
    return { inicio: ini.toISOString().slice(0,10), fin: hoyStr, label: "7 dias" };
  } else if (periodo === "mensual") {
    const ini = new Date(Date.now() - offset); ini.setDate(1);
    return { inicio: ini.toISOString().slice(0,10), fin: hoyStr, label: "Mes actual" };
  } else if (periodo === "anual") {
    const ini = new Date(Date.now() - offset); ini.setMonth(0, 1);
    return { inicio: ini.toISOString().slice(0,10), fin: hoyStr, label: "Año actual" };
  }
  return { inicio: hoyStr, fin: hoyStr, label: "Hoy" };
}

router.get("/stats", async (req, res) => {
  try {
    const { periodo = "diario", id_categoria, id_producto, fInicio, fFin } = req.query;
    const { inicio, fin } = getFechaRange(periodo, fInicio, fFin);

    let filterJoin = "";
    let filterWhere = "";
    const filterParams = [];
    let catIds = []; // accesible en todo el scope del handler

    if (id_categoria || id_producto) {
       filterJoin = " BUSCAR_POR_DETALLE "; 
       if (id_categoria) {
         const [hijos] = await db.query("SELECT id_categoria FROM categorias WHERE id_categoria=? OR parent_id=?", [id_categoria, id_categoria]);
         catIds = hijos.map(h => h.id_categoria);
         if (catIds.length > 0) {
           filterWhere += ` AND t.id_categoria IN (${catIds.map(()=>'?').join(',')}) `;
           filterParams.push(...catIds);
         } else {
           filterWhere += " AND t.id_categoria = ? ";
           filterParams.push(id_categoria);
           catIds = [Number(id_categoria)];
         }
       }
       if (id_producto) {
         filterWhere += " AND t.id_producto = ? ";
         filterParams.push(id_producto);
       }
    }

    let queryVentasTotal = `
      SELECT COUNT(DISTINCT transaction_id) AS total_ventas, COALESCE(SUM(total), 0) AS ingresos
      FROM (
        SELECT CONCAT('V', id_venta) AS transaction_id, total, fecha, NULL AS id_categoria, NULL AS id_producto FROM ventas
        UNION ALL
        SELECT CONCAT('P', id_pedido) AS transaction_id, total, creado_en AS fecha, NULL AS id_categoria, NULL AS id_producto FROM pedidos WHERE estado = 'confirmado'
      ) AS t
      WHERE DATE(t.fecha) BETWEEN ? AND ?
    `;

    if (filterJoin) {
      queryVentasTotal = `
        SELECT COUNT(DISTINCT transaction_id) AS total_ventas, COALESCE(SUM(subtotal), 0) AS ingresos
        FROM (
          SELECT CONCAT('V', v.id_venta) AS transaction_id, dv.subtotal, v.fecha, p.id_categoria, p.id_producto
          FROM ventas v
          JOIN detalle_ventas dv ON v.id_venta = dv.id_venta
          JOIN productos p ON dv.id_producto = p.id_producto
          UNION ALL
          SELECT CONCAT('P', pe.id_pedido) AS transaction_id, dp.subtotal, pe.creado_en AS fecha, pr.id_categoria, pr.id_producto
          FROM pedidos pe
          JOIN detalle_pedidos dp ON pe.id_pedido = dp.id_pedido
          JOIN productos pr ON dp.id_producto = pr.id_producto
          WHERE pe.estado = 'confirmado'
        ) AS t
        WHERE DATE(t.fecha) BETWEEN ? AND ? ${filterWhere}
      `;
    }
    const [[ventasTotal]] = await db.query(queryVentasTotal, [inicio, fin, ...filterParams]);

    const [[bajosStock]] = await db.query("SELECT COUNT(*) AS total FROM productos WHERE stock < 5");
    const [[totalClientes]] = await db.query("SELECT COUNT(*) AS total FROM clientes");
    const [[totalProductos]] = await db.query("SELECT COUNT(*) AS total FROM productos WHERE activo = 1");

    const [productosPorCategoria] = await db.query(`
      SELECT c.nombre AS categoria, COUNT(p.id_producto) AS total
      FROM productos p
      JOIN categorias c ON p.id_categoria = c.id_categoria
      WHERE p.activo = 1
      GROUP BY c.id_categoria, c.nombre
      ORDER BY total DESC
    `);

    // Costo de productos vendidos en el periodo
    let queryCosto = `
       SELECT COALESCE(SUM(cantidad * precio_compra), 0) AS costo_total
       FROM (
         SELECT dv.cantidad, COALESCE(p.precio_compra, 0) AS precio_compra, v.fecha, p.id_categoria, p.id_producto
         FROM detalle_ventas dv
         JOIN productos p ON dv.id_producto = p.id_producto
         JOIN ventas v ON dv.id_venta = v.id_venta
         UNION ALL
         SELECT dp.cantidad, COALESCE(pr.precio_compra, 0) AS precio_compra, pe.creado_en AS fecha, pr.id_categoria, pr.id_producto
         FROM detalle_pedidos dp
         JOIN productos pr ON dp.id_producto = pr.id_producto
         JOIN pedidos pe ON dp.id_pedido = pe.id_pedido
         WHERE pe.estado = 'confirmado'
       ) AS t
       WHERE DATE(t.fecha) BETWEEN ? AND ? ${filterWhere}
    `;
    const [[costoVentas]] = await db.query(queryCosto, [inicio, fin, ...filterParams]);

    // 4. Monto reembolsado por devoluciones aprobadas en el periodo
    let queryDevoluciones = `
      SELECT 
        COALESCE(SUM(dd.monto_reembolsado), 0) AS total_reembolsado,
        COUNT(DISTINCT d.id_devolucion) AS num_devoluciones,
        (
          SELECT COUNT(*) FROM (
            SELECT dev.id_venta, dev.tipo, SUM(det.monto_reembolsado) as total_dev
            FROM devoluciones dev
            JOIN detalle_devoluciones det ON dev.id_devolucion = det.id_devolucion
            WHERE dev.estado = 'APROBADA'
            GROUP BY dev.id_venta, dev.tipo
          ) as sub
          JOIN (
            SELECT id_venta, total, 'POS' as tipo FROM ventas
            UNION ALL
            SELECT id_pedido, total, 'WEB' as tipo FROM pedidos WHERE estado = 'confirmado'
          ) as tr ON sub.id_venta = tr.id_venta AND sub.tipo = tr.tipo
          WHERE sub.total_dev >= tr.total
        ) as num_devueltas_total
      FROM devoluciones d
      JOIN detalle_devoluciones dd ON d.id_devolucion = dd.id_devolucion
      JOIN productos p ON dd.id_producto = p.id_producto
      WHERE d.estado = 'APROBADA' AND DATE(d.fecha) BETWEEN ? AND ?
      ${filterWhere.replace(/t\./g, 'p.')}
    `;
    const [[devolucionesTotal]] = await db.query(queryDevoluciones, [inicio, fin, ...filterParams]);

    // 5. Costo de productos que regresaron al stock (credito al costo)
    // Usamos p.precio_compra para que coincida con el calculo del costo bruto y se anulen
    let queryCostoRestock = `
      SELECT COALESCE(SUM(dd.cantidad * p.precio_compra), 0) AS costo_recuperado
      FROM devoluciones d
      JOIN detalle_devoluciones dd ON d.id_devolucion = dd.id_devolucion
      JOIN productos p ON dd.id_producto = p.id_producto
      WHERE d.estado = 'APROBADA' 
        AND d.volver_a_stock = 1
        AND DATE(d.fecha) BETWEEN ? AND ?
      ${filterWhere.replace(/t\./g, 'p.')}
    `;
    const [[costoRestock]] = await db.query(queryCostoRestock, [inicio, fin, ...filterParams]);

    // 6. Stock Total de Unidades (no de productos distintos)
    let queryStockTotal = "SELECT COALESCE(SUM(stock), 0) AS total FROM productos WHERE activo = 1";
    let stockParams = [];
    if (id_categoria && catIds.length > 0) {
       queryStockTotal += ` AND id_categoria IN (${catIds.map(()=>'?').join(',')}) `;
       stockParams.push(...catIds);
    } else if (id_categoria) {
       queryStockTotal += " AND id_categoria = ? ";
       stockParams.push(id_categoria);
    }
    if (id_producto) {
       queryStockTotal += " AND id_producto = ? ";
       stockParams.push(id_producto);
    }
    const [[stockTotal]] = await db.query(queryStockTotal, stockParams);

    const ingresoBruto = parseFloat(ventasTotal.ingresos);
    const reembolso = parseFloat(devolucionesTotal.total_reembolsado);
    const ingreso = Math.round(ingresoBruto - reembolso);

    const costoBruto = parseFloat(costoVentas.costo_total);
    const recuperado = parseFloat(costoRestock.costo_recuperado);
    const costo = Math.round(costoBruto - recuperado);

    const utilidad = Math.round(ingreso - costo);

    // Ventas agrupadas
    let ventasAgrupadas = [];
    if (periodo !== "diario") {
      let qGroup = "t.fecha";
      if (periodo === "anual") qGroup = "DATE_FORMAT(t.fecha, '%Y-%m')";
      else qGroup = "DATE(t.fecha)";

      let queryAgrupado = `
        SELECT ${qGroup} AS dia, COUNT(DISTINCT transaction_id) AS ventas, COALESCE(SUM(total), 0) AS ingresos
        FROM (
          SELECT CONCAT('V', id_venta) AS transaction_id, total, fecha, NULL AS id_categoria, NULL AS id_producto FROM ventas
          UNION ALL
          SELECT CONCAT('P', id_pedido) AS transaction_id, total, creado_en AS fecha, NULL AS id_categoria, NULL AS id_producto FROM pedidos WHERE estado = 'confirmado'
        ) AS t
        WHERE DATE(t.fecha) BETWEEN ? AND ?
        GROUP BY dia ORDER BY dia
      `;
      if (filterJoin) {
         queryAgrupado = `
          SELECT ${qGroup} AS dia, COUNT(DISTINCT transaction_id) AS ventas, COALESCE(SUM(subtotal), 0) AS ingresos
          FROM (
            SELECT CONCAT('V', v.id_venta) AS transaction_id, dv.subtotal, v.fecha, p.id_categoria, p.id_producto
            FROM ventas v
            JOIN detalle_ventas dv ON v.id_venta = dv.id_venta
            JOIN productos p ON dv.id_producto = p.id_producto
            UNION ALL
            SELECT CONCAT('P', pe.id_pedido) AS transaction_id, dp.subtotal, pe.creado_en AS fecha, pr.id_categoria, pr.id_producto
            FROM pedidos pe
            JOIN detalle_pedidos dp ON pe.id_pedido = dp.id_pedido
            JOIN productos pr ON dp.id_producto = pr.id_producto
            WHERE pe.estado = 'confirmado'
          ) AS t
          WHERE DATE(t.fecha) BETWEEN ? AND ? ${filterWhere}
          GROUP BY dia ORDER BY dia
         `;
      }
      const [dias] = await db.query(queryAgrupado, [inicio, fin, ...filterParams]);
      ventasAgrupadas = dias;
    } else {
      let queryDetalle = `
        SELECT transaction_id AS id_venta, fecha, total, cliente
        FROM (
          SELECT CONCAT('V', v.id_venta) AS transaction_id, v.fecha, v.total, CONCAT(c.nombre, ' ', c.apellido) AS cliente, NULL AS id_categoria, NULL AS id_producto
          FROM ventas v LEFT JOIN clientes c ON v.id_cliente = c.id_cliente
          UNION ALL
          SELECT CONCAT('P', p.id_pedido) AS transaction_id, p.creado_en AS fecha, p.total, COALESCE(CONCAT(cu.nombre, ' ', cu.apellido), 'Cliente Web') AS cliente, NULL AS id_categoria, NULL AS id_producto
          FROM pedidos p LEFT JOIN usuarios cu ON p.id_usuario = cu.id_usuario
          WHERE p.estado = 'confirmado'
        ) AS t
        WHERE DATE(t.fecha) = ?
        ORDER BY t.fecha DESC
      `;
      if (filterJoin) {
         queryDetalle = `
          SELECT transaction_id AS id_venta, fecha, COALESCE(SUM(subtotal), 0) AS total, cliente
          FROM (
            SELECT CONCAT('V', v.id_venta) AS transaction_id, v.fecha, dv.subtotal, CONCAT(c.nombre, ' ', c.apellido) AS cliente, p.id_categoria, p.id_producto
            FROM ventas v
            JOIN detalle_ventas dv ON v.id_venta = dv.id_venta
            JOIN productos p ON dv.id_producto = p.id_producto
            LEFT JOIN clientes c ON v.id_cliente = c.id_cliente
            UNION ALL
            SELECT CONCAT('P', pe.id_pedido) AS transaction_id, pe.creado_en AS fecha, dp.subtotal, COALESCE(CONCAT(cu.nombre, ' ', cu.apellido), 'Cliente Web') AS cliente, pr.id_categoria, pr.id_producto
            FROM pedidos pe
            JOIN detalle_pedidos dp ON pe.id_pedido = dp.id_pedido
            JOIN productos pr ON dp.id_producto = pr.id_producto
            LEFT JOIN usuarios cu ON pe.id_usuario = cu.id_usuario
            WHERE pe.estado = 'confirmado'
          ) AS t
          WHERE DATE(t.fecha) = ? ${filterWhere}
          GROUP BY transaction_id, fecha, cliente ORDER BY t.fecha DESC
         `;
      }
      const [detalle] = await db.query(queryDetalle, [inicio, ...filterParams]);
      ventasAgrupadas = detalle;
    }

    res.json({
      periodo, inicio, fin,
      totalVentas: Math.max(0, parseInt(ventasTotal.total_ventas) - parseInt(devolucionesTotal.num_devueltas_total || 0)),
      ingresos: ingreso,
      costo: costo,
      utilidad: utilidad,
      productosBajoStock: bajosStock.total,
      stockTotalUnits: stockTotal.total,
      totalClientes: totalClientes.total,
      totalProductos: totalProductos.total,
      productosPorCategoria,
      ventas: ventasAgrupadas,
    });
  } catch (err) { console.error(err); res.status(500).json({ error: "Error." }); }
});

router.get("/reporte", async (req, res) => {
  try {
    const { periodo = "diario", id_categoria, id_producto, cat_nombre, prod_nombre, fInicio, fFin } = req.query;
    const { inicio, fin, label } = getFechaRange(periodo, fInicio, fFin);

    let filterJoin = "";
    let filterWhere = "";
    const filterParams = [];
    let titleContext = "";

    if (id_categoria || id_producto) {
       filterJoin = " JOIN detalle_ventas dv ON v.id_venta = dv.id_venta JOIN productos p ON dv.id_producto = p.id_producto ";
       if (id_categoria) { 
         const [hijos] = await db.query("SELECT id_categoria FROM categorias WHERE id_categoria=? OR parent_id=?", [id_categoria, id_categoria]);
         const ids = hijos.map(h => h.id_categoria);
         if (ids.length > 0) {
           filterWhere += ` AND p.id_categoria IN (${ids.map(()=>'?').join(',')}) `;
           filterParams.push(...ids);
         } else {
           filterWhere += " AND p.id_categoria = ? "; 
           filterParams.push(id_categoria); 
         }
         titleContext += " - Categoria: " + (cat_nombre||id_categoria); 
       }
       if (id_producto) { filterWhere += " AND p.id_producto = ? "; filterParams.push(id_producto); titleContext += " - Producto: " + (prod_nombre||id_producto); }
    }

    let queryVt = `
      SELECT COUNT(*) AS total, COALESCE(SUM(total), 0) AS ing
      FROM (
        SELECT id_venta, total, fecha FROM ventas
        UNION ALL
        SELECT id_pedido, total, creado_en FROM pedidos WHERE estado = 'confirmado'
      ) AS t
      WHERE DATE(t.fecha) BETWEEN ? AND ?
    `;

    if (filterJoin) {
      queryVt = `
        SELECT COUNT(DISTINCT transaction_id) AS total, COALESCE(SUM(subtotal), 0) AS ing
        FROM (
          SELECT CONCAT('V', v.id_venta) AS transaction_id, dv.subtotal, v.fecha, p.id_categoria, p.id_producto
          FROM ventas v
          JOIN detalle_ventas dv ON v.id_venta = dv.id_venta
          JOIN productos p ON dv.id_producto = p.id_producto
          UNION ALL
          SELECT CONCAT('P', pe.id_pedido) AS transaction_id, dp.subtotal, pe.creado_en AS fecha, pr.id_categoria, pr.id_producto
          FROM pedidos pe
          JOIN detalle_pedidos dp ON pe.id_pedido = dp.id_pedido
          JOIN productos pr ON dp.id_producto = pr.id_producto
          WHERE pe.estado = 'confirmado'
        ) AS t
        WHERE DATE(t.fecha) BETWEEN ? AND ? ${filterWhere}
      `;
    }
    const [[vt]] = await db.query(queryVt, [inicio, fin, ...filterParams]);

    const [[cost]] = await db.query(`
      SELECT COALESCE(SUM(cantidad * precio_compra), 0) AS c
      FROM (
        SELECT dv.cantidad, COALESCE(p.precio_compra, 0) AS precio_compra, v.fecha, p.id_categoria, p.id_producto
        FROM detalle_ventas dv
        JOIN productos p ON dv.id_producto = p.id_producto
        JOIN ventas v ON dv.id_venta = v.id_venta
        UNION ALL
        SELECT dp.cantidad, COALESCE(pr.precio_compra, 0) AS precio_compra, pe.creado_en AS fecha, pr.id_categoria, pr.id_producto
        FROM detalle_pedidos dp
        JOIN productos pr ON dp.id_producto = pr.id_producto
        JOIN pedidos pe ON dp.id_pedido = pe.id_pedido
        WHERE pe.estado = 'confirmado'
      ) AS t
      WHERE DATE(t.fecha) BETWEEN ? AND ? ${filterWhere}
    `, [inicio, fin, ...filterParams]);

    const [[devRep]] = await db.query(`
      SELECT 
        COALESCE(SUM(dd.monto_reembolsado), 0) AS reembolso,
        COALESCE(SUM(CASE WHEN d.volver_a_stock = 1 THEN dd.cantidad * p.precio_compra ELSE 0 END), 0) AS costo_recuperado,
        COUNT(DISTINCT d.id_devolucion) AS num_devoluciones,
        (
          SELECT COUNT(*) FROM (
            SELECT dev.id_venta, dev.tipo, SUM(det.monto_reembolsado) as total_dev
            FROM devoluciones dev
            JOIN detalle_devoluciones det ON dev.id_devolucion = det.id_devolucion
            WHERE dev.estado = 'APROBADA'
            GROUP BY dev.id_venta, dev.tipo
          ) as sub
          JOIN (
            SELECT id_venta, total, 'POS' as tipo FROM ventas
            UNION ALL
            SELECT id_pedido, total, 'WEB' as tipo FROM pedidos WHERE estado = 'confirmado'
          ) as tr ON sub.id_venta = tr.id_venta AND sub.tipo = tr.tipo
          WHERE sub.total_dev >= tr.total
        ) as num_devueltas_total
      FROM devoluciones d
      JOIN detalle_devoluciones dd ON d.id_devolucion = dd.id_devolucion
      JOIN productos p ON dd.id_producto = p.id_producto
      WHERE d.estado = 'APROBADA' AND DATE(d.fecha) BETWEEN ? AND ?
      ${filterWhere.replace(/t\./g, 'p.')}
    `, [inicio, fin, ...filterParams]);
    
    const ingresoFinal = Math.round(parseFloat(vt.ing) - parseFloat(devRep.reembolso));
    const costoFinal = Math.round(parseFloat(cost.c) - parseFloat(devRep.costo_recuperado));
    const utilidad = Math.round(ingresoFinal - costoFinal);

    let detalleHTML = "";
    if (periodo === "diario") {
      let q = `
        SELECT id_venta, fecha, total, cliente,
               (SELECT d.estado FROM devoluciones d WHERE d.id_venta = CAST(SUBSTRING(t.id_venta, 2) AS UNSIGNED) AND d.tipo = (CASE WHEN LEFT(t.id_venta, 1) = 'V' THEN 'POS' ELSE 'WEB' END) AND d.estado = 'APROBADA' LIMIT 1) as estado_dev
        FROM (
          SELECT CONCAT('V', v.id_venta) AS id_venta, v.fecha, v.total, CONCAT(c.nombre, ' ', c.apellido) AS cliente
          FROM ventas v LEFT JOIN clientes c ON v.id_cliente = c.id_cliente
          UNION ALL
          SELECT CONCAT('P', p.id_pedido) AS id_venta, p.creado_en AS fecha, p.total, COALESCE(CONCAT(cu.nombre, ' ', cu.apellido), 'Cliente Web') AS cliente
          FROM pedidos p LEFT JOIN usuarios cu ON p.id_usuario = cu.id_usuario
          WHERE p.estado = 'confirmado'
        ) AS t
        WHERE DATE(t.fecha) = ?
        ORDER BY t.fecha DESC
      `;
      if (filterJoin) {
        q = `
          SELECT id_venta, fecha, SUM(subtotal) AS total, cliente,
                 (SELECT d.estado FROM devoluciones d WHERE d.id_venta = CAST(SUBSTRING(t.id_venta, 2) AS UNSIGNED) AND d.tipo = (CASE WHEN LEFT(t.id_venta, 1) = 'V' THEN 'POS' ELSE 'WEB' END) AND d.estado = 'APROBADA' LIMIT 1) as estado_dev
          FROM (
            SELECT CONCAT('V', v.id_venta) AS id_venta, v.fecha, dv.subtotal, CONCAT(c.nombre, ' ', c.apellido) AS cliente, p.id_categoria, p.id_producto
            FROM ventas v
            JOIN detalle_ventas dv ON v.id_venta = dv.id_venta
            JOIN productos p ON dv.id_producto = p.id_producto
            LEFT JOIN clientes c ON v.id_cliente = c.id_cliente
            UNION ALL
            SELECT CONCAT('P', pe.id_pedido) AS id_venta, pe.creado_en AS fecha, dp.subtotal, COALESCE(CONCAT(cu.nombre, ' ', cu.apellido), 'Cliente Web') AS cliente, pr.id_categoria, pr.id_producto
            FROM pedidos pe
            JOIN detalle_pedidos dp ON pe.id_pedido = dp.id_pedido
            JOIN productos pr ON dp.id_producto = pr.id_producto
            LEFT JOIN usuarios cu ON pe.id_usuario = cu.id_usuario
            WHERE pe.estado = 'confirmado'
          ) AS t
          WHERE DATE(t.fecha) = ? ${filterWhere}
          GROUP BY id_venta, fecha, cliente ORDER BY t.fecha DESC
        `;
      }
      const [ventas] = await db.query(q, [inicio, ...filterParams]);
      
      // Obtener el total devuelto por cada venta para saber si es parcial o total
      const [devs] = await db.query(`
        SELECT id_venta, tipo, SUM(monto_reembolsado) as total_dev
        FROM devoluciones d
        JOIN detalle_devoluciones dd ON d.id_devolucion = dd.id_devolucion
        WHERE d.estado = 'APROBADA'
        GROUP BY id_venta, tipo
      `);
      const mapDevs = {};
      if (Array.isArray(devs)) devs.forEach(d => mapDevs[`${d.tipo}-${d.id_venta}`] = d.total_dev);
      else if (devs) mapDevs[`${devs.tipo}-${devs.id_venta}`] = devs.total_dev;

      detalleHTML = ventas.map(v => {
        const idNum = v.id_venta.substring(1);
        const tipoKey = v.id_venta.startsWith('V') ? 'POS' : 'WEB';
        const montoDev = mapDevs[`${tipoKey}-${idNum}`] || 0;
        const totalVenta = parseFloat(v.total);
        
        let badge = '<span style="color:#27ae60;font-size:10px">Correcta</span>';
        let rowStyle = '';
        if (montoDev > 0) {
          if (montoDev >= totalVenta) {
            badge = '<span style="color:#e74c3c;font-weight:bold;font-size:10px">Devuelta</span>';
            rowStyle = 'color:#999;text-decoration:line-through';
          } else {
            badge = '<span style="color:#f39c12;font-weight:bold;font-size:10px">Parcial</span>';
          }
        }
        return `<tr><td style="padding:8px 10px;border:1px solid #e0e0e0">${v.id_venta}</td><td style="padding:8px 10px;border:1px solid #e0e0e0">${new Date(v.fecha).toLocaleString('es-CO')}</td><td style="padding:8px 10px;border:1px solid #e0e0e0">${v.cliente||'--'}</td><td style="padding:8px 10px;border:1px solid #e0e0e0;text-align:center">${badge}</td><td style="padding:8px 10px;border:1px solid #e0e0e0;text-align:right;font-weight:bold;${rowStyle}">$${Math.round(totalVenta - montoDev).toLocaleString()}</td></tr>`;
      }).join("");
    } else {
      if (periodo === "anual") {
        qGroup = "DATE_FORMAT(t.fecha, '%Y-%m')";
        labelCol = "Mes";
      } else {
        qGroup = "DATE_FORMAT(t.fecha, '%Y-%m-%d')";
      }

      let q = `
        SELECT ${qGroup} AS dia, COUNT(DISTINCT transaction_id) AS ventas, COALESCE(SUM(t.total), 0) AS ingresos
        FROM (
          SELECT CONCAT('V', id_venta) AS transaction_id, total, fecha FROM ventas
          UNION ALL
          SELECT CONCAT('P', id_pedido) AS transaction_id, total, creado_en AS fecha FROM pedidos WHERE estado = 'confirmado'
        ) AS t
        WHERE DATE(t.fecha) BETWEEN ? AND ?
        GROUP BY dia ORDER BY dia
      `;
      if (filterJoin) {
        q = `
          SELECT ${qGroup} AS dia, COUNT(DISTINCT transaction_id) AS ventas, COALESCE(SUM(subtotal), 0) AS ingresos
          FROM (
            SELECT CONCAT('V', v.id_venta) AS transaction_id, dv.subtotal, v.fecha, p.id_categoria, p.id_producto
            FROM ventas v
            JOIN detalle_ventas dv ON v.id_venta = dv.id_venta
            JOIN productos p ON dv.id_producto = p.id_producto
            UNION ALL
            SELECT CONCAT('P', pe.id_pedido) AS transaction_id, dp.subtotal, pe.creado_en AS fecha, pr.id_categoria, pr.id_producto
            FROM pedidos pe
            JOIN detalle_pedidos dp ON pe.id_pedido = dp.id_pedido
            JOIN productos pr ON dp.id_producto = pr.id_producto
            WHERE pe.estado = 'confirmado'
          ) AS t
          WHERE DATE(t.fecha) BETWEEN ? AND ? ${filterWhere}
          GROUP BY dia ORDER BY dia
        `;
      }
      const [dias] = await db.query(q, [inicio, fin, ...filterParams]);
      detalleHTML = dias.map((d,i) => `<tr${i%2===0?' style="background:#f8f9fa"':''}><td style="padding:8px 10px;border:1px solid #e0e0e0">${d.dia}</td><td style="padding:8px 10px;border:1px solid #e0e0e0;text-align:center">${d.ventas}</td><td style="padding:8px 10px;border:1px solid #e0e0e0;text-align:right;font-weight:bold">$${Number(d.ingresos).toLocaleString()}</td></tr>`).join("");
    }

    const estiloUtilidad = utilidad >= 0 ? "color:#27ae60" : "color:#e74c3c";
    const signoUtilidad = utilidad >= 0 ? "+" : "";
    
    let periodoLabel = "Resumen de Ventas";
    if (periodo === "diario") periodoLabel = "Resumen Diario";
    else if (periodo === "semanal") periodoLabel = "Resumen Semanal";
    else if (periodo === "mensual") periodoLabel = "Resumen Mensual";
    else if (periodo === "anual") periodoLabel = "Resumen Anual";
    else if (label) periodoLabel = "Reporte " + label;

    const html = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<title>Reporte ${periodo} - Tienda Deportiva</title>
<style>
  @page { margin: 15mm 10mm; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Segoe UI', Arial, sans-serif; font-size: 12px; color: #333; line-height: 1.5; }
  .page { max-width: 1000px; margin: 0 auto; padding: 20px; }
  .header { background: linear-gradient(135deg, #2c3e50, #3498db); color: white; padding: 30px; border-radius: 12px 12px 0 0; text-align: center; }
  .header h1 { font-size: 24px; margin-bottom: 4px; }
  .header p { font-size: 13px; opacity: 0.9; }
  .header .date { font-size: 11px; opacity: 0.7; margin-top: 8px; }
  .cards { display: grid; grid-template-columns: repeat(4,1fr); gap: 10px; margin: 16px 0; }
  .card { background: white; border-radius: 10px; padding: 16px; text-align: center; box-shadow: 0 2px 8px rgba(0,0,0,0.08); border-top: 4px solid #3498db; }
  .card.ingresos { border-top-color: #2ecc71; }
  .card.costo { border-top-color: #e67e22; }
  .card.utilidad { border-top-color: ${utilidad>=0?'#27ae60':'#e74c3c'}; }
  .card .num { font-size: 22px; font-weight: 700; margin: 6px 0 2px; }
  .card .label { font-size: 11px; color: #888; text-transform: uppercase; letter-spacing: 1px; }
  .section-title { font-size: 14px; font-weight: 700; color: #2c3e50; margin: 20px 0 10px; padding-bottom: 6px; border-bottom: 2px solid #3498db; }
  table { width: 100%; border-collapse: collapse; }
  th { background: #2c3e50; color: white; padding: 10px; font-size: 11px; text-transform: uppercase; letter-spacing: 1px; text-align: left; }
  th:last-child { text-align: right; }
  td { padding: 8px 10px; border-bottom: 1px solid #e0e0e0; }
  tr:nth-child(even) { background: #f8f9fa; }
  .footer { text-align: center; font-size: 10px; color: #aaa; margin-top: 30px; padding-top: 15px; border-top: 1px solid #e0e0e0; }
  .badge { display:inline-block;padding:2px 8px;border-radius:4px;font-size:10px;background:#e8f4fd;color:#2980b9;margin-left:6px; }
  @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } .card { break-inside: avoid; } }
</style>
<script src="https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js"></script>
<script>
  window.onload = function() {
    const element = document.getElementById('reporte-content');
    html2pdf().set({
      margin: 10,
      filename: 'reporte_ventas_${periodo}.pdf',
      image: { type: 'jpeg', quality: 0.98 },
      html2canvas: { scale: 2 },
      jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
    }).from(element).save();
  };
</script>
</head>
<body>
<div class="page" id="reporte-content">
  <div class="header">
    <h1>⚡ Reporte de Ventas</h1>
    <p>Tienda Deportiva - ${periodoLabel}${titleContext}</p>
    <div class="date">Periodo: ${inicio} a ${fin} &nbsp;|&nbsp; Generado: ${new Date().toLocaleString('es-CO')}</div>
  </div>

  <div class="cards">
    <div class="card">
      <div class="label">Ventas Netas</div>
      <div class="num">${Math.max(0, parseInt(vt.total) - (parseInt(devRep.num_devueltas_total) || 0))}</div>
    </div>
    <div class="card ingresos">
      <div class="label">Ingresos Netos</div>
      <div class="num">$${Number(ingresoFinal).toLocaleString()}</div>
    </div>
    <div class="card costo">
      <div class="label">Costo</div>
      <div class="num">$${Number(costoFinal).toLocaleString()}</div>
    </div>
    <div class="card utilidad">
      <div class="label">Utilidad</div>
      <div class="num" style="${estiloUtilidad}">${signoUtilidad}$${Math.abs(utilidad).toLocaleString()}</div>
      <div style="font-size:10px;color:#999">${ingresoFinal>0?((utilidad/Number(ingresoFinal))*100).toFixed(1):'0'}% margen</div>
    </div>
  </div>

  <div class="section-title">${periodo==='diario'?'Ventas del dia ('+inicio+')':'Ventas por dia'}</div>
  <table>
    <thead>
      <tr>
        ${periodo==='diario'?'<th># Venta</th><th>Fecha</th><th>Cliente</th><th style="text-align:center">Estado</th><th style="text-align:right">Total</th>':'<th>Dia</th><th style="text-align:center">Ventas</th><th style="text-align:right">Ingresos</th>'}
      </tr>
    </thead>
    <tbody>
      ${detalleHTML || '<tr><td colspan="4" style="text-align:center;padding:20px;color:#999">No hay registros en este periodo.</td></tr>'}
    </tbody>
  </table>

  <div class="footer">
    Reporte generado automaticamente por el sistema Tienda Deportiva &copy; ${new Date().getFullYear()}
  </div>
</div>
</body>
</html>`;

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(html);
  } catch (err) { res.status(500).json({ error: "Error." }); }
});

router.get("/stats-compras", async (req, res) => {
  try {
    const { periodo = "diario", id_categoria, id_producto, fInicio, fFin } = req.query;
    const { inicio, fin } = getFechaRange(periodo, fInicio, fFin);

    let filterWhereMovimientos = "";
    let filterWhereDevoluciones = "";
    const filterParamsMovimientos = [];
    const filterParamsDevoluciones = [];
    let catIds = [];

    if (id_categoria) {
      const [hijos] = await db.query("SELECT id_categoria FROM categorias WHERE id_categoria=? OR parent_id=?", [id_categoria, id_categoria]);
      catIds = hijos.map(h => h.id_categoria);
      if (catIds.length > 0) {
        filterWhereMovimientos += ` AND p.id_categoria IN (${catIds.map(()=>'?').join(',')}) `;
        filterParamsMovimientos.push(...catIds);
        
        filterWhereDevoluciones += ` AND p.id_categoria IN (${catIds.map(()=>'?').join(',')}) `;
        filterParamsDevoluciones.push(...catIds);
      } else {
        filterWhereMovimientos += " AND p.id_categoria = ? ";
        filterParamsMovimientos.push(id_categoria);

        filterWhereDevoluciones += " AND p.id_categoria = ? ";
        filterParamsDevoluciones.push(id_categoria);
      }
    }

    if (id_producto) {
      filterWhereMovimientos += " AND m.id_producto = ? ";
      filterParamsMovimientos.push(id_producto);

      filterWhereDevoluciones += " AND dd.id_producto = ? ";
      filterParamsDevoluciones.push(id_producto);
    }

    // 1. Consulta KPI Compras
    const [[comprasKPI]] = await db.query(`
      SELECT 
        COALESCE(SUM(m.cantidad), 0) AS unidades_compradas,
        COALESCE(SUM(m.costo_total), 0) AS total_compras
      FROM movimientos m
      JOIN productos p ON m.id_producto = p.id_producto
      WHERE m.tipo = 'entrada' AND m.referencia != 'devolucion_restock'
        AND DATE(m.creado_en) BETWEEN ? AND ?
        ${filterWhereMovimientos}
    `, [inicio, fin, ...filterParamsMovimientos]);

    // 2. Consulta KPI Devoluciones
    const [[devolucionesKPI]] = await db.query(`
      SELECT 
        COALESCE(SUM(dd.monto_reembolsado), 0) AS total_reembolsado,
        COALESCE(SUM(dd.cantidad), 0) AS unidades_devueltas,
        COALESCE(SUM(CASE WHEN d.volver_a_stock = 0 THEN dd.cantidad * p.precio_compra ELSE 0 END), 0) AS costo_perdido
      FROM devoluciones d
      JOIN detalle_devoluciones dd ON d.id_devolucion = dd.id_devolucion
      JOIN productos p ON dd.id_producto = p.id_producto
      WHERE d.estado = 'APROBADA'
        AND DATE(d.fecha) BETWEEN ? AND ?
        ${filterWhereDevoluciones}
    `, [inicio, fin, ...filterParamsDevoluciones]);

    // 3. Consulta Detalle / Series temporales
    let comprasDetalle = [];
    let devolucionesDetalle = [];

    if (periodo === "diario") {
      // Listados detallados para compras y devoluciones del día
      const [compras] = await db.query(`
        SELECT m.id_referencia, m.creado_en AS fecha, p.nombre AS producto_nombre, m.talla, m.version, m.cantidad, m.costo_unitario, m.costo_total, m.referencia
        FROM movimientos m
        JOIN productos p ON m.id_producto = p.id_producto
        WHERE m.tipo = 'entrada' AND m.referencia != 'devolucion_restock'
          AND DATE(m.creado_en) = ?
          ${filterWhereMovimientos}
        ORDER BY m.creado_en DESC
      `, [inicio, ...filterParamsMovimientos]);
      comprasDetalle = compras;

      const [devoluciones] = await db.query(`
        SELECT d.id_devolucion, d.codigo_devolucion, d.fecha, d.motivo, d.volver_a_stock,
               COALESCE(SUM(dd.monto_reembolsado), 0) AS total_reembolsado,
               COALESCE(SUM(dd.cantidad), 0) AS total_cantidad
        FROM devoluciones d
        JOIN detalle_devoluciones dd ON d.id_devolucion = dd.id_devolucion
        JOIN productos p ON dd.id_producto = p.id_producto
        WHERE d.estado = 'APROBADA'
          AND DATE(d.fecha) = ?
          ${filterWhereDevoluciones}
        GROUP BY d.id_devolucion, d.codigo_devolucion, d.fecha, d.motivo, d.volver_a_stock
        ORDER BY d.fecha DESC
      `, [inicio, ...filterParamsDevoluciones]);
      devolucionesDetalle = devoluciones;
    } else {
      // Agrupación de series por fecha
      let qGroupMov = "m.creado_en";
      let qGroupDev = "d.fecha";
      if (periodo === "anual") {
        qGroupMov = "DATE_FORMAT(m.creado_en, '%Y-%m')";
        qGroupDev = "DATE_FORMAT(d.fecha, '%Y-%m')";
      } else {
        qGroupMov = "DATE(m.creado_en)";
        qGroupDev = "DATE(d.fecha)";
      }

      const [comprasSeries] = await db.query(`
        SELECT ${qGroupMov} AS dia, COALESCE(SUM(m.costo_total), 0) AS total_compras, COALESCE(SUM(m.cantidad), 0) AS unidades
        FROM movimientos m
        JOIN productos p ON m.id_producto = p.id_producto
        WHERE m.tipo = 'entrada' AND m.referencia != 'devolucion_restock'
          AND DATE(m.creado_en) BETWEEN ? AND ?
          ${filterWhereMovimientos}
        GROUP BY dia ORDER BY dia
      `, [inicio, fin, ...filterParamsMovimientos]);
      comprasDetalle = comprasSeries;

      const [devolucionesSeries] = await db.query(`
        SELECT ${qGroupDev} AS dia, COALESCE(SUM(dd.monto_reembolsado), 0) AS total_reembolsado, COALESCE(SUM(dd.cantidad), 0) AS unidades
        FROM devoluciones d
        JOIN detalle_devoluciones dd ON d.id_devolucion = dd.id_devolucion
        JOIN productos p ON dd.id_producto = p.id_producto
        WHERE d.estado = 'APROBADA'
          AND DATE(d.fecha) BETWEEN ? AND ?
          ${filterWhereDevoluciones}
        GROUP BY dia ORDER BY dia
      `, [inicio, fin, ...filterParamsDevoluciones]);
      devolucionesDetalle = devolucionesSeries;
    }

    res.json({
      periodo, inicio, fin,
      totalCompras: Math.round(comprasKPI.total_compras),
      unidadesCompradas: parseInt(comprasKPI.unidades_compradas),
      totalReembolsado: Math.round(devolucionesKPI.total_reembolsado),
      unidadesDevueltas: parseInt(devolucionesKPI.unidades_devueltas),
      costoPerdido: Math.round(devolucionesKPI.costo_perdido),
      compras: comprasDetalle,
      devoluciones: devolucionesDetalle
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error cargando estadísticas de compras." });
  }
});

router.get("/reporte-compras", async (req, res) => {
  try {
    const { periodo = "diario", id_categoria, id_producto, cat_nombre, prod_nombre, fInicio, fFin } = req.query;
    const { inicio, fin, label: periodoLabel } = getFechaRange(periodo, fInicio, fFin);

    let filterWhereMovimientos = "";
    let filterWhereDevoluciones = "";
    const filterParamsMovimientos = [];
    const filterParamsDevoluciones = [];
    let catIds = [];

    if (id_categoria) {
      const [hijos] = await db.query("SELECT id_categoria FROM categorias WHERE id_categoria=? OR parent_id=?", [id_categoria, id_categoria]);
      catIds = hijos.map(h => h.id_categoria);
      if (catIds.length > 0) {
        filterWhereMovimientos += ` AND p.id_categoria IN (${catIds.map(()=>'?').join(',')}) `;
        filterParamsMovimientos.push(...catIds);
        
        filterWhereDevoluciones += ` AND p.id_categoria IN (${catIds.map(()=>'?').join(',')}) `;
        filterParamsDevoluciones.push(...catIds);
      } else {
        filterWhereMovimientos += " AND p.id_categoria = ? ";
        filterParamsMovimientos.push(id_categoria);

        filterWhereDevoluciones += " AND p.id_categoria = ? ";
        filterParamsDevoluciones.push(id_categoria);
      }
    }

    if (id_producto) {
      filterWhereMovimientos += " AND m.id_producto = ? ";
      filterParamsMovimientos.push(id_producto);

      filterWhereDevoluciones += " AND dd.id_producto = ? ";
      filterParamsDevoluciones.push(id_producto);
    }

    // 1. KPI Compras
    const [[comprasKPI]] = await db.query(`
      SELECT 
        COALESCE(SUM(m.cantidad), 0) AS unidades_compradas,
        COALESCE(SUM(m.costo_total), 0) AS total_compras
      FROM movimientos m
      JOIN productos p ON m.id_producto = p.id_producto
      WHERE m.tipo = 'entrada' AND m.referencia != 'devolucion_restock'
        AND DATE(m.creado_en) BETWEEN ? AND ?
        ${filterWhereMovimientos}
    `, [inicio, fin, ...filterParamsMovimientos]);

    // 2. KPI Devoluciones
    const [[devolucionesKPI]] = await db.query(`
      SELECT 
        COALESCE(SUM(dd.monto_reembolsado), 0) AS total_reembolsado,
        COALESCE(SUM(dd.cantidad), 0) AS unidades_devueltas,
        COALESCE(SUM(CASE WHEN d.volver_a_stock = 0 THEN dd.cantidad * p.precio_compra ELSE 0 END), 0) AS costo_perdido
      FROM devoluciones d
      JOIN detalle_devoluciones dd ON d.id_devolucion = dd.id_devolucion
      JOIN productos p ON dd.id_producto = p.id_producto
      WHERE d.estado = 'APROBADA'
        AND DATE(d.fecha) BETWEEN ? AND ?
        ${filterWhereDevoluciones}
    `, [inicio, fin, ...filterParamsDevoluciones]);

    let titleContext = "";
    if (prod_nombre) titleContext += ` | Producto: ${prod_nombre}`;
    else if (cat_nombre) titleContext += ` | Categoría: ${cat_nombre}`;

    // Renderizado del detalle en HTML
    let tableRowsCompras = "";
    let tableRowsDevoluciones = "";

    if (periodo === "diario") {
      const [compras] = await db.query(`
        SELECT m.id_referencia, m.creado_en AS fecha, p.nombre AS producto_nombre, m.talla, m.version, m.cantidad, m.costo_unitario, m.costo_total, m.referencia
        FROM movimientos m
        JOIN productos p ON m.id_producto = p.id_producto
        WHERE m.tipo = 'entrada' AND m.referencia != 'devolucion_restock'
          AND DATE(m.creado_en) = ?
          ${filterWhereMovimientos}
        ORDER BY m.creado_en DESC
      `, [inicio, ...filterParamsMovimientos]);

      tableRowsCompras = compras.map(c => `
        <tr>
          <td>${c.referencia || '—'}</td>
          <td>${c.producto_nombre} ${c.talla ? `(${c.talla} | ${c.version})` : ''}</td>
          <td style="text-align:center">${c.cantidad}</td>
          <td style="text-align:right">$${Number(c.costo_unitario).toLocaleString()}</td>
          <td style="text-align:right">$${Number(c.costo_total).toLocaleString()}</td>
        </tr>
      `).join("") || '<tr><td colspan="5" style="text-align:center;color:#999">Sin compras registradas hoy.</td></tr>';

      const [devoluciones] = await db.query(`
        SELECT d.id_devolucion, d.codigo_devolucion, d.fecha, d.motivo, d.volver_a_stock,
               COALESCE(SUM(dd.monto_reembolsado), 0) AS total_reembolsado,
               COALESCE(SUM(dd.cantidad), 0) AS total_cantidad
        FROM devoluciones d
        JOIN detalle_devoluciones dd ON d.id_devolucion = dd.id_devolucion
        JOIN productos p ON dd.id_producto = p.id_producto
        WHERE d.estado = 'APROBADA'
          AND DATE(d.fecha) = ?
          ${filterWhereDevoluciones}
        GROUP BY d.id_devolucion, d.codigo_devolucion, d.fecha, d.motivo, d.volver_a_stock
        ORDER BY d.fecha DESC
      `, [inicio, ...filterParamsDevoluciones]);

      tableRowsDevoluciones = devoluciones.map(d => `
        <tr>
          <td>${d.codigo_devolucion}</td>
          <td>${d.motivo}</td>
          <td style="text-align:center">${d.volver_a_stock ? 'Sí' : 'No'}</td>
          <td style="text-align:center">${d.total_cantidad}</td>
          <td style="text-align:right">$${Number(d.total_reembolsado).toLocaleString()}</td>
        </tr>
      `).join("") || '<tr><td colspan="5" style="text-align:center;color:#999">Sin devoluciones hoy.</td></tr>';
    } else {
      let qGroupMov = "m.creado_en";
      let qGroupDev = "d.fecha";
      if (periodo === "anual") {
        qGroupMov = "DATE_FORMAT(m.creado_en, '%Y-%m')";
        qGroupDev = "DATE_FORMAT(d.fecha, '%Y-%m')";
      } else {
        qGroupMov = "DATE(m.creado_en)";
        qGroupDev = "DATE(d.fecha)";
      }

      const [comprasSeries] = await db.query(`
        SELECT ${qGroupMov} AS dia, COALESCE(SUM(m.costo_total), 0) AS total_compras, COALESCE(SUM(m.cantidad), 0) AS unidades
        FROM movimientos m
        JOIN productos p ON m.id_producto = p.id_producto
        WHERE m.tipo = 'entrada' AND m.referencia != 'devolucion_restock'
          AND DATE(m.creado_en) BETWEEN ? AND ?
          ${filterWhereMovimientos}
        GROUP BY dia ORDER BY dia
      `, [inicio, fin, ...filterParamsMovimientos]);

      tableRowsCompras = comprasSeries.map(c => `
        <tr>
          <td>${c.dia}</td>
          <td style="text-align:center">${c.unidades}</td>
          <td style="text-align:right">$${Number(c.total_compras).toLocaleString()}</td>
        </tr>
      `).join("") || '<tr><td colspan="3" style="text-align:center;color:#999">Sin compras en este periodo.</td></tr>';

      const [devolucionesSeries] = await db.query(`
        SELECT ${qGroupDev} AS dia, COALESCE(SUM(dd.monto_reembolsado), 0) AS total_reembolsado, COALESCE(SUM(dd.cantidad), 0) AS unidades
        FROM devoluciones d
        JOIN detalle_devoluciones dd ON d.id_devolucion = dd.id_devolucion
        JOIN productos p ON dd.id_producto = p.id_producto
        WHERE d.estado = 'APROBADA'
          AND DATE(d.fecha) BETWEEN ? AND ?
          ${filterWhereDevoluciones}
        GROUP BY dia ORDER BY dia
      `, [inicio, fin, ...filterParamsDevoluciones]);

      tableRowsDevoluciones = devolucionesSeries.map(d => `
        <tr>
          <td>${d.dia}</td>
          <td style="text-align:center">${d.unidades}</td>
          <td style="text-align:right">$${Number(d.total_reembolsado).toLocaleString()}</td>
        </tr>
      `).join("") || '<tr><td colspan="3" style="text-align:center;color:#999">Sin devoluciones en este periodo.</td></tr>';
    }

    const html = `
<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<title>Reporte de Compras y Devoluciones</title>
<style>
  body { font-family: 'Barlow', 'Helvetica Neue', Arial, sans-serif; background: #fff; color: #333; margin: 0; padding: 20px; font-size: 14px; }
  .page { max-width: 800px; margin: 0 auto; background: #fff; }
  .header { border-bottom: 2px solid #252830; padding-bottom: 12px; margin-bottom: 20px; }
  .header h1 { margin: 0 0 6px; font-size: 24px; font-weight: 700; color: #111; text-transform: uppercase; letter-spacing: 0.5px; }
  .header p { margin: 0; font-size: 13px; color: #666; }
  .header .date { font-size: 11px; color: #888; margin-top: 4px; }
  
  .cards { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 24px; }
  .card { border: 1px solid #ddd; border-radius: 8px; padding: 12px; background: #fafafa; }
  .card .label { font-size: 10px; text-transform: uppercase; letter-spacing: 1px; color: #777; margin-bottom: 4px; }
  .card .num { font-size: 20px; font-weight: 700; color: #222; }
  .card.compras { border-left: 4px solid #00d4ff; }
  .card.devoluciones { border-left: 4px solid #ff3b55; }
  .card.perdidas { border-left: 4px solid #ff9f00; }
  
  .section-title { font-size: 14px; font-weight: 700; text-transform: uppercase; color: #111; margin: 24px 0 10px; border-bottom: 1px solid #eee; padding-bottom: 4px; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 20px; font-size: 13px; }
  table th { background: #f0f2f5; padding: 8px 10px; font-weight: 600; text-align: left; border-bottom: 1px solid #ddd; font-size: 11px; text-transform: uppercase; color: #555; }
  table td { padding: 8px 10px; border-bottom: 1px solid #eee; }
  table tr:hover { background: #f9f9f9; }
  
  .footer { margin-top: 40px; border-top: 1px solid #eee; padding-top: 10px; font-size: 11px; color: #999; text-align: center; }
  @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } .card { break-inside: avoid; } }
</style>
<script src="https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js"></script>
<script>
  window.onload = function() {
    const element = document.getElementById('reporte-content');
    html2pdf().set({
      margin: 10,
      filename: 'reporte_compras_devoluciones_${periodo}.pdf',
      image: { type: 'jpeg', quality: 0.98 },
      html2canvas: { scale: 2 },
      jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
    }).from(element).save();
  };
</script>
</head>
<body>
<div class="page" id="reporte-content">
  <div class="header">
    <h1>📦 Reporte de Compras y Devoluciones</h1>
    <p>Tienda Deportiva - ${periodoLabel}${titleContext}</p>
    <div class="date">Periodo: ${inicio} a ${fin} &nbsp;|&nbsp; Generado: ${new Date().toLocaleString('es-CO')}</div>
  </div>

  <div class="cards">
    <div class="card compras">
      <div class="label">Inversión Compras</div>
      <div class="num">$${Number(comprasKPI.total_compras).toLocaleString()}</div>
    </div>
    <div class="card">
      <div class="label">Unidades Compradas</div>
      <div class="num">${comprasKPI.unidades_compradas}</div>
    </div>
    <div class="card devoluciones">
      <div class="label">Total Reembolsado</div>
      <div class="num">$${Number(devolucionesKPI.total_reembolsado).toLocaleString()}</div>
    </div>
    <div class="card perdidas">
      <div class="label">Costo Pérdidas</div>
      <div class="num">$${Number(devolucionesKPI.costo_perdido).toLocaleString()}</div>
    </div>
  </div>

  <div class="section-title">Detalle de Compras</div>
  <table>
    <thead>
      <tr>
        ${periodo==='diario'?'<th>Referencia</th><th>Producto</th><th style="text-align:center">Cant</th><th style="text-align:right">Costo Unit.</th><th style="text-align:right">Costo Total</th>':'<th>Dia</th><th style="text-align:center">Unidades</th><th style="text-align:right">Total Costo</th>'}
      </tr>
    </thead>
    <tbody>
      ${tableRowsCompras}
    </tbody>
  </table>

  <div class="section-title">Detalle de Devoluciones</div>
  <table>
    <thead>
      <tr>
        ${periodo==='diario'?'<th>Código Dev.</th><th>Motivo</th><th style="text-align:center">Restockeado</th><th style="text-align:center">Cant</th><th style="text-align:right">Monto Reembolsado</th>':'<th>Dia</th><th style="text-align:center">Unidades</th><th style="text-align:right">Total Reembolsado</th>'}
      </tr>
    </thead>
    <tbody>
      ${tableRowsDevoluciones}
    </tbody>
  </table>

  <div class="footer">
    Reporte generado automáticamente por el sistema Tienda Deportiva &copy; ${new Date().getFullYear()}
  </div>
</div>
</body>
</html>`;

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(html);
  } catch (err) {
    console.error(err);
    res.status(500).send("Error generando reporte");
  }
});

router.get("/reporte-general", async (req, res) => {
  try {
    const { periodo = "diario", id_categoria, id_producto, cat_nombre, prod_nombre, fInicio, fFin } = req.query;
    const { inicio, fin } = getFechaRange(periodo, fInicio, fFin);

    // --- FILTROS VENTAS ---
    let filterJoinVentas = "";
    let filterWhereVentas = "";
    const filterParamsVentas = [];
    let catIds = [];

    if (id_categoria || id_producto) {
       filterJoinVentas = " JOIN detalle_ventas dv ON v.id_venta = dv.id_venta JOIN productos p ON dv.id_producto = p.id_producto ";
       if (id_categoria) {
         const [hijos] = await db.query("SELECT id_categoria FROM categorias WHERE id_categoria=? OR parent_id=?", [id_categoria, id_categoria]);
         catIds = hijos.map(h => h.id_categoria);
         if (catIds.length > 0) {
           filterWhereVentas += ` AND p.id_categoria IN (${catIds.map(()=>'?').join(',')}) `;
           filterParamsVentas.push(...catIds);
         } else {
           filterWhereVentas += " AND p.id_categoria = ? ";
           filterParamsVentas.push(id_categoria);
           catIds = [Number(id_categoria)];
         }
       }
       if (id_producto) {
         filterWhereVentas += " AND p.id_producto = ? ";
         filterParamsVentas.push(id_producto);
       }
    }

    // --- FILTROS COMPRAS & DEVOLUCIONES (MOVIMIENTOS) ---
    let filterWhereMovimientos = "";
    let filterWhereDevoluciones = "";
    const filterParamsMovimientos = [];
    const filterParamsDevoluciones = [];

    if (id_categoria && catIds.length > 0) {
      filterWhereMovimientos += ` AND p.id_categoria IN (${catIds.map(()=>'?').join(',')}) `;
      filterParamsMovimientos.push(...catIds);
      
      filterWhereDevoluciones += ` AND p.id_categoria IN (${catIds.map(()=>'?').join(',')}) `;
      filterParamsDevoluciones.push(...catIds);
    } else if (id_categoria) {
      filterWhereMovimientos += " AND p.id_categoria = ? ";
      filterParamsMovimientos.push(id_categoria);

      filterWhereDevoluciones += " AND p.id_categoria = ? ";
      filterParamsDevoluciones.push(id_categoria);
    }

    if (id_producto) {
      filterWhereMovimientos += " AND m.id_producto = ? ";
      filterParamsMovimientos.push(id_producto);

      filterWhereDevoluciones += " AND dd.id_producto = ? ";
      filterParamsDevoluciones.push(id_producto);
    }

    // --- CONSULTA VENTAS KPI ---
    let queryVt = `
      SELECT COUNT(*) AS total, COALESCE(SUM(total), 0) AS ing
      FROM (
        SELECT id_venta, total, fecha FROM ventas
        UNION ALL
        SELECT id_pedido, total, creado_en FROM pedidos WHERE estado = 'confirmado'
      ) AS t
      WHERE DATE(t.fecha) BETWEEN ? AND ?
    `;

    if (filterJoinVentas) {
      queryVt = `
        SELECT COUNT(DISTINCT transaction_id) AS total, COALESCE(SUM(subtotal), 0) AS ing
        FROM (
          SELECT CONCAT('V', v.id_venta) AS transaction_id, dv.subtotal, v.fecha, p.id_categoria, p.id_producto
          FROM ventas v
          JOIN detalle_ventas dv ON v.id_venta = dv.id_venta
          JOIN productos p ON dv.id_producto = p.id_producto
          UNION ALL
          SELECT CONCAT('P', pe.id_pedido) AS transaction_id, dp.subtotal, pe.creado_en AS fecha, pr.id_categoria, pr.id_producto
          FROM pedidos pe
          JOIN detalle_pedidos dp ON pe.id_pedido = dp.id_pedido
          JOIN productos pr ON dp.id_producto = pr.id_producto
          WHERE pe.estado = 'confirmado'
        ) AS t
        WHERE DATE(t.fecha) BETWEEN ? AND ? ${filterWhereVentas}
      `;
    }
    const [[vt]] = await db.query(queryVt, [inicio, fin, ...filterParamsVentas]);

    const [[cost]] = await db.query(`
      SELECT COALESCE(SUM(cantidad * precio_compra), 0) AS c
      FROM (
        SELECT dv.cantidad, COALESCE(p.precio_compra, 0) AS precio_compra, v.fecha, p.id_categoria, p.id_producto
        FROM detalle_ventas dv
        JOIN productos p ON dv.id_producto = p.id_producto
        JOIN ventas v ON dv.id_venta = v.id_venta
        UNION ALL
        SELECT dp.cantidad, COALESCE(pr.precio_compra, 0) AS precio_compra, pe.creado_en AS fecha, pr.id_categoria, pr.id_producto
        FROM detalle_pedidos dp
        JOIN productos pr ON dp.id_producto = pr.id_producto
        JOIN pedidos pe ON dp.id_pedido = pe.id_pedido
        WHERE pe.estado = 'confirmado'
      ) AS t
      WHERE DATE(t.fecha) BETWEEN ? AND ? ${filterWhereVentas}
    `, [inicio, fin, ...filterParamsVentas]);

    const [[devRep]] = await db.query(`
      SELECT 
        COALESCE(SUM(dd.monto_reembolsado), 0) AS reembolso,
        COALESCE(SUM(CASE WHEN d.volver_a_stock = 1 THEN dd.cantidad * p.precio_compra ELSE 0 END), 0) AS costo_recuperado,
        COUNT(DISTINCT d.id_devolucion) AS num_devoluciones,
        (
          SELECT COUNT(*) FROM (
            SELECT dev.id_venta, dev.tipo, SUM(det.monto_reembolsado) as total_dev
            FROM devoluciones dev
            JOIN detalle_devoluciones det ON dev.id_devolucion = det.id_devolucion
            WHERE dev.estado = 'APROBADA'
            GROUP BY dev.id_venta, dev.tipo
          ) as sub
          JOIN (
            SELECT id_venta, total, 'POS' as tipo FROM ventas
            UNION ALL
            SELECT id_pedido, total, 'WEB' as tipo FROM pedidos WHERE estado = 'confirmado'
          ) as tr ON sub.id_venta = tr.id_venta AND sub.tipo = tr.tipo
          WHERE sub.total_dev >= tr.total
        ) as num_devueltas_total
      FROM devoluciones d
      JOIN detalle_devoluciones dd ON d.id_devolucion = dd.id_devolucion
      JOIN productos p ON dd.id_producto = p.id_producto
      WHERE d.estado = 'APROBADA' AND DATE(d.fecha) BETWEEN ? AND ?
      ${filterWhereVentas.replace(/p\./g, 'p.')}
    `, [inicio, fin, ...filterParamsVentas]);

    const ingresoFinal = Math.round(parseFloat(vt.ing) - parseFloat(devRep.reembolso));
    const costoFinal = Math.round(parseFloat(cost.c) - parseFloat(devRep.costo_recuperado));
    const utilidad = Math.round(ingresoFinal - costoFinal);

    // --- CONSULTA COMPRAS KPI ---
    const [[comprasKPI]] = await db.query(`
      SELECT 
        COALESCE(SUM(m.cantidad), 0) AS unidades_compradas,
        COALESCE(SUM(m.costo_total), 0) AS total_compras
      FROM movimientos m
      JOIN productos p ON m.id_producto = p.id_producto
      WHERE m.tipo = 'entrada' AND m.referencia != 'devolucion_restock'
        AND DATE(m.creado_en) BETWEEN ? AND ?
        ${filterWhereMovimientos}
    `, [inicio, fin, ...filterParamsMovimientos]);

    // --- CONSULTA DEVOLUCIONES KPI ---
    const [[devolucionesKPI]] = await db.query(`
      SELECT 
        COALESCE(SUM(dd.monto_reembolsado), 0) AS total_reembolsado,
        COALESCE(SUM(dd.cantidad), 0) AS unidades_devueltas,
        COALESCE(SUM(CASE WHEN d.volver_a_stock = 0 THEN dd.cantidad * p.precio_compra ELSE 0 END), 0) AS costo_perdido
      FROM devoluciones d
      JOIN detalle_devoluciones dd ON d.id_devolucion = dd.id_devolucion
      JOIN productos p ON dd.id_producto = p.id_producto
      WHERE d.estado = 'APROBADA'
        AND DATE(d.fecha) BETWEEN ? AND ?
        ${filterWhereDevoluciones}
    `, [inicio, fin, ...filterParamsDevoluciones]);

    // --- DETALLE DE VENTAS ---
    let detalleVentasHTML = "";
    if (periodo === "diario") {
      let q = `
        SELECT id_venta, fecha, total, cliente,
               (SELECT d.estado FROM devoluciones d WHERE d.id_venta = CAST(SUBSTRING(t.id_venta, 2) AS UNSIGNED) AND d.tipo = (CASE WHEN LEFT(t.id_venta, 1) = 'V' THEN 'POS' ELSE 'WEB' END) AND d.estado = 'APROBADA' LIMIT 1) as estado_dev
        FROM (
          SELECT CONCAT('V', v.id_venta) AS id_venta, v.fecha, v.total, CONCAT(c.nombre, ' ', c.apellido) AS cliente
          FROM ventas v LEFT JOIN clientes c ON v.id_cliente = c.id_cliente
          UNION ALL
          SELECT CONCAT('P', p.id_pedido) AS id_venta, p.creado_en AS fecha, p.total, COALESCE(CONCAT(cu.nombre, ' ', cu.apellido), 'Cliente Web') AS cliente
          FROM pedidos p LEFT JOIN usuarios cu ON p.id_usuario = cu.id_usuario
          WHERE p.estado = 'confirmado'
        ) AS t
        WHERE DATE(t.fecha) = ?
        ORDER BY t.fecha DESC
      `;
      if (filterJoinVentas) {
        q = `
          SELECT id_venta, fecha, SUM(subtotal) AS total, cliente,
                 (SELECT d.estado FROM devoluciones d WHERE d.id_venta = CAST(SUBSTRING(t.id_venta, 2) AS UNSIGNED) AND d.tipo = (CASE WHEN LEFT(t.id_venta, 1) = 'V' THEN 'POS' ELSE 'WEB' END) AND d.estado = 'APROBADA' LIMIT 1) as estado_dev
          FROM (
            SELECT CONCAT('V', v.id_venta) AS id_venta, v.fecha, dv.subtotal, CONCAT(c.nombre, ' ', c.apellido) AS cliente, p.id_categoria, p.id_producto
            FROM ventas v
            JOIN detalle_ventas dv ON v.id_venta = dv.id_venta
            JOIN productos p ON dv.id_producto = p.id_producto
            LEFT JOIN clientes c ON v.id_cliente = c.id_cliente
            UNION ALL
            SELECT CONCAT('P', pe.id_pedido) AS id_venta, pe.creado_en AS fecha, dp.subtotal, COALESCE(CONCAT(cu.nombre, ' ', cu.apellido), 'Cliente Web') AS cliente, pr.id_categoria, pr.id_producto
            FROM pedidos pe
            JOIN detalle_pedidos dp ON pe.id_pedido = dp.id_pedido
            JOIN productos pr ON dp.id_producto = pr.id_producto
            LEFT JOIN usuarios cu ON pe.id_usuario = cu.id_usuario
            WHERE pe.estado = 'confirmado'
          ) AS t
          WHERE DATE(t.fecha) = ? ${filterWhereVentas}
          GROUP BY id_venta, fecha, cliente ORDER BY t.fecha DESC
        `;
      }
      const [ventas] = await db.query(q, [inicio, ...filterParamsVentas]);
      
      const [devs] = await db.query(`
        SELECT id_venta, tipo, SUM(monto_reembolsado) as total_dev
        FROM devoluciones d
        JOIN detalle_devoluciones dd ON d.id_devolucion = dd.id_devolucion
        WHERE d.estado = 'APROBADA'
        GROUP BY id_venta, tipo
      `);
      const mapDevs = {};
      if (Array.isArray(devs)) devs.forEach(d => mapDevs[`${d.tipo}-${d.id_venta}`] = d.total_dev);
      else if (devs) mapDevs[`${devs.tipo}-${devs.id_venta}`] = devs.total_dev;

      detalleVentasHTML = ventas.map(v => {
        const idNum = v.id_venta.substring(1);
        const tipoKey = v.id_venta.startsWith('V') ? 'POS' : 'WEB';
        const montoDev = mapDevs[`${tipoKey}-${idNum}`] || 0;
        const totalVenta = parseFloat(v.total);
        
        let badge = '<span style="color:#27ae60;font-size:10px">Correcta</span>';
        let rowStyle = '';
        if (montoDev > 0) {
          if (montoDev >= totalVenta) {
            badge = '<span style="color:#e74c3c;font-weight:bold;font-size:10px">Devuelta</span>';
            rowStyle = 'color:#999;text-decoration:line-through';
          } else {
            badge = '<span style="color:#f39c12;font-weight:bold;font-size:10px">Parcial</span>';
          }
        }
        return `<tr><td style="padding:8px 10px;border:1px solid #e0e0e0">${v.id_venta}</td><td style="padding:8px 10px;border:1px solid #e0e0e0">${new Date(v.fecha).toLocaleString('es-CO')}</td><td style="padding:8px 10px;border:1px solid #e0e0e0">${v.cliente||'--'}</td><td style="padding:8px 10px;border:1px solid #e0e0e0;text-align:center">${badge}</td><td style="padding:8px 10px;border:1px solid #e0e0e0;text-align:right;font-weight:bold;${rowStyle}">$${Math.round(totalVenta - montoDev).toLocaleString()}</td></tr>`;
      }).join("");
    } else {
      let qGroup = "DATE_FORMAT(t.fecha, '%Y-%m-%d')";
      if (periodo === "anual") {
        qGroup = "DATE_FORMAT(t.fecha, '%Y-%m')";
      }

      let q = `
        SELECT ${qGroup} AS dia, COUNT(DISTINCT transaction_id) AS ventas, COALESCE(SUM(t.total), 0) AS ingresos
        FROM (
          SELECT CONCAT('V', id_venta) AS transaction_id, total, fecha FROM ventas
          UNION ALL
          SELECT CONCAT('P', id_pedido) AS transaction_id, total, creado_en AS fecha FROM pedidos WHERE estado = 'confirmado'
        ) AS t
        WHERE DATE(t.fecha) BETWEEN ? AND ?
        GROUP BY dia ORDER BY dia
      `;
      if (filterJoinVentas) {
        q = `
          SELECT ${qGroup} AS dia, COUNT(DISTINCT transaction_id) AS ventas, COALESCE(SUM(subtotal), 0) AS ingresos
          FROM (
            SELECT CONCAT('V', v.id_venta) AS transaction_id, dv.subtotal, v.fecha, p.id_categoria, p.id_producto
            FROM ventas v
            JOIN detalle_ventas dv ON v.id_venta = dv.id_venta
            JOIN productos p ON dv.id_producto = p.id_producto
            UNION ALL
            SELECT CONCAT('P', pe.id_pedido) AS transaction_id, dp.subtotal, pe.creado_en AS fecha, pr.id_categoria, pr.id_producto
            FROM pedidos pe
            JOIN detalle_pedidos dp ON pe.id_pedido = dp.id_pedido
            JOIN productos pr ON dp.id_producto = pr.id_producto
            WHERE pe.estado = 'confirmado'
          ) AS t
          WHERE DATE(t.fecha) BETWEEN ? AND ? ${filterWhereVentas}
          GROUP BY dia ORDER BY dia
        `;
      }
      const [dias] = await db.query(q, [inicio, fin, ...filterParamsVentas]);
      detalleVentasHTML = dias.map((d,i) => `<tr${i%2===0?' style="background:#f8f9fa"':''}><td style="padding:8px 10px;border:1px solid #e0e0e0">${d.dia}</td><td style="padding:8px 10px;border:1px solid #e0e0e0;text-align:center">${d.ventas}</td><td style="padding:8px 10px;border:1px solid #e0e0e0;text-align:right;font-weight:bold">$${Number(d.ingresos).toLocaleString()}</td></tr>`).join("");
    }

    // --- DETALLE DE COMPRAS ---
    let tableRowsCompras = "";
    const [compras] = await db.query(`
      SELECT m.id_movimiento, m.id_referencia, m.creado_en AS fecha, p.nombre AS producto_nombre,
             m.talla, m.version, m.cantidad, m.costo_unitario, m.costo_total, m.referencia
      FROM movimientos m
      JOIN productos p ON m.id_producto = p.id_producto
      WHERE m.tipo = 'entrada' AND m.referencia != 'devolucion_restock'
        AND DATE(m.creado_en) BETWEEN ? AND ?
        ${filterWhereMovimientos}
      ORDER BY m.creado_en DESC, m.id_movimiento DESC
    `, [inicio, fin, ...filterParamsMovimientos]);

    tableRowsCompras = compras.map(c => `
      <tr>
        <td style="padding:8px 10px;border:1px solid #e0e0e0">${new Date(c.fecha).toLocaleString('es-CO')}</td>
        <td style="padding:8px 10px;border:1px solid #e0e0e0">${c.referencia || c.id_referencia || '--'}</td>
        <td style="padding:8px 10px;border:1px solid #e0e0e0">${c.producto_nombre}</td>
        <td style="padding:8px 10px;border:1px solid #e0e0e0;text-align:center">${c.talla || '--'}</td>
        <td style="padding:8px 10px;border:1px solid #e0e0e0;text-align:center">${c.version || '--'}</td>
        <td style="padding:8px 10px;border:1px solid #e0e0e0;text-align:center">${c.cantidad}</td>
        <td style="padding:8px 10px;border:1px solid #e0e0e0;text-align:right">$${Number(c.costo_unitario).toLocaleString()}</td>
        <td style="padding:8px 10px;border:1px solid #e0e0e0;text-align:right;font-weight:bold">$${Number(c.costo_total).toLocaleString()}</td>
      </tr>
    `).join("") || '<tr><td colspan="8" style="text-align:center;padding:12px;color:#999">Sin compras registradas en este periodo.</td></tr>';

    // --- DETALLE DE DEVOLUCIONES ---
    let tableRowsDevoluciones = "";
    const [devoluciones] = await db.query(`
      SELECT d.id_devolucion, d.codigo_devolucion, d.id_venta, d.tipo, d.fecha, d.motivo,
             d.volver_a_stock, p.nombre AS producto_nombre, dd.talla, dd.version,
             dd.cantidad, dd.monto_reembolsado
      FROM devoluciones d
      JOIN detalle_devoluciones dd ON d.id_devolucion = dd.id_devolucion
      JOIN productos p ON dd.id_producto = p.id_producto
      WHERE d.estado = 'APROBADA'
        AND DATE(d.fecha) BETWEEN ? AND ?
        ${filterWhereDevoluciones}
      ORDER BY d.fecha DESC, d.id_devolucion DESC
    `, [inicio, fin, ...filterParamsDevoluciones]);

    tableRowsDevoluciones = devoluciones.map(d => `
      <tr>
        <td style="padding:8px 10px;border:1px solid #e0e0e0">${d.codigo_devolucion || d.id_devolucion}</td>
        <td style="padding:8px 10px;border:1px solid #e0e0e0">${new Date(d.fecha).toLocaleString('es-CO')}</td>
        <td style="padding:8px 10px;border:1px solid #e0e0e0;text-align:center">${d.tipo}-${d.id_venta}</td>
        <td style="padding:8px 10px;border:1px solid #e0e0e0">${d.producto_nombre}</td>
        <td style="padding:8px 10px;border:1px solid #e0e0e0;text-align:center">${d.talla || '--'}</td>
        <td style="padding:8px 10px;border:1px solid #e0e0e0;text-align:center">${d.version || '--'}</td>
        <td style="padding:8px 10px;border:1px solid #e0e0e0">${d.motivo}</td>
        <td style="padding:8px 10px;border:1px solid #e0e0e0;text-align:center">${d.volver_a_stock ? 'Sí' : 'No'}</td>
        <td style="padding:8px 10px;border:1px solid #e0e0e0;text-align:center">${d.cantidad}</td>
        <td style="padding:8px 10px;border:1px solid #e0e0e0;text-align:right;font-weight:bold">$${Number(d.monto_reembolsado).toLocaleString()}</td>
      </tr>
    `).join("") || '<tr><td colspan="10" style="text-align:center;padding:12px;color:#999">Sin devoluciones registradas en este periodo.</td></tr>';

    const estiloUtilidad = utilidad >= 0 ? "color:#27ae60" : "color:#e74c3c";
    const signoUtilidad = utilidad >= 0 ? "+" : "";
    
    let titleContext = "";
    if (prod_nombre) titleContext += ` | Producto: ${prod_nombre}`;
    else if (cat_nombre) titleContext += ` | Categoría: ${cat_nombre}`;

    const html = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<title>Reporte General - Tienda Deportiva</title>
<style>
  @page { size: A4 landscape; margin: 12mm 8mm; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Segoe UI', Arial, sans-serif; font-size: 10px; color: #333; line-height: 1.35; background: #fff; }
  .page { max-width: 1180px; margin: 0 auto; padding: 10px; }
  
  .header {
    background: linear-gradient(135deg, #1e293b, #0f172a);
    color: white;
    padding: 20px;
    border-radius: 8px;
    text-align: center;
    margin-bottom: 15px;
  }
  .header h1 { font-size: 20px; margin-bottom: 4px; text-transform: uppercase; letter-spacing: 1px; color: #e8ff00; }
  .header p { font-size: 12px; opacity: 0.9; }
  .header .date { font-size: 10px; opacity: 0.7; margin-top: 6px; }

  .section-title {
    font-size: 12px;
    font-weight: 700;
    text-transform: uppercase;
    color: #0f172a;
    margin: 15px 0 8px;
    padding-bottom: 4px;
    border-bottom: 2px solid #00d4ff;
    letter-spacing: 0.5px;
  }

  .kpi-container {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 8px;
    margin-bottom: 15px;
  }
  .kpi-card {
    background: #f8fafc;
    border: 1px solid #e2e8f0;
    border-radius: 6px;
    padding: 10px;
    text-align: center;
    border-top: 3px solid #64748b;
  }
  .kpi-card.ventas { border-top-color: #e8ff00; }
  .kpi-card.ingresos { border-top-color: #27ae60; }
  .kpi-card.compras { border-top-color: #00d4ff; }
  .kpi-card.devoluciones { border-top-color: #ef4444; }
  
  .kpi-card .kpi-label { font-size: 9px; text-transform: uppercase; color: #64748b; letter-spacing: 0.5px; font-weight: 600; }
  .kpi-card .kpi-val { font-size: 16px; font-weight: 700; color: #0f172a; margin-top: 4px; }
  
  table { width: 100%; border-collapse: collapse; margin-bottom: 15px; font-size: 9px; table-layout: auto; }
  th { background: #0f172a; color: white; padding: 5px 6px; text-align: left; font-weight: 600; text-transform: uppercase; font-size: 8px; }
  td { padding: 5px 6px; border: 1px solid #e2e8f0; vertical-align: top; }
  tr:nth-child(even) { background: #f8fafc; }
  
  .footer { text-align: center; font-size: 9px; color: #94a3b8; margin-top: 25px; padding-top: 10px; border-top: 1px solid #e2e8f0; }
</style>
<script src="https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js"></script>
<script>
  window.onload = function() {
    const element = document.getElementById('reporte-content');
    html2pdf().set({
      margin: 10,
      filename: 'reporte_general_${periodo}.pdf',
      image: { type: 'jpeg', quality: 0.98 },
      html2canvas: { scale: 2 },
      jsPDF: { unit: 'mm', format: 'a4', orientation: 'landscape' }
    }).from(element).save();
  };
</script>
</head>
<body>
<div class="page" id="reporte-content">
  <div class="header">
    <h1>📋 Reporte General de Gestión</h1>
    <p>Tienda Deportiva - Resumen Consolidado${titleContext}</p>
    <div class="date">Periodo: ${inicio} a ${fin} &nbsp;|&nbsp; Generado: ${new Date().toLocaleString('es-CO')}</div>
  </div>

  <!-- SECCIÓN KPI CONSOLIDADO -->
  <div class="section-title">Indicadores Clave de Rendimiento</div>
  <div class="kpi-container">
    <div class="kpi-card ventas">
      <div class="kpi-label">Ventas Netas</div>
      <div class="kpi-val">${Math.max(0, parseInt(vt.total) - (parseInt(devRep.num_devueltas_total) || 0))}</div>
    </div>
    <div class="kpi-card ingresos">
      <div class="kpi-label">Ingresos Netos</div>
      <div class="kpi-val">$${Number(ingresoFinal).toLocaleString()}</div>
    </div>
    <div class="kpi-card compras">
      <div class="kpi-label">Inversión en Compras</div>
      <div class="kpi-val">$${Number(comprasKPI.total_compras).toLocaleString()}</div>
    </div>
    <div class="kpi-card devoluciones">
      <div class="kpi-label">Reembolsos por Devolución</div>
      <div class="kpi-val">$${Number(devolucionesKPI.total_reembolsado).toLocaleString()}</div>
    </div>
  </div>
  <div class="kpi-container">
    <div class="kpi-card">
      <div class="kpi-label">Costo de Ventas</div>
      <div class="kpi-val">$${Number(costoFinal).toLocaleString()}</div>
    </div>
    <div class="kpi-card" style="border-top-color: ${utilidad>=0?'#27ae60':'#e74c3c'}">
      <div class="kpi-label">Utilidad Bruta</div>
      <div class="kpi-val" style="${estiloUtilidad}">${signoUtilidad}$${Math.abs(utilidad).toLocaleString()}</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-label">Unidades Compradas</div>
      <div class="kpi-val">${comprasKPI.unidades_compradas}</div>
    </div>
    <div class="kpi-card devoluciones">
      <div class="kpi-label">Costo de Pérdidas</div>
      <div class="kpi-val">$${Number(devolucionesKPI.costo_perdido).toLocaleString()}</div>
    </div>
  </div>

  <!-- SECCIÓN VENTAS -->
  <div class="section-title">Detalle de Ventas</div>
  <table>
    <thead>
      <tr>
        ${periodo==='diario'?'<th style="width:15%"># Venta</th><th style="width:25%">Fecha</th><th style="width:30%">Cliente</th><th style="width:15%;text-align:center">Estado</th><th style="width:15%;text-align:right">Total Neto</th>':'<th>Día</th><th style="text-align:center">Cantidad de Ventas</th><th style="text-align:right">Total de Ingresos</th>'}
      </tr>
    </thead>
    <tbody>
      ${detalleVentasHTML || `<tr><td colspan="${periodo==='diario'?5:3}" style="text-align:center;color:#999">No hay ventas en este periodo.</td></tr>`}
    </tbody>
  </table>

  <!-- SECCIÓN COMPRAS -->
  <div class="section-title">Detalle de Compras a Proveedor</div>
  <table>
    <thead>
      <tr>
        <th>Fecha</th>
        <th>Referencia</th>
        <th>Producto</th>
        <th style="text-align:center">Talla</th>
        <th style="text-align:center">Versión</th>
        <th style="text-align:center">Cantidad</th>
        <th style="text-align:right">Costo Unitario</th>
        <th style="text-align:right">Costo Total</th>
      </tr>
    </thead>
    <tbody>
      ${tableRowsCompras}
    </tbody>
  </table>

  <!-- SECCIÓN DEVOLUCIONES -->
  <div class="section-title">Detalle de Devoluciones</div>
  <table>
    <thead>
      <tr>
        <th>Código</th>
        <th>Fecha</th>
        <th>Venta</th>
        <th>Producto</th>
        <th style="text-align:center">Talla</th>
        <th style="text-align:center">Versión</th>
        <th>Motivo</th>
        <th style="text-align:center">Vuelve a Inventario</th>
        <th style="text-align:center">Cantidad</th>
        <th style="text-align:right">Reembolso</th>
      </tr>
    </thead>
    <tbody>
      ${tableRowsDevoluciones}
    </tbody>
  </table>

  <div class="footer">
    Reporte General generado automáticamente por el sistema Tienda Deportiva &copy; ${new Date().getFullYear()}
  </div>
</div>
</body>
</html>`;

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(html);
  } catch (err) {
    console.error(err);
    res.status(500).send("Error generando reporte general");
  }
});

module.exports = router;
