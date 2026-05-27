-- migracion.sql - Solo si ya tienes la BD anterior y necesitas actualizarla
USE elejerseys_tienda_ponderado;

ALTER TABLE clientes ADD COLUMN activo TINYINT(1) DEFAULT 1 AFTER direccion;
ALTER TABLE clientes ADD UNIQUE INDEX uq_clientes_email (email);
ALTER TABLE clientes ADD UNIQUE INDEX uq_clientes_cedula (cedula);
ALTER TABLE devoluciones ADD INDEX idx_devoluciones_venta (id_venta);
UPDATE clientes SET activo = 1 WHERE activo IS NULL;
