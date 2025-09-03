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
  try { 
    return JSON.parse(fs.readFileSync(DB_FILE, "utf8")); 
  } catch { 
    return { users: {}, carts: {} }; 
  }
}

function saveDB(db) { 
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2)); 
}

// --- Middlewares ---
app.use(cors({
  origin: "*",
  methods: ["GET", "POST", "DELETE", "PUT"],
  allowedHeaders: ["Content-Type", "Authorization"]
}));

app.use(helmet());
app.use(express.json({ limit: "2mb" }));

// --- Health check ---
app.get("/health", (req, res) => res.json({ 
  status: "ok", 
  message: "Telegram Mini App Backend" 
}));

// --- Users ---
app.post("/users", (req, res) => {
  try {
    const db = loadDB();
    const userData = req.body || {};
    const telegramId = String(userData.telegramId || userData.id || "");
    
    if (!telegramId) {
      return res.status(400).json({ error: "Missing telegramId" });
    }

    // Проверяем существующего пользователя
    const existingUser = db.users[telegramId];
    
    if (existingUser) {
      // Обновляем данные существующего пользователя
      db.users[telegramId] = {
        ...existingUser,
        username: userData.username || existingUser.username,
        firstName: userData.firstName || existingUser.firstName,
        lastName: userData.lastName || existingUser.lastName,
        avatarUrl: userData.avatarUrl || existingUser.avatarUrl
      };
    } else {
      // Создаем нового пользователя
      db.users[telegramId] = {
        id: telegramId,
        telegramId: telegramId,
        username: userData.username || "",
        firstName: userData.firstName || "",
        lastName: userData.lastName || "",
        avatarUrl: userData.avatarUrl || null,
        joinDate: new Date().toISOString(),
        balance: 1000 // Начальный баланс
      };
    }
    
    saveDB(db);
    console.log("👤 User saved:", db.users[telegramId]);
    res.json(db.users[telegramId]);
    
  } catch (error) {
    console.error("Error saving user:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.get("/users/:telegramId/balance", (req, res) => {
  try {
    const db = loadDB();
    const telegramId = String(req.params.telegramId);
    const user = db.users[telegramId];
    res.json({ balance: user ? user.balance : 1000 });
  } catch (error) {
    res.status(500).json({ error: "Internal server error" });
  }
});

// --- Cart ---
app.post("/cart", (req, res) => {
  try {
    const db = loadDB();
    const item = req.body || {};
    const telegramId = String(item.userId || item.telegramId || "");
    
    if (!telegramId) {
      return res.status(400).json({ error: "Missing userId/telegramId" });
    }

    // Создаем корзину если не существует
    db.carts[telegramId] = db.carts[telegramId] || [];
    
    const existingItemIndex = db.carts[telegramId].findIndex(
      x => String(x.productId) === String(item.productId)
    );

    if (existingItemIndex >= 0) {
      // Обновляем количество существующего товара
      db.carts[telegramId][existingItemIndex].quantity += item.quantity || 1;
    } else {
      // Добавляем новый товар
      db.carts[telegramId].push({
        productId: item.productId,
        name: item.name || "Unknown Product",
        price: item.price || 0,
        quantity: item.quantity || 1,
        image: item.image || null,
        addedAt: new Date().toISOString()
      });
    }
    
    saveDB(db);
    console.log(`🛒 Cart saved for user ${telegramId}`);
    res.json({ success: true, message: "Item added to cart" });
    
  } catch (error) {
    console.error("Error saving cart:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.get("/cart/:telegramId", (req, res) => {
  try {
    const db = loadDB();
    const telegramId = String(req.params.telegramId);
    res.json(db.carts[telegramId] || []);
  } catch (error) {
    res.status(500).json({ error: "Internal server error" });
  }
});

// Удалить товар из корзины
app.delete("/cart/:telegramId/:productId", (req, res) => {
  try {
    const db = loadDB();
    const telegramId = String(req.params.telegramId);
    const productId = String(req.params.productId);
    
    if (db.carts[telegramId]) {
      db.carts[telegramId] = db.carts[telegramId].filter(
        item => String(item.productId) !== productId
      );
      saveDB(db);
    }
    
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: "Internal server error" });
  }
});

// --- Start server ---
app.listen(PORT, () => {
  console.log(`⚓️ Backend running on port ${PORT}`);
  console.log(`📍 Health check: http://localhost:${PORT}/health`);
});