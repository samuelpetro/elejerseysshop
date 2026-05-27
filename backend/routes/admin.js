// ============================================================
// routes/admin.js - Panel Admin EleJeserys
// Dashboard + Pedidos + Clientes + CRUD Usuarios
// SOLO ACCESO: rol 'admin'
// ============================================================
const express = require("express");
const router = express.Router();
const db = require("../db");
const bcrypt = require("bcryptjs");
const { verificarToken, soloAdmin } = require("../middleware/auth");

router.use(verificarToken, soloAdmin);

// ============================================================
// DASHBOARD
// ============================================================
router.get("/stats", async (req, res) => {
  try {
    const [[pedidosHoy]]    = await db.query("SELECT COUNT(*) AS total, COALESCE(SUM(total),0) AS ingresos FROM pedidos WHERE DATE(creado_en)=CURDATE()");
    const [[pendientes]]    = await db.query("SELECT COUNT(*) AS total FROM pedidos WHERE estado='pendiente'");
    const [[totalClientes]] = await db.query("SELECT COUNT(*) AS total FROM usuarios WHERE rol='cliente'");
    const [[stockBajo]]     = await db.query("SELECT COUNT(*) AS total FROM inventario WHERE stock < 3");
    const [pedidosRecientes] = await db.query(`
      SELECT p.id_pedido, p.total, p.estado, p.creado_en,
             CONCAT(u.nombre,' ',u.apellido) AS cliente
      FROM pedidos p JOIN usuarios u ON p.id_usuario=u.id_usuario
      ORDER BY p.creado_en DESC LIMIT 10
    `);
    res.json({ pedidosHoy: pedidosHoy.total, ingresosHoy: pedidosHoy.ingresos, pendientes: pendientes.total, totalClientes: totalClientes.total, stockBajo: stockBajo.total, pedidosRecientes });
  } catch (err) {
    res.status(500).json({ error: "Error." });
  }
});

// ============================================================
// PEDIDOS
// ============================================================
router.get("/pedidos", async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT p.*, CONCAT(u.nombre,' ',u.apellido) AS cliente, u.email, u.telefono
      FROM pedidos p JOIN usuarios u ON p.id_usuario=u.id_usuario
      ORDER BY p.creado_en DESC
    `);
    res.json(rows);
  } catch (err) { res.status(500).json({ error: "Error." }); }
});

// ============================================================
// CLIENTES (usuarios con rol cliente)
// ============================================================
router.get("/clientes", async (req, res) => {
  try {
    const [rows] = await db.query(
      "SELECT id_usuario,cedula,nombre,apellido,email,telefono,creado_en FROM usuarios WHERE rol='cliente' AND activo=1 ORDER BY creado_en DESC"
    );
    res.json(rows);
  } catch (err) { res.status(500).json({ error: "Error." }); }
});

// ============================================================
// CRUD USUARIOS (admin gestiona todos los usuarios)
// ============================================================

// GET /api/admin/usuarios - Listar todos los usuarios
// Query: ?buscar=texto (busca en nombre, apellido, cedula, email)
router.get("/usuarios", async (req, res) => {
  try {
    const { buscar = "" } = req.query;
    let sql = `SELECT id_usuario, cedula, username, nombre, apellido, email,
               telefono, direccion, rol, activo, creado_en
               FROM usuarios ORDER BY creado_en DESC`;
    let params = [];
    if (buscar) {
      sql = `SELECT id_usuario, cedula, username, nombre, apellido, email,
             telefono, direccion, rol, activo, creado_en
             FROM usuarios
             WHERE cedula LIKE ? OR nombre LIKE ? OR apellido LIKE ?
                OR email LIKE ? OR username LIKE ?
             ORDER BY creado_en DESC`;
      const q = `%${buscar}%`;
      params = [q, q, q, q, q];
    }
    const [rows] = await db.query(sql, params);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error obteniendo usuarios." });
  }
});

// GET /api/admin/usuarios/:id - Obtener un usuario por ID
router.get("/usuarios/:id", async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT id_usuario, cedula, username, nombre, apellido, email,
              telefono, direccion, rol, activo, creado_en
       FROM usuarios WHERE id_usuario=?`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: "Usuario no encontrado." });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: "Error." });
  }
});

