// ============================================================
// server_tienda.js - EleJeserys (puerto 3000)
// Sirve frontend/tienda/
// ============================================================
const express = require("express");
const cors = require("cors");
const path = require("path");
require("dotenv").config();

const app = express();
app.use(cors());
app.use(express.json());
app.use("/uploads", express.static(path.join(__dirname, "../uploads")));
app.use(express.static(path.join(__dirname, "../frontend/tienda")));

app.use("/api/auth",        require("./routes/auth"));
app.use("/api/productos",   require("./routes/productos"));
app.use("/api/categorias",  require("./routes/categorias"));
app.use("/api/pedidos",     require("./routes/pedidos"));
app.use("/api/admin",       require("./routes/admin"));

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "../frontend/tienda/index.html"));
});

app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: "Error interno." });
});

app.listen(3000, () => {
  console.log("EleJeserys en http://localhost:3000");
  console.log("  Tienda: http://localhost:3000");
  console.log("  Admin:  http://localhost:3000/admin/login.html");
});
