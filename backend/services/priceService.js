/**
 * Utilidades para el cálculo de precios automáticos
 */

/**
 * Calcula el precio de venta basado en el costo y el margen.
 * Redondea al múltiplo de 100 más cercano.
 * @param {number} precioCompra 
 * @param {number|null} margenProducto 
 * @param {number|null} margenCategoria 
 * @returns {number}
 */
function calcularPrecioVenta(precioCompra, margenProducto, margenCategoria) {
  const mP = (margenProducto !== null && margenProducto !== undefined && margenProducto !== '') ? parseFloat(margenProducto) : NaN;
  const mC = (margenCategoria !== null && margenCategoria !== undefined && margenCategoria !== '') ? parseFloat(margenCategoria) : 0;
  
  const margen = !isNaN(mP) ? mP : mC;
  
  const precioBruto = precioCompra * (1 + (margen / 100));
  
  // Redondear al múltiplo de 100 más cercano
  // Ejemplo: 1040 -> 1000, 1060 -> 1100
  return Math.round(precioBruto / 100) * 100;
}

module.exports = {
  calcularPrecioVenta
};