// POST /api/admin/usuarios - Crear nuevo usuario
// Body: { cedula, nombre, apellido, email, telefono, direccion, rol }
// La contraseña por defecto es la cédula
router.post("/usuarios", async (req, res) => {
  const { cedula, nombre, apellido, email, telefono, direccion, rol = "cliente" } = req.body;

  if (!cedula || !nombre || !apellido || !email) {
    return res.status(400).json({ error: "Cedula, nombre, apellido y correo son obligatorios." });
  }
  if (!["cliente", "admin", "empleado"].includes(rol)) {
    return res.status(400).json({ error: "Rol invalido. Usa: cliente, admin, empleado." });
  }

  try {
    const [existeCedula] = await db.query("SELECT id_usuario FROM usuarios WHERE cedula=?", [cedula]);
    if (existeCedula.length) return res.status(409).json({ error: "Ya existe un usuario con esa cedula." });

    const [existeEmail] = await db.query("SELECT id_usuario FROM usuarios WHERE email=?", [email]);
    if (existeEmail.length) return res.status(409).json({ error: "Ya existe un usuario con ese correo." });

    const hash = await bcrypt.hash(cedula, 10);
    const [r] = await db.query(
      `INSERT INTO usuarios (cedula, nombre, apellido, email, telefono, direccion, password, rol, activo)
       VALUES (?,?,?,?,?,?,?,?,1)`,
      [cedula, nombre, apellido, email, telefono || null, direccion || null, hash, rol]
    );

    res.status(201).json({ mensaje: "Usuario creado. La contraseña es la cedula.", id_usuario: r.insertId });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error creando usuario." });
  }
});

// PUT /api/admin/usuarios/:id - Editar usuario
// Body: { cedula, nombre, apellido, email, telefono, direccion, rol }
router.put("/usuarios/:id", async (req, res) => {
  const { cedula, nombre, apellido, email, telefono, direccion, rol } = req.body;
  if (!cedula || !nombre || !apellido || !email) {
    return res.status(400).json({ error: "Cedula, nombre, apellido y correo son obligatorios." });
  }

  try {
    const [existeCedula] = await db.query(
      "SELECT id_usuario FROM usuarios WHERE cedula=? AND id_usuario!=?",
      [cedula, req.params.id]
    );
    if (existeCedula.length) return res.status(409).json({ error: "Esa cedula ya pertenece a otro usuario." });

    const [existeEmail] = await db.query(
      "SELECT id_usuario FROM usuarios WHERE email=? AND id_usuario!=?",
      [email, req.params.id]
    );
    if (existeEmail.length) return res.status(409).json({ error: "Ese correo ya pertenece a otro usuario." });

    await db.query(
      `UPDATE usuarios SET cedula=?, nombre=?, apellido=?, email=?, telefono=?,
       direccion=?, rol=? WHERE id_usuario=?`,
      [cedula, nombre, apellido, email, telefono || null, direccion || null, rol, req.params.id]
    );
    res.json({ mensaje: "Usuario actualizado." });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error actualizando usuario." });
  }
});

// PUT /api/admin/usuarios/:id/reset-password - Restablecer contraseña a la cédula
router.put("/usuarios/:id/reset-password", async (req, res) => {
  try {
    const [rows] = await db.query("SELECT cedula FROM usuarios WHERE id_usuario=?", [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: "Usuario no encontrado." });
    if (!rows[0].cedula) return res.status(400).json({ error: "El usuario no tiene cedula registrada." });

    const hash = await bcrypt.hash(rows[0].cedula, 10);
    await db.query("UPDATE usuarios SET password=? WHERE id_usuario=?", [hash, req.params.id]);
    res.json({ mensaje: "Contraseña restablecida a la cedula." });
  } catch (err) {
    res.status(500).json({ error: "Error restableciendo contraseña." });
  }
});

// DELETE /api/admin/usuarios/:id - Desactivar usuario (soft delete)
router.delete("/usuarios/:id", async (req, res) => {
  try {
    const [r] = await db.query("UPDATE usuarios SET activo=0 WHERE id_usuario=?", [req.params.id]);
    if (r.affectedRows === 0) return res.status(404).json({ error: "Usuario no encontrado." });
    res.json({ mensaje: "Usuario desactivado." });
  } catch (err) {
    res.status(500).json({ error: "Error eliminando usuario." });
  }
});

module.exports = router;
