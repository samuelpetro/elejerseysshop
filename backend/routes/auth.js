// ============================================================
// routes/auth.js - Autenticacion UNIFICADA
// POST /api/auth/registro -> Cliente web (tabla clientes)
// POST /api/auth/register -> Empleado/admin (tabla usuarios, admin only)
// POST /api/auth/login    -> Detecta email(clientes) o username(usuarios)
// GET  /api/auth/perfil   -> Ver perfil propio
// PUT  /api/auth/perfil   -> Actualizar perfil
// ============================================================
const express = require("express");
const router = express.Router();
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const db = require("../db");
const { verificarToken, soloAdmin } = require("../middleware/auth");

// ------------------------------------------------------------
// POST /api/auth/registro - Cliente web se registra (tabla clientes)
// ------------------------------------------------------------
router.post("/registro", async (req, res) => {
  const { nombre, apellido, email, telefono, direccion, password } = req.body;
  if (!nombre || !apellido || !email || !password) {
    return res.status(400).json({ error: "Nombre, apellido, correo y contraseña son obligatorios." });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: "La contraseña debe tener al menos 6 caracteres." });
  }
  try {
    const [existe] = await db.query("SELECT id_cliente FROM clientes WHERE email = ?", [email]);
    if (existe.length > 0) return res.status(409).json({ error: "Ya existe una cuenta con ese correo." });
    const hash = await bcrypt.hash(password, 10);
    const cedula = email.split("@")[0];
    const [result] = await db.query(
      "INSERT INTO clientes (cedula, nombre, apellido, email, telefono, direccion, password) VALUES (?,?,?,?,?,?,?)",
      [cedula, nombre, apellido, email, telefono || null, direccion || null, hash]
    );
    const token = jwt.sign(
      { id: result.insertId, email, rol: "cliente", nombre, tipo: "cliente" },
      process.env.JWT_SECRET, { expiresIn: "8h" }
    );
    res.status(201).json({
      mensaje: "Cuenta creada exitosamente.",
      token, usuario: { id: result.insertId, nombre, apellido, email, rol: "cliente" },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al crear la cuenta." });
  }
});

// ------------------------------------------------------------
// POST /api/auth/register - Admin crea empleado (tabla usuarios)
// ------------------------------------------------------------
router.post("/register", verificarToken, soloAdmin, async (req, res) => {
  const { username, password, rol = "empleado" } = req.body;
  if (!username || !password) return res.status(400).json({ error: "Usuario y contrasena requeridos." });
  try {
    const [existe] = await db.query("SELECT id_usuario FROM usuarios WHERE username = ?", [username]);
    if (existe.length > 0) return res.status(409).json({ error: "El nombre de usuario ya existe." });
    const hash = await bcrypt.hash(password, 10);
    const [result] = await db.query(
      "INSERT INTO usuarios (username, password, rol, activo) VALUES (?, ?, ?, 1)",
      [username, hash, rol]
    );
    res.status(201).json({ message: "Usuario creado.", id_usuario: result.insertId });
  } catch (err) {
    res.status(500).json({ error: "Error interno." });
  }
});

// ------------------------------------------------------------
// POST /api/auth/login - Login unificado
// Si tiene email -> busca en clientes. Si tiene username -> busca en usuarios.
// ------------------------------------------------------------
router.post("/login", async (req, res) => {
  const { email, username, password } = req.body;
  if ((!email && !username) || !password) {
    return res.status(400).json({ error: "Credenciales requeridas." });
  }

  try {
    let user = null;
    let tipo = null;

    // Login por email: busca primero en clientes, luego en usuarios
    if (email) {
      const [rows] = await db.query("SELECT * FROM clientes WHERE email = ?", [email]);
      if (rows.length > 0) { user = rows[0]; tipo = "cliente"; user.rol = "cliente"; }
      else {
        const [rowsU] = await db.query("SELECT * FROM usuarios WHERE email = ? AND activo = 1", [email]);
        if (rowsU.length > 0) { user = rowsU[0]; tipo = "usuario"; }
      }
    }

    // Login por username (empleado/admin - tabla usuarios)
    if (!user && username) {
      const [rows] = await db.query("SELECT * FROM usuarios WHERE username = ? AND activo = 1", [username]);
      if (rows.length > 0) { user = rows[0]; tipo = "usuario"; }
    }

    if (!user) return res.status(401).json({ error: "Credenciales incorrectas." });

    // Verificar password
    let ok = false;
    try { ok = await bcrypt.compare(password, user.password); }
    catch { ok = password === user.password; if (ok) { const h = await bcrypt.hash(password, 10); await db.query("UPDATE " + (tipo === "cliente" ? "clientes" : "usuarios") + " SET password=? WHERE " + (tipo === "cliente" ? "id_cliente" : "id_usuario") + "=?", [h, tipo === "cliente" ? user.id_cliente : user.id_usuario]); } }
    if (!ok) return res.status(401).json({ error: "Credenciales incorrectas." });

    const tokenPayload = tipo === "cliente"
      ? { id: user.id_cliente, email: user.email, rol: "cliente", nombre: user.nombre, tipo: "cliente" }
      : { id: user.id_usuario, username: user.username, rol: user.rol, tipo: "usuario" };

    const token = jwt.sign(tokenPayload, process.env.JWT_SECRET, { expiresIn: "8h" });

    res.json({
      token, message: "Login exitoso.",
      usuario: tipo === "cliente"
        ? { id: user.id_cliente, nombre: user.nombre, apellido: user.apellido, email: user.email, rol: "cliente" }
        : { id: user.id_usuario, username: user.username, rol: user.rol },
    });
  } catch (err) { console.error(err); res.status(500).json({ error: "Error interno." }); }
});

// ------------------------------------------------------------
// GET /api/auth/perfil
// ------------------------------------------------------------
router.get("/perfil", verificarToken, async (req, res) => {
  try {
    const { tipo, id } = req.user;
    const tabla = tipo === "cliente" ? "clientes" : "usuarios";
    const colId = tipo === "cliente" ? "id_cliente" : "id_usuario";
    const [rows] = await db.query(`SELECT ${colId} AS id, ${tipo==='cliente'?'cedula,':''} nombre, apellido, email, telefono, direccion, creado_en FROM ${tabla} WHERE ${colId}=?`, [id]);
    if (!rows.length) return res.status(404).json({ error: "No encontrado." });
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: "Error." }); }
});

// ------------------------------------------------------------
// PUT /api/auth/perfil
// ------------------------------------------------------------
router.put("/perfil", verificarToken, async (req, res) => {
  const { nombre, apellido, telefono, direccion, password_nueva } = req.body;
  try {
    const { tipo, id } = req.user;
    const tabla = tipo === "cliente" ? "clientes" : "usuarios";
    const colId = tipo === "cliente" ? "id_cliente" : "id_usuario";
    await db.query(`UPDATE ${tabla} SET nombre=?, apellido=?, telefono=?, direccion=? WHERE ${colId}=?`, [nombre, apellido, telefono, direccion, id]);
    if (password_nueva && password_nueva.length >= 6) {
      const h = await bcrypt.hash(password_nueva, 10);
      await db.query(`UPDATE ${tabla} SET password=? WHERE ${colId}=?`, [h, id]);
    }
    res.json({ mensaje: "Perfil actualizado." });
  } catch (err) { res.status(500).json({ error: "Error." }); }
});

module.exports = router;
