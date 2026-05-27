// ============================================================
// server_panel.js - Tienda Deportiva (puerto 5000)
// Sirve frontend/panel/
// ============================================================
const express = require("express");
const cors = require("cors");
const path = require("path");
require("dotenv").config();

const app = express();
app.use(cors());
app.use(express.json());
app.use("/uploads", express.static(path.join(__dirname, "../uploads")));
app.use(express.static(path.join(__dirname, "../frontend/panel")));

app.use("/api/auth",        require("./routes/auth"));
app.use("/api/productos",   require("./routes/productos"));
app.use("/api/categorias",  require("./routes/categorias"));
app.use("/api/pedidos",     require("./routes/pedidos"));
app.use("/api/admin",       require("./routes/admin"));
app.use("/api/clientes",    require("./routes/clientes"));
app.use("/api/usuarios",    require("./routes/usuarios"));
app.use("/api/ventas",      require("./routes/ventas"));
app.use("/api/dashboard",   require("./routes/dashboard"));

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "../frontend/panel/index.html"));
});

app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: "Error interno." });
});

app.listen(5000, () => {
  console.log("Tienda Deportiva en http://localhost:5000");
  console.log("  Login:  http://localhost:5000/login.html");
  console.log("  Panel:  http://localhost:5000");
});
