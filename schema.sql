-- ============================================================
-- schema.sql - PROYECTO UNIFICADO (EleJeserys + Tienda Deportiva)
-- Base de datos: elejeserys_tienda_ponderado
-- Motor: MySQL con CHARACTER SET utf8mb4
-- ============================================================
-- USO: Ejecutar en MySQL Workbench (File > Open SQL Script > Ejecutar)
-- Usuarios: admin / 1234 | cliente@test.com / 1234 | vendedor / 1234
-- ============================================================

CREATE DATABASE IF NOT EXISTS elejeserys_tienda_ponderado
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE elejeserys_tienda_ponderado;

-- ============================================================
-- 1. USUARIOS (empleados y administradores)
-- Login: username + password (panel admin / POS)
-- ============================================================
CREATE TABLE IF NOT EXISTS usuarios (
  id_usuario INT AUTO_INCREMENT PRIMARY KEY,
  cedula VARCHAR(20) NULL UNIQUE,
  username VARCHAR(80) NULL UNIQUE,
  nombre VARCHAR(100) NULL,
  apellido VARCHAR(100) NULL,
  email VARCHAR(150) NULL UNIQUE,
  telefono VARCHAR(20),
  direccion TEXT,
  password VARCHAR(255) NOT NULL,
  rol ENUM('cliente','admin','empleado') DEFAULT 'cliente',
  activo TINYINT(1) DEFAULT 1,
  creado_en DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================
-- 2. CLIENTES (registro web + punto de venta)
-- Login: email + password (tienda online)
-- ============================================================
CREATE TABLE IF NOT EXISTS clientes (
  id_cliente INT AUTO_INCREMENT PRIMARY KEY,
  cedula VARCHAR(20) NULL,
  nombre VARCHAR(100),
  apellido VARCHAR(100),
  telefono VARCHAR(20),
  email VARCHAR(150),
  direccion TEXT,
  password VARCHAR(255) NOT NULL DEFAULT '',
  creado_en DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================
-- 3. CATEGORÍAS (jerarquía: parent_id)
-- Balones → Nike, Adidas, Puma, Otras marcas
-- Camisetas → Selección Colombia, Real Madrid, Barcelona, etc.
-- ============================================================
CREATE TABLE IF NOT EXISTS categorias (
  id_categoria INT AUTO_INCREMENT PRIMARY KEY,
  nombre VARCHAR(100) NOT NULL,
  slug VARCHAR(100) NULL UNIQUE,
  descripcion TEXT,
  imagen VARCHAR(255),
  parent_id INT NULL,
  activo TINYINT(1) DEFAULT 1,
  FOREIGN KEY (parent_id) REFERENCES categorias(id_categoria)
);

-- ============================================================
-- 4. PRODUCTOS
-- precio: precio de venta | precio_player: versión premium
-- precio_compra: costo de compra | stock: unidades disponibles
-- ============================================================
CREATE TABLE IF NOT EXISTS productos (
  id_producto INT AUTO_INCREMENT PRIMARY KEY,
  nombre VARCHAR(200) NOT NULL,
  descripcion TEXT,
  precio DECIMAL(10,2) NOT NULL,
  precio_player DECIMAL(10,2),
  precio_compra DECIMAL(10,2),
  stock INT NOT NULL DEFAULT 0,
  id_categoria INT NULL,
  imagen VARCHAR(255),
  activo TINYINT(1) DEFAULT 1,
  destacado TINYINT(1) DEFAULT 0,
  creado_en DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (id_categoria) REFERENCES categorias(id_categoria)
);

-- ============================================================
-- 5. INVENTARIO (control de stock por talla y versión)
-- Usado por EleJeserys para camisetas Fan/Player
-- ============================================================
CREATE TABLE IF NOT EXISTS inventario (
  id_inventario INT AUTO_INCREMENT PRIMARY KEY,
  id_producto INT NOT NULL,
  talla ENUM('S','M','L','XL','XXL') NOT NULL,
  version ENUM('Fan','Player') NOT NULL,
  stock INT NOT NULL DEFAULT 0,
  UNIQUE KEY uq_prod_talla_ver (id_producto, talla, version),
  FOREIGN KEY (id_producto) REFERENCES productos(id_producto) ON DELETE CASCADE
);

-- ============================================================
-- 6. MOVIMIENTOS (Kardex por PROMEDIO PONDERADO)
-- Registra cada entrada/salida de inventario con costo promedio.
-- ENTRADA: recalcula costo_promedio
-- SALIDA:  usa el costo_promedio vigente (no cambia)
-- ============================================================
CREATE TABLE IF NOT EXISTS movimientos (
  id_movimiento INT AUTO_INCREMENT PRIMARY KEY,
  origen ENUM('tienda_deportiva','elejeserys') NOT NULL,
  tipo ENUM('entrada','salida') NOT NULL,
  id_producto INT NOT NULL,
  talla ENUM('S','M','L','XL','XXL') NULL,
  version ENUM('Fan','Player') NULL,
  id_referencia INT NULL,
  referencia VARCHAR(80) NULL,
  cantidad INT NOT NULL,
  costo_unitario DECIMAL(12,2) NOT NULL DEFAULT 0,
  costo_total DECIMAL(12,2) NOT NULL DEFAULT 0,
  saldo_cantidad INT NOT NULL DEFAULT 0,
  saldo_costo_total DECIMAL(12,2) NOT NULL DEFAULT 0,
  costo_promedio DECIMAL(12,2) NOT NULL DEFAULT 0,
  creado_en DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (id_producto) REFERENCES productos(id_producto)
);

-- ============================================================
-- 7. VENTAS (Punto de Venta POS)
-- ============================================================
CREATE TABLE IF NOT EXISTS ventas (
  id_venta INT AUTO_INCREMENT PRIMARY KEY,
  id_cliente INT NULL,
  codigo_ticket VARCHAR(50) NULL UNIQUE,
  fecha DATETIME DEFAULT CURRENT_TIMESTAMP,
  total DECIMAL(10,2) NOT NULL DEFAULT 0,
  FOREIGN KEY (id_cliente) REFERENCES clientes(id_cliente)
);

CREATE TABLE IF NOT EXISTS detalle_ventas (
  id_detalle INT AUTO_INCREMENT PRIMARY KEY,
  id_venta INT NOT NULL,
  id_producto INT NOT NULL,
  cantidad INT NOT NULL,
  precio_unitario DECIMAL(10,2) NOT NULL,
  subtotal DECIMAL(10,2) NOT NULL,
  FOREIGN KEY (id_venta) REFERENCES ventas(id_venta),
  FOREIGN KEY (id_producto) REFERENCES productos(id_producto)
);

-- ============================================================
-- 8. PEDIDOS (Tienda Online EleJeserys)
-- Stock se descuenta al APROBAR, no al crear.
-- ============================================================
CREATE TABLE IF NOT EXISTS pedidos (
  id_pedido INT AUTO_INCREMENT PRIMARY KEY,
  id_usuario INT NOT NULL,
  total DECIMAL(10,2) NOT NULL,
  estado ENUM('pendiente','confirmado','enviado','entregado','cancelado') DEFAULT 'pendiente',
  direccion TEXT,
  notas TEXT,
  creado_en DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS detalle_pedidos (
  id_detalle INT AUTO_INCREMENT PRIMARY KEY,
  id_pedido INT NOT NULL,
  id_producto INT NOT NULL,
  talla ENUM('S','M','L','XL','XXL') NULL,
  version ENUM('Fan','Player') NULL,
  cantidad INT NOT NULL,
  precio_unitario DECIMAL(10,2) NOT NULL,
  subtotal DECIMAL(10,2) NOT NULL,
  FOREIGN KEY (id_pedido) REFERENCES pedidos(id_pedido),
  FOREIGN KEY (id_producto) REFERENCES productos(id_producto)
);

-- ============================================================
-- 9. DEVOLUCIONES
-- Soporta devoluciones de Tienda (POS) y Web (Pedidos).
-- ============================================================
CREATE TABLE IF NOT EXISTS devoluciones (
  id_devolucion INT AUTO_INCREMENT PRIMARY KEY,
  id_venta INT NOT NULL, -- ID de Venta o Pedido
  tipo ENUM('POS', 'WEB') DEFAULT 'POS',
  fecha DATETIME DEFAULT CURRENT_TIMESTAMP,
  motivo VARCHAR(255) NOT NULL,
  estado ENUM('PENDIENTE', 'APROBADA', 'RECHAZADA') DEFAULT 'PENDIENTE',
  volver_a_stock TINYINT(1) DEFAULT 1
);

CREATE TABLE IF NOT EXISTS detalle_devoluciones (
  id_detalle INT AUTO_INCREMENT PRIMARY KEY,
  id_devolucion INT NOT NULL,
  id_producto INT NOT NULL,
  cantidad INT NOT NULL,
  monto_reembolsado DECIMAL(10,2) NOT NULL,
  talla VARCHAR(10) DEFAULT NULL,
  version VARCHAR(20) DEFAULT NULL,
  FOREIGN KEY (id_devolucion) REFERENCES devoluciones(id_devolucion),
  FOREIGN KEY (id_producto) REFERENCES productos(id_producto)
);

-- ============================================================
-- DATOS INICIALES
-- Contraseñas hasheadas con bcrypt (texto plano: "1234")
-- ============================================================

-- Usuarios del sistema
INSERT INTO usuarios (cedula, username, nombre, apellido, email, password, rol) VALUES
('1000000001', 'admin', 'Admin', 'General', 'admin@elejeserys.com',
 '$2a$10$zLgp6CyfbUINLFtZ6TYLGeK8GUNrjjmDXPVAXhQoza.Yr9a79Rx0e', 'admin'),
('1000000003', 'vendedor', 'Vendedor', 'POS', NULL,
 '$2a$10$YODC0mjaM6oGkusl/D73/udIYruRvEaqHLnLzOf7P20RG8MEk716O', 'empleado')
ON DUPLICATE KEY UPDATE username = VALUES(username);

-- Cliente web de prueba
INSERT INTO clientes (cedula, nombre, apellido, email, password) VALUES
('1000000002', 'Cliente', 'Prueba', 'cliente@test.com',
 '$2a$10$x3snStbmfNawRPmwF5zvmuSstOmdvoEBfUMmio7Y80bjZYFGG174W')
ON DUPLICATE KEY UPDATE nombre = VALUES(nombre);

-- Categorías (orden: padres primero, luego hijos)
INSERT INTO categorias (nombre, slug, descripcion, parent_id) VALUES
('Balones', 'balones', 'Balones y articulos deportivos', NULL),
('Nike', 'nike', 'Balones marca Nike', 1),
('Adidas', 'adidas', 'Balones marca Adidas', 1),
('Puma', 'puma', 'Balones marca Puma', 1),
('Otras marcas', 'otras-marcas', 'Otras marcas de balones', 1),
('Camisetas', 'camisetas', 'Camisetas y jerseys deportivos', NULL),
('Selección Colombia', 'colombia', 'Camisas Selección Colombia', 6),
('Real Madrid', 'real-madrid', 'Camisas Real Madrid CF', 6),
('FC Barcelona', 'barcelona', 'Camisas FC Barcelona', 6),
('Manchester City', 'man-city', 'Camisas Manchester City', 6),
('Bayern Munich', 'bayern', 'Camisas Bayern München', 6),
('Atlético Nacional', 'nacional', 'Camisas Atlético Nacional', 6),
('Otros equipos', 'otros-equipos', 'Camisas de otros equipos', 6)
ON DUPLICATE KEY UPDATE nombre = VALUES(nombre);

-- Productos de ejemplo
-- Categorías: 1=Balones, 7=Selección Colombia, 8=Real Madrid
INSERT INTO productos (nombre, descripcion, precio, precio_player, precio_compra, stock, id_categoria, destacado) VALUES
('Balón de futbol profesional', 'Balón para entrenamiento y competencia.', 85000, NULL, 59500, 10, 1, 0),
('Camisa Colombia Local 2024', 'Camisa local temporada 2024.', 120000, 220000, 84000, 0, 7, 1),
('Camisa Real Madrid Local 2024', 'Camisa local temporada 2024/25.', 135000, 250000, 94500, 0, 8, 1);

-- Inventario inicial de camisetas
INSERT INTO inventario (id_producto, talla, version, stock) VALUES
(2,'S','Fan',5),(2,'M','Fan',8),(2,'L','Fan',6),(2,'XL','Fan',4),(2,'XXL','Fan',2),
(2,'S','Player',3),(2,'M','Player',5),(2,'L','Player',4),(2,'XL','Player',2),
(3,'S','Fan',6),(3,'M','Fan',9),(3,'L','Fan',7),(3,'XL','Fan',4),
(3,'S','Player',2),(3,'M','Player',4),(3,'L','Player',3)
ON DUPLICATE KEY UPDATE stock = VALUES(stock);

-- Movimientos iniciales de Kardex
INSERT INTO movimientos (origen, tipo, id_producto, referencia, cantidad, costo_unitario, costo_total, saldo_cantidad, saldo_costo_total, costo_promedio)
SELECT 'tienda_deportiva', 'entrada', p.id_producto, 'stock_inicial', p.stock, p.precio_compra, p.stock * p.precio_compra, p.stock, p.stock * p.precio_compra, p.precio_compra
FROM productos p WHERE p.stock > 0
  AND NOT EXISTS (SELECT 1 FROM movimientos m WHERE m.id_producto = p.id_producto AND m.referencia = 'stock_inicial' AND m.talla IS NULL AND m.version IS NULL);

INSERT INTO movimientos (origen, tipo, id_producto, talla, version, referencia, cantidad, costo_unitario, costo_total, saldo_cantidad, saldo_costo_total, costo_promedio)
SELECT 'elejeserys', 'entrada', i.id_producto, i.talla, i.version, 'stock_inicial', i.stock,
  CASE WHEN i.version = 'Player' THEN COALESCE(p.precio_player, p.precio) ELSE p.precio END,
  i.stock * CASE WHEN i.version = 'Player' THEN COALESCE(p.precio_player, p.precio) ELSE p.precio END,
  i.stock,
  i.stock * CASE WHEN i.version = 'Player' THEN COALESCE(p.precio_player, p.precio) ELSE p.precio END,
  CASE WHEN i.version = 'Player' THEN COALESCE(p.precio_player, p.precio) ELSE p.precio END
FROM inventario i JOIN productos p ON p.id_producto = i.id_producto WHERE i.stock > 0
  AND NOT EXISTS (SELECT 1 FROM movimientos m WHERE m.id_producto = i.id_producto AND m.referencia = 'stock_inicial' AND m.talla = i.talla AND m.version = i.version);

-- ============================================================
-- USUARIOS
--   admin / 1234         (admin - ambos sistemas)
--   vendedor / 1234       (empleado - solo POS)
--   cliente@test.com / 1234 (cliente - web)
-- ============================================================
