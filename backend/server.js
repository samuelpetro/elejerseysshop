// ============================================================
// server.js UNIFICADO - EleJeserys + Tienda Deportiva
// Puerto: 3000 | Frontend: / (tienda) y /panel/ (admin)
// ============================================================
const express = require("express");
const cors = require("cors");
const path = require("path");
require("dotenv").config();

const app = express();
app.use(cors());
app.use(express.json());

// Imagenes compartidas
app.use("/uploads", express.static(path.join(__dirname, "../uploads")));

// EleJeserys frontend (tienda online)
app.use(express.static(path.join(__dirname, "../frontend/tienda")));

// Tienda Deportiva frontend (panel admin)
app.use("/panel", express.static(path.join(__dirname, "../frontend/panel")));

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
app.use("/api/proveedores", require("./routes/proveedores"));

// Catch-all: EleJeserys SPA
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "../frontend/tienda/index.html"));
});

app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: "Error interno." });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\nServidor UNIFICADO en http://localhost:${PORT}`);
  console.log(`  Tienda: http://localhost:${PORT}`);
  console.log(`  Panel:  http://localhost:${PORT}/panel/login.html`);
});
