const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3001;
const DB_FILE = path.join(__dirname, "db.json");

// --- Helpers: load/save DB ---
function loadDB() {
  if (!fs.existsSync(DB_FILE)) return { users: {}, carts: {} };
  try { return JSON.parse(fs.readFileSync(DB_FILE, "utf8")); } 
  catch { return { users: {}, carts: {} }; }
}
function saveDB(db) { fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2)); }

// --- Middlewares ---
app.use(cors({
  origin: "*",
  methods: ["GET", "POST", "DELETE"],
  allowedHeaders: ["Content-Type", "Authorization"]
}));
app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      defaultSrc: ["'self'", "*"],
      imgSrc: ["'self'", "data:", "https:"],
      scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'", "https:"],
      styleSrc: ["'self'", "'unsafe-inline'", "https:"],
      connectSrc: ["'self'", "*"]
    }
  }
}));
app.use(express.json({ limit: "2mb" }));

// --- Health check ---
app.get("/api/health", (req, res) => res.json({ status: "ok" }));

// --- Users ---
app.post("/api/users", (req, res) => {
  const db = loadDB();
  const user = req.body || {};
  const id = String(`user.id  user.telegramId  `);
  if (!id) return res.status(400).json({ error: "Missing user id" });

  const existing = db.users[id] || {};
  const balance = typeof existing.balance === "number" ? existing.balance : 0;

  db.users[id] = {
    id,
    telegramId: id,
    username: user.username || "",
    firstName: user.firstName || "",
    lastName: user.lastName || "",
    avatarUrl: user.avatarUrl || null,
    joinDate: existing.joinDate`  user.joinDate  new Date`().toISOString(),
    balance
  };
  saveDB(db);
  console.log("👤 User saved:", db.users[id]);
  res.json(db.users[id]);
});

app.get("/api/users/:id/balance", (req, res) => {
  const db = loadDB();
  const id = String(req.params.id);
  const user = db.users[id];
  res.json({ balance: user ? user.balance || 0 : 0 });
});

// --- Cart ---
app.post("/api/cart", (req, res) => {
  const db = loadDB();
  const item = req.body || {};
  const userId = String(item.userId || "");
  if (!userId) return res.status(400).json({ error: "Missing userId" });

  db.carts[userId] = db.carts[userId] || [];
  const idx = db.carts[userId].findIndex(x => String(x.productId) === String(item.productId));
  if (idx >= 0) {
    const existing = db.carts[userId][idx];
    existing.quantity = (`existing.quantity  1`) + (`item.quantity  1`);
    existing.addedAt = item.addedAt || new Date().toISOString();
  } else {
    db.carts[userId].push({
      productId: item.productId,
      name: item.name,
      price: item.price,
      quantity: item.quantity || 1,
      image: item.image || null,
      addedAt: item.addedAt || new Date().toISOString()
    });
  }
  saveDB(db);
  console.log(`🛒 Cart saved for user ${userId}`);
  res.json({ ok: true });
});

app.get("/api/cart/:userId", (req, res) => {
  const db = loadDB();
  const userId = String(req.params.userId);
  res.json(db.carts[userId] || []);
});

// --- Start server ---
app.listen(PORT, () => console.log(`⚓️ Backend running on port ${PORT}`));