// ============================================================
// Kardex por PROMEDIO PONDERADO
// ============================================================
//
// ¿CÓMO FUNCIONA EL PROMEDIO PONDERADO?
//   Cada ENTRADA de inventario recalcula el costo promedio:
//     nuevo_promedio = (costo_total_anterior + cantidad_entrante * costo_unitario)
//                     / (cantidad_anterior + cantidad_entrante)
//
//   Cada SALIDA de inventario usa el promedio VIGENTE (no cambia):
//     costo_salida = cantidad_saliente * costo_promedio_vigente
//     El costo_promedio se mantiene (no se recalcula en salidas)
//
// EJEMPLO PRÁCTICO:
//   1. Entrada 10u a $100,000 c/u → prom=$100,000, saldo=10u, costo_total=$1,000,000
//   2. Entrada  5u a $120,000 c/u → prom=$106,667, saldo=15u, costo_total=$1,600,000
//   3. Salida   3u                → prom=$106,667, saldo=12u, costo_total=$1,280,000
//
// COLUMNAS DE LA TABLA movimientos:
//   origen          → 'elejeserys' (camisetas) o 'tienda_deportiva' (POS)
//   tipo            → 'entrada' | 'salida'
//   id_producto     → Producto afectado (FK a productos)
//   talla           → Talla (S/M/L/XL/XXL) o NULL si es POS
//   version         → Versión (Fan/Player) o NULL si es POS
//   id_referencia   → ID del pedido/venta/ajuste que originó el movimiento
//   referencia      → Tipo: 'pedido' | 'venta' | 'ajuste_inventario' | 'stock_inicial'
//   cantidad        → Cantidad del movimiento (siempre positiva)
//   costo_unitario  → Costo por unidad en esta operación específica
//   costo_total     → Costo total de esta operación (cantidad × costo_unitario)
//   saldo_cantidad  → Cantidad ACUMULADA después del movimiento
//   saldo_costo_total → Costo total ACUMULADO después del movimiento
//   costo_promedio  → Promedio ponderado VIGENTE (saldo_costo_total / saldo_cantidad)
// ============================================================

class KardexPonderado {
  static async registrarMovimiento(conn, datos) {
    const {
      id_producto,
      tipo,
      cantidad,
      costo_unitario = null,
      origen = "elejeserys",
      referencia = null,
      id_referencia = null,
      talla = null,
      version = null,
    } = datos;

    const cantidadAbs = Math.abs(Number(cantidad));
    if (!id_producto || !tipo || !cantidadAbs) return null;

    const [[ultimo]] = await conn.query(
      `SELECT saldo_cantidad, saldo_costo_total, costo_promedio
       FROM movimientos
       WHERE id_producto = ?
         AND ((talla IS NULL AND ? IS NULL) OR talla = ?)
         AND ((version IS NULL AND ? IS NULL) OR version = ?)
       ORDER BY id_movimiento DESC
       LIMIT 1`,
      [id_producto, talla, talla, version, version]
    );

    const saldoAnterior = ultimo ? Number(ultimo.saldo_cantidad) : 0;
    const costoTotalAnterior = ultimo ? Number(ultimo.saldo_costo_total) : 0;
    const promedioAnterior = ultimo ? Number(ultimo.costo_promedio) : Number(costo_unitario || 0);

    let saldoCantidad = saldoAnterior;
    let saldoCostoTotal = costoTotalAnterior;
    let costoPromedio = promedioAnterior;
    let costoUnitarioMovimiento = Number(costo_unitario || promedioAnterior || 0);

    if (tipo === "entrada") {
      const costoEntrada = cantidadAbs * costoUnitarioMovimiento;
      saldoCantidad = saldoAnterior + cantidadAbs;
      saldoCostoTotal = costoTotalAnterior + costoEntrada;
      costoPromedio = saldoCantidad > 0 ? saldoCostoTotal / saldoCantidad : 0;
    } else {
      costoUnitarioMovimiento = promedioAnterior;
      saldoCantidad = Math.max(0, saldoAnterior - cantidadAbs);
      saldoCostoTotal = Math.max(0, costoTotalAnterior - (cantidadAbs * costoUnitarioMovimiento));
      costoPromedio = saldoCantidad > 0 ? saldoCostoTotal / saldoCantidad : 0;
    }

    const [result] = await conn.query(
      `INSERT INTO movimientos
       (origen, tipo, id_producto, talla, version, id_referencia, referencia,
        cantidad, costo_unitario, costo_total, saldo_cantidad, saldo_costo_total, costo_promedio)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        origen,
        tipo,
        id_producto,
        talla,
        version,
        id_referencia,
        referencia,
        cantidadAbs,
        costoUnitarioMovimiento,
        cantidadAbs * costoUnitarioMovimiento,
        saldoCantidad,
        saldoCostoTotal,
        costoPromedio,
      ]
    );

    return {
      id_movimiento: result.insertId,
      saldo_cantidad: saldoCantidad,
      saldo_costo_total: saldoCostoTotal,
      costo_promedio: costoPromedio,
    };
  }
}

module.exports = KardexPonderado;
