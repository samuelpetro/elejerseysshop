// ============================================================
// server.js - API Backend para Railway
// Frontend desplegado por separado en Vercel
// ============================================================
const express = require("express");
const cors = require("cors");
require("dotenv").config();

const app = express();
app.use(cors());
app.use(express.json());

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

app.get("/", (req, res) => {
  res.json({ mensaje: "API EleJerseys funcionando" });
});

app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: "Error interno." });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`API funcionando en puerto ${PORT}`);
});
