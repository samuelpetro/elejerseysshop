// routes/proveedores.js - CRUD Proveedores
const express = require("express");
const router = express.Router();
const db = require("../db");
const { verificarToken, soloAdmin } = require("../middleware/auth");

router.use(verificarToken, soloAdmin);

router.get("/", async (req, res) => {
  try {
    const [rows] = await db.query("SELECT * FROM proveedores ORDER BY nombre ASC");
    res.json(rows);
  } catch (err) { res.status(500).json({ error: "Error." }); }
});

router.get("/:id", async (req, res) => {
  try {
    const [rows] = await db.query("SELECT * FROM proveedores WHERE id_proveedor=?", [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: "No encontrado." });
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: "Error." }); }
});

router.post("/", async (req, res) => {
  try {
    const { nombre, contacto, telefono, email } = req.body;
    if (!nombre) return res.status(400).json({ error: "Nombre requerido." });
    const [r] = await db.query(
      "INSERT INTO proveedores (nombre, contacto, telefono, email) VALUES (?,?,?,?)",
      [nombre, contacto||null, telefono||null, email||null]
    );
    res.status(201).json({ message: "Proveedor creado.", id_proveedor: r.insertId });
  } catch (err) { res.status(500).json({ error: "Error." }); }
});

router.put("/:id", async (req, res) => {
  try {
    const { nombre, contacto, telefono, email } = req.body;
    await db.query(
      "UPDATE proveedores SET nombre=?, contacto=?, telefono=?, email=? WHERE id_proveedor=?",
      [nombre, contacto||null, telefono||null, email||null, req.params.id]
    );
    res.json({ message: "Actualizado." });
  } catch (err) { res.status(500).json({ error: "Error." }); }
});

router.delete("/:id", async (req, res) => {
  try {
    const [r] = await db.query("DELETE FROM proveedores WHERE id_proveedor=?", [req.params.id]);
    if (r.affectedRows === 0) return res.status(404).json({ error: "No encontrado." });
    res.json({ message: "Eliminado." });
  } catch (err) { res.status(500).json({ error: "Error." }); }
});

module.exports = router;
