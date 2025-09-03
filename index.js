const express = require("express");
const cors = require("cors");
const helmet = require("helmet");

const app = express();
const PORT = process.env.PORT || 3001;

// In-memory database (вместо файлов)
let db = {
  users: {},
  carts: {}
};

// --- Middlewares ---
app.use(cors({
  origin: "*",
  methods: ["GET", "POST", "DELETE", "PUT"],
  allowedHeaders: ["Content-Type", "Authorization"]
}));

app.use(helmet());
app.use(express.json({ limit: "2mb" }));

// Логирование всех запросов
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} ${req.method} ${req.path}`, req.body || '');
  next();
});

// --- Health check ---
app.get("/health", (req, res) => {
  console.log("Health check requested");
  res.json({ 
    status: "ok", 
    message: "Telegram Mini App Backend is running!",
    timestamp: new Date().toISOString(),
    usersCount: Object.keys(db.users).length,
    cartsCount: Object.keys(db.carts).length
  });
});

// --- Users ---
app.post("/users", (req, res) => {
  try {
    console.log("User save request:", req.body);
    
    const userData = req.body || {};
    const telegramId = String(userData.telegramId || userData.id || "");
    
    if (!telegramId) {
      return res.status(400).json({ error: "Missing telegramId" });
    }

    const existingUser = db.users[telegramId];
    
    if (existingUser) {
      // Обновляем данные существующего пользователя
      db.users[telegramId] = {
        ...existingUser,
        username: userData.username || existingUser.username,
        firstName: userData.firstName || existingUser.firstName,
        lastName: userData.lastName || existingUser.lastName,
        avatarUrl: userData.avatarUrl || existingUser.avatarUrl,
        lastSeen: new Date().toISOString()
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
        lastSeen: new Date().toISOString(),
        balance: 1000
      };
    }
    
    console.log("User saved:", db.users[telegramId]);
    res.json(db.users[telegramId]);
    
  } catch (error) {
    console.error("Error saving user:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.get("/users/:telegramId/balance", (req, res) => {
  try {
    const telegramId = String(req.params.telegramId);
    console.log("Balance request for:", telegramId);
    
    const user = db.users[telegramId];
    const balance = user ? user.balance : 1000;
    
    console.log("Balance response:", balance);
    res.json({ balance: balance });
    
  } catch (error) {
    console.error("Balance error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// --- Cart ---
app.post("/cart", (req, res) => {
  try {
    console.log("Cart save request:", req.body);
    
    const item = req.body || {};
    const telegramId = String(item.telegramId || item.userId || "");
    
    if (!telegramId) {
      return res.status(400).json({ error: "Missing telegramId" });
    }

    // Инициализируем корзину если не существует
    if (!db.carts[telegramId]) {
      db.carts[telegramId] = [];
    }
    
    const existingItemIndex = db.carts[telegramId].findIndex(
      x => String(x.productId) === String(item.productId)
    );

    if (existingItemIndex >= 0) {
      // Обновляем количество существующего товара
      db.carts[telegramId][existingItemIndex].quantity += item.quantity || 1;
      db.carts[telegramId][existingItemIndex].updatedAt = new Date().toISOString();
    } else {
      // Добавляем новый товар
      db.carts[telegramId].push({
        productId: item.productId,
        name: item.name || "Unknown Product",
        price: item.price || 0,
        quantity: item.quantity || 1,
        image: item.image || null,
        addedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });
    }
    
    console.log(`Cart saved for user ${telegramId}:`, db.carts[telegramId].length, "items");
    res.json({ 
      success: true, 
      message: "Item added to cart",
      cartItems: db.carts[telegramId].length
    });
    
  } catch (error) {
    console.error("Cart save error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.get("/cart/:telegramId", (req, res) => {
  try {
    const telegramId = String(req.params.telegramId);
    console.log("Cart load request for:", telegramId);
    
    const cartItems = db.carts[telegramId] || [];
    console.log("Cart response:", cartItems.length, "items");
    
    res.json(cartItems);
    
  } catch (error) {
    console.error("Cart load error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Удалить товар из корзины
app.delete("/cart/:telegramId/:productId", (req, res) => {
  try {
    const telegramId = String(req.params.telegramId);
    const productId = String(req.params.productId);
    
    console.log("Delete item request:", { telegramId, productId });
    
    if (db.carts[telegramId]) {
      const initialLength = db.carts[telegramId].length;
      db.carts[telegramId] = db.carts[telegramId].filter(
        item => String(item.productId) !== productId
      );
      console.log("Items deleted:", initialLength - db.carts[telegramId].length);
    }
    
    res.json({ success: true, message: "Item deleted" });
    
  } catch (error) {
    console.error("Delete item error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// --- Debug endpoint ---
app.get("/debug", (req, res) => {
  res.json({
    usersCount: Object.keys(db.users).length,
    cartsCount: Object.keys(db.carts).length,
    memoryUsage: process.memoryUsage(),
    uptime: process.uptime(),
    timestamp: new Date().toISOString()
  });
});

// Очистка старых данных (опционально)
setInterval(() => {
  const now = Date.now();
  const oneDay = 24 * 60 * 60 * 1000;
  
  // Очищаем пользователей who не заходили больше 7 дней
  Object.keys(db.users).forEach(telegramId => {
    const user = db.users[telegramId];
    if (user.lastSeen && (now - new Date(user.lastSeen).getTime() > 120 * oneDay)) {
      delete db.users[telegramId];
      delete db.carts[telegramId];
      console.log("Cleaned up old user:", telegramId);
    }
  });
}, 60 * 60 * 1000); // Каждый час

// --- Start server ---
app.listen(PORT, () => {
  console.log(`⚓️ Backend running on port ${PORT}`);
  console.log(`📍 Health check: http://localhost:${PORT}/health`);
  console.log(`📍 Debug: http://localhost:${PORT}/debug`);
  console.log(`🚀 Ready for Telegram Mini App!`);
});

module.exports = app;
