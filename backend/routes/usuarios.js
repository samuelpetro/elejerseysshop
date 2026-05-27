// ============================================================
// routes/usuarios.js - CRUD de usuarios (solo admin)
// GET    /api/usuarios?buscar= -> Listar todos
// GET    /api/usuarios/:id     -> Obtener uno
// POST   /api/usuarios         -> Crear (password = cedula)
// PUT    /api/usuarios/:id     -> Editar
// PUT    /api/usuarios/:id/reset-password -> Reset a cedula
// DELETE /api/usuarios/:id     -> Desactivar
// ============================================================
const express = require("express");
const router = express.Router();
const bcrypt = require("bcryptjs");
const db = require("../db");
const { verificarToken, soloAdmin } = require("../middleware/auth");

router.use(verificarToken, soloAdmin);

router.get("/", async (req, res) => {
  try {
    const { buscar = "" } = req.query;
    let sql = `SELECT id_usuario, cedula, username, nombre, apellido, email,
               telefono, direccion, rol, activo, creado_en
               FROM usuarios WHERE rol != 'admin' ORDER BY creado_en DESC`;
    let params = [];
    if (buscar) {
      sql = `SELECT id_usuario, cedula, username, nombre, apellido, email,
             telefono, direccion, rol, activo, creado_en
             FROM usuarios
             WHERE rol != 'admin' AND (cedula LIKE ? OR nombre LIKE ? OR apellido LIKE ?
                OR email LIKE ? OR username LIKE ?)
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

router.get("/:id", async (req, res) => {
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

router.post("/", async (req, res) => {
  const { cedula, username: usernameInput, nombre, apellido, email, telefono, direccion, rol = "cliente" } = req.body;
  if (!cedula || !nombre || !apellido || !email) {
    return res.status(400).json({ error: "Cedula, nombre, apellido y correo son obligatorios." });
  }
  if (!["cliente", "admin", "empleado"].includes(rol)) {
    return res.status(400).json({ error: "Rol invalido." });
  }
  if (rol === "admin") {
    const [[adminExiste]] = await db.query("SELECT id_usuario FROM usuarios WHERE rol='admin' AND activo=1 LIMIT 1");
    if (adminExiste) return res.status(409).json({ error: "Ya existe un administrador activo. No se puede crear otro." });
  }
  try {
    const [existeCedula] = await db.query("SELECT id_usuario FROM usuarios WHERE cedula=?", [cedula]);
    if (existeCedula.length) return res.status(409).json({ error: "Ya existe un usuario con esa cedula." });
    const [existeEmail] = await db.query("SELECT id_usuario FROM usuarios WHERE email=?", [email]);
    if (existeEmail.length) return res.status(409).json({ error: "Ya existe un usuario con ese correo." });

    const username = usernameInput?.trim() || email.split("@")[0];
    const [existeUsername] = await db.query("SELECT id_usuario FROM usuarios WHERE username=?", [username]);
    if (existeUsername.length) {
      if (usernameInput?.trim()) return res.status(409).json({ error: "Ese nombre de usuario ya existe." });
      // Si se auto-generó y ya existe, agregar sufijo
      const usernameFinal = email.split("@")[0] + "_" + Date.now().toString().slice(-4);
      const hash = await bcrypt.hash(cedula, 10);
      const [r] = await db.query(
        `INSERT INTO usuarios (cedula, username, nombre, apellido, email, telefono, direccion, password, rol, activo)
         VALUES (?,?,?,?,?,?,?,?,?,1)`,
        [cedula, usernameFinal, nombre, apellido, email, telefono || null, direccion || null, hash, rol]
      );
      return res.status(201).json({ message: "Usuario creado. Contrasena: la cedula.", id_usuario: r.insertId });
    }

    const hash = await bcrypt.hash(cedula, 10);
    const [r] = await db.query(
      `INSERT INTO usuarios (cedula, username, nombre, apellido, email, telefono, direccion, password, rol, activo)
       VALUES (?,?,?,?,?,?,?,?,?,1)`,
      [cedula, username, nombre, apellido, email, telefono || null, direccion || null, hash, rol]
    );
    res.status(201).json({ message: "Usuario creado. Contrasena: la cedula.", id_usuario: r.insertId });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error creando usuario." });
  }
});

router.put("/:id", async (req, res) => {
  const { cedula, username: usernameInput, nombre, apellido, email, telefono, direccion, rol } = req.body;
  if (!cedula || !nombre || !apellido || !email) {
    return res.status(400).json({ error: "Cedula, nombre, apellido y correo son obligatorios." });
  }
  try {
    const [existeCedula] = await db.query("SELECT id_usuario FROM usuarios WHERE cedula=? AND id_usuario!=?", [cedula, req.params.id]);
    if (existeCedula.length) return res.status(409).json({ error: "Esa cedula ya pertenece a otro usuario." });
    const [existeEmail] = await db.query("SELECT id_usuario FROM usuarios WHERE email=? AND id_usuario!=?", [email, req.params.id]);
    if (existeEmail.length) return res.status(409).json({ error: "Ese correo ya pertenece a otro usuario." });
    if (usernameInput?.trim()) {
      const [existeUsername] = await db.query("SELECT id_usuario FROM usuarios WHERE username=? AND id_usuario!=?", [usernameInput.trim(), req.params.id]);
      if (existeUsername.length) return res.status(409).json({ error: "Ese nombre de usuario ya existe." });
    }

    if (rol === "admin") {
      const [[adminExiste]] = await db.query("SELECT id_usuario FROM usuarios WHERE rol='admin' AND activo=1 AND id_usuario!=? LIMIT 1", [req.params.id]);
      if (adminExiste) return res.status(409).json({ error: "Ya existe un administrador activo. No se puede asignar este rol." });
    }

    await db.query(
      `UPDATE usuarios SET cedula=?, username=COALESCE(NULLIF(?,''), username), nombre=?, apellido=?,
       email=?, telefono=?, direccion=?, rol=? WHERE id_usuario=?`,
      [cedula, usernameInput?.trim() || null, nombre, apellido, email, telefono || null, direccion || null, rol, req.params.id]
    );
    res.json({ message: "Usuario actualizado." });
  } catch (err) {
    res.status(500).json({ error: "Error actualizando usuario." });
  }
});

router.put("/:id/reset-password", async (req, res) => {
  try {
    const [rows] = await db.query("SELECT cedula FROM usuarios WHERE id_usuario=?", [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: "Usuario no encontrado." });
    if (!rows[0].cedula) return res.status(400).json({ error: "El usuario no tiene cedula." });
    const hash = await bcrypt.hash(rows[0].cedula, 10);
    await db.query("UPDATE usuarios SET password=? WHERE id_usuario=?", [hash, req.params.id]);
    res.json({ message: "Contrasena restablecida a la cedula." });
  } catch (err) {
    res.status(500).json({ error: "Error." });
  }
});

router.delete("/:id", async (req, res) => {
  try {
    const [[user]] = await db.query("SELECT rol FROM usuarios WHERE id_usuario=?", [req.params.id]);
    if (!user) return res.status(404).json({ error: "Usuario no encontrado." });
    if (user.rol === "admin") return res.status(403).json({ error: "No se puede desactivar el administrador." });
    const [r] = await db.query("UPDATE usuarios SET activo=0 WHERE id_usuario=?", [req.params.id]);
    if (r.affectedRows === 0) return res.status(404).json({ error: "Usuario no encontrado." });
    res.json({ message: "Usuario desactivado." });
  } catch (err) {
    res.status(500).json({ error: "Error." });
  }
});

module.exports = router;
