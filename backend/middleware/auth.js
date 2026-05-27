const jwt = require("jsonwebtoken");

function verificarToken(req, res, next) {
  const token = (req.headers["authorization"] || "").split(" ")[1];
  if (!token) return res.status(401).json({ error: "Sesión requerida. Inicia sesión." });
  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ error: "Sesión inválida o expirada." });
    req.user = user;
    next();
  });
}

function soloAdmin(req, res, next) {
  if (req.user?.rol !== "admin") return res.status(403).json({ error: "Solo administradores." });
  next();
}

module.exports = { verificarToken, soloAdmin };
