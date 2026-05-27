// ============================================================
// routes/clientes.js - CRUD de clientes (POS + admin)
// GET    /api/clientes          -> Listar
// GET    /api/clientes/:id      -> Obtener uno
// POST   /api/clientes          -> Crear (password = cedula)
// PUT    /api/clientes/:id      -> Actualizar
// PUT    /api/clientes/:id/reset-password -> Reset a cedula
// DELETE /api/clientes/:id      -> Eliminar
// ============================================================
const express = require("express");
const router = express.Router();
const bcrypt = require("bcryptjs");
const db = require("../db");
const { verificarToken } = require("../middleware/auth");

router.use(verificarToken);

// GET /api/clientes - Listar todos
router.get("/", async (req, res) => {
  try {
    const [rows] = await db.query("SELECT * FROM clientes WHERE activo = 1 ORDER BY nombre ASC");
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: "Error obteniendo clientes." });
  }
});

// GET /api/clientes/:id
router.get("/:id", async (req, res) => {
  try {
    const [rows] = await db.query("SELECT * FROM clientes WHERE id_cliente = ?", [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: "Cliente no encontrado." });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: "Error obteniendo cliente." });
  }
});

// POST /api/clientes - Crear cliente
// Body: { cedula, nombre, apellido, telefono, email, direccion }
// Password = cedula (hash bcrypt)
router.post("/", async (req, res) => {
  const { cedula, nombre, apellido, telefono, email, direccion } = req.body;
  if (!cedula || !nombre || !apellido || !email) {
    return res.status(400).json({ error: "Cedula, nombre, apellido y correo son obligatorios." });
  }
  try {
    const [existe] = await db.query("SELECT id_cliente FROM clientes WHERE email = ?", [email]);
    if (existe.length) return res.status(409).json({ error: "Ya existe un cliente con ese correo." });

    const hash = await bcrypt.hash(cedula, 10);
    const [result] = await db.query(
      "INSERT INTO clientes (cedula, nombre, apellido, telefono, email, direccion, password) VALUES (?,?,?,?,?,?,?)",
      [cedula, nombre, apellido, telefono || null, email, direccion || null, hash]
    );
    res.status(201).json({ message: "Cliente creado. Contrasena: la cedula.", id_cliente: result.insertId });
  } catch (err) {
    res.status(500).json({ error: "Error creando cliente." });
  }
});

// PUT /api/clientes/:id - Actualizar cliente
router.put("/:id", async (req, res) => {
  const { cedula, nombre, apellido, telefono, email, direccion } = req.body;
  try {
    const [existeEmail] = await db.query("SELECT id_cliente FROM clientes WHERE email=? AND id_cliente!=?", [email, req.params.id]);
    if (existeEmail.length) return res.status(409).json({ error: "Ese correo ya pertenece a otro cliente." });

    await db.query(
      "UPDATE clientes SET cedula=?, nombre=?, apellido=?, telefono=?, email=?, direccion=? WHERE id_cliente=?",
      [cedula, nombre, apellido, telefono, email, direccion || null, req.params.id]
    );
    res.json({ message: "Cliente actualizado." });
  } catch (err) {
    res.status(500).json({ error: "Error actualizando cliente." });
  }
});

// PUT /api/clientes/:id/reset-password
router.put("/:id/reset-password", async (req, res) => {
  try {
    const [rows] = await db.query("SELECT cedula FROM clientes WHERE id_cliente=?", [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: "Cliente no encontrado." });
    if (!rows[0].cedula) return res.status(400).json({ error: "El cliente no tiene cedula registrada." });
    const hash = await bcrypt.hash(rows[0].cedula, 10);
    await db.query("UPDATE clientes SET password=? WHERE id_cliente=?", [hash, req.params.id]);
    res.json({ message: "Contrasena restablecida a la cedula." });
  } catch (err) {
    res.status(500).json({ error: "Error." });
  }
});

// DELETE /api/clientes/:id
router.delete("/:id", async (req, res) => {
  try {
    const [[{ total }]] = await db.query("SELECT COUNT(*) AS total FROM pedidos WHERE id_usuario = ? AND estado NOT IN ('entregado','cancelado')", [req.params.id]);
    if (total > 0) return res.status(409).json({ error: `El cliente tiene ${total} pedido(s) pendiente(s). Debe completarse la entrega antes de eliminar.` });
    const [r] = await db.query("UPDATE clientes SET activo = 0 WHERE id_cliente = ? AND activo = 1", [req.params.id]);
    if (r.affectedRows === 0) return res.status(404).json({ error: "Cliente no encontrado o ya inactivo." });
    res.json({ message: "Cliente desactivado. El historial de compras se conserva." });
  } catch (err) {
    res.status(500).json({ error: "Error eliminando cliente." });
  }
});

module.exports = router;
