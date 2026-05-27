// ============================================================
// routes/categorias.js
// ============================================================
const express = require("express");
const router = express.Router();
const db = require("../db");
const { verificarToken, soloAdmin } = require("../middleware/auth");

router.get("/", async (req, res) => {
  try {
    const [rows] = await db.query("SELECT * FROM categorias WHERE activo=1 ORDER BY nombre");
    res.json(rows);
  } catch (err) { res.status(500).json({ error: "Error." }); }
});

router.post("/", verificarToken, soloAdmin, async (req, res) => {
  const { nombre, slug, descripcion, parent_id, margen_porcentaje } = req.body;
  if (!nombre || !slug) return res.status(400).json({ error: "Nombre y slug requeridos." });
  try {
    const [r] = await db.query(
      "INSERT INTO categorias (nombre,slug,descripcion,parent_id,margen_porcentaje) VALUES (?,?,?,?,?)",
      [nombre,slug,descripcion,parent_id || null, margen_porcentaje || null]
    );
    res.status(201).json({ mensaje: "Categoría creada.", id: r.insertId });
  } catch (err) {
    console.error("[POST /categorias] Error:", err);
    if (err.code === "ER_DUP_ENTRY") return res.status(409).json({ error: "Slug ya existe." });
    res.status(500).json({ error: err.message || "Error." });
  }
});

router.put("/:id", verificarToken, soloAdmin, async (req, res) => {
  const { nombre, slug, descripcion, parent_id, activo, margen_porcentaje } = req.body;
  try {
    // Obtener margen actual para ver si cambió
    const [[actual]] = await db.query("SELECT margen_porcentaje FROM categorias WHERE id_categoria=?", [req.params.id]);
    
    await db.query("UPDATE categorias SET nombre=?,slug=?,descripcion=?,parent_id=?,activo=?,margen_porcentaje=? WHERE id_categoria=?",
      [nombre,slug,descripcion,parent_id || null,activo??1, margen_porcentaje ?? null, req.params.id]);
    
    // Si el margen cambió, actualizar productos que heredan de esta categoría
    if (actual && actual.margen_porcentaje != margen_porcentaje) {
      const marginVal = parseFloat(margen_porcentaje || 0);
      await db.query(`
        UPDATE productos 
        SET precio = ROUND((precio_compra * (1 + (? / 100))) / 100) * 100
        WHERE id_categoria = ? AND (margen_porcentaje IS NULL OR margen_porcentaje = '')
      `, [marginVal, req.params.id]);
    }

    res.json({ mensaje: "Categoría actualizada." });
  } catch (err) { 
    console.error("[PUT /categorias/:id] Error:", err);
    res.status(500).json({ error: err.message || "Error." }); 
  }
});

router.delete("/:id", verificarToken, soloAdmin, async (req, res) => {
  try {
    await db.query("DELETE FROM categorias WHERE id_categoria = ?", [req.params.id]);
    res.json({ mensaje: "Categoría eliminada." });
  } catch (err) {
    res.status(500).json({ error: "Error. La categoría puede tener productos asociados." });
  }
});

module.exports = router;
