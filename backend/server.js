// ============================================================
// server.js UNIFICADO - Backend + Frontend
// Railway sirve API y frontend juntos
// ============================================================
const express = require("express");
const cors = require("cors");
const path = require("path");
require("dotenv").config();

const app = express();
app.use(cors());
app.use(express.json());

// Imagenes
app.use("/uploads", express.static(path.join(__dirname, "../uploads")));

// Frontend admin panel
app.use(express.static(path.join(__dirname, "../frontend/panel")));

// ============================================================
// API ROUTES
// ============================================================
app.use("/api/auth",        require("./routes/auth"));
app.use("/api/productos",   require("./routes/productos"));
app.use("/api/categorias",  require("./routes/categorias"));
app.use("/api/pedidos",     require("./routes/pedidos"));
app.use("/api/admin",       require("./routes/admin"));
app.use("/api/clientes",    require("./routes/clientes"));
app.use("/api/usuarios",    require("./routes/usuarios"));
app.use("/api/ventas",      require("./routes/ventas"));
app.use("/api/dashboard",   require("./routes/dashboard"));
app.use("/api/devoluciones", require("./routes/devoluciones"));

// SPA: todo lo que no sea /api va al frontend
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "../frontend/panel/index.html"));
});

app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: "Error interno." });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor en puerto ${PORT}`);
});
