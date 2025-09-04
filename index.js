const express = require("express");
const cors = require("cors");
const helmet = require("helmet");

const app = express();
const PORT = process.env.PORT || 3001;

// In-memory database
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

// Логирование
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} ${req.method} ${req.path}`, req.body || '');
  next();
});

// --- Health check ---
app.get("/health", (req, res) => {
  res.json({ 
    status: "ok", 
    message: "Telegram Mini App Backend is running!",
    timestamp: new Date().toISOString()
  });
});

// --- Users ---
app.post("/users", (req, res) => {
  try {
    const userData = req.body || {};
    const telegramId = String(userData.telegramId || userData.id || "");
    
    if (!telegramId) {
      return res.status(400).json({ error: "Missing telegramId" });
    }

    const existingUser = db.users[telegramId];
    
    if (existingUser) {
      // 🔥 СОХРАНЯЕМ БАЛАНС из запроса
      db.users[telegramId] = {
        ...existingUser,
        balance: userData.balance !== undefined ? userData.balance : existingUser.balance,
        username: userData.username || existingUser.username,
        firstName: userData.firstName || existingUser.firstName,
        lastName: userData.lastName || existingUser.lastName,
        avatarUrl: userData.avatarUrl || existingUser.avatarUrl
      };
    } else {
      db.users[telegramId] = {
        id: telegramId,
        telegramId: telegramId,
        username: userData.username || "",
        firstName: userData.firstName || "",
        lastName: userData.lastName || "",
        avatarUrl: userData.avatarUrl || null,
        joinDate: new Date().toISOString(),
        balance: userData.balance !== undefined ? userData.balance : 0
      };
    }
    
    console.log("👤 User saved with balance:", db.users[telegramId].balance);
    res.json(db.users[telegramId]);
    
  } catch (error) {
    console.error("Error saving user:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// --- Cart --- (ОБНОВЛЯЕМ ДЛЯ СОХРАНЕНИЯ!)
app.post("/cart", (req, res) => {
  try {
    const item = req.body || {};
    const telegramId = String(item.telegramId || item.userId || "");
    
    if (!telegramId) {
      return res.status(400).json({ error: "Missing telegramId" });
    }

    // Убедимся что пользователь существует
    if (!db.users[telegramId]) {
      return res.status(404).json({ error: "User not found" });
    }

    db.carts[telegramId] = db.carts[telegramId] || [];
    
    const existingItemIndex = db.carts[telegramId].findIndex(
      x => String(x.productId) === String(item.productId)
    );

    if (existingItemIndex >= 0) {
      db.carts[telegramId][existingItemIndex].quantity += item.quantity || 1;
    } else {
      db.carts[telegramId].push({
        productId: item.productId,
        name: item.name || "Unknown Product",
        price: item.price || 0,
        quantity: item.quantity || 1,
        image: item.image || null,
        addedAt: new Date().toISOString()
      });
    }
    
    console.log(`🛒 Cart saved for user ${telegramId}`);
    res.json({ success: true, message: "Item added to cart" });
    
  } catch (error) {
    console.error("Error saving cart:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.get("/cart/:telegramId", (req, res) => {
  try {
    const telegramId = String(req.params.telegramId);
    const cartItems = db.carts[telegramId] || [];
    
    res.json(cartItems);
    
  } catch (error) {
    console.error("Cart load error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// --- Balance operations ---
app.post("/users/:telegramId/balance/add", (req, res) => {
  try {
    const telegramId = String(req.params.telegramId);
    const { amount } = req.body;
    
    if (!db.users[telegramId]) {
      return res.status(404).json({ error: "User not found" });
    }
    
    if (!amount || amount <= 0) {
      return res.status(400).json({ error: "Invalid amount" });
    }
    
    db.users[telegramId].balance += amount;
    
    console.log(`💰 Added ${amount} to user ${telegramId}, new balance: ${db.users[telegramId].balance}`);
    res.json({ 
      success: true, 
      newBalance: db.users[telegramId].balance 
    });
    
  } catch (error) {
    console.error("Balance add error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.post("/users/:telegramId/balance/subtract", (req, res) => {
  try {
    const telegramId = String(req.params.telegramId);
    const { amount } = req.body;
    
    if (!db.users[telegramId]) {
      return res.status(404).json({ error: "User not found" });
    }
    
    if (!amount || amount <= 0) {
      return res.status(400).json({ error: "Invalid amount" });
    }
    
    if (db.users[telegramId].balance < amount) {
      return res.status(400).json({ error: "Insufficient balance" });
    }
    
    db.users[telegramId].balance -= amount;
    
    console.log(`💰 Subtracted ${amount} from user ${telegramId}, new balance: ${db.users[telegramId].balance}`);
    res.json({ 
      success: true, 
      newBalance: db.users[telegramId].balance 
    });
    
  } catch (error) {
    console.error("Balance subtract error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// --- Debug ---
app.get("/debug", (req, res) => {
  res.json({
    usersCount: Object.keys(db.users).length,
    cartsCount: Object.keys(db.carts).length,
    memoryUsage: process.memoryUsage(),
    uptime: process.uptime()
  });
});

// --- Start server ---
app.listen(PORT, () => {
  console.log(`⚓️ Backend running on port ${PORT}`);
  console.log(`📍 Health check: http://localhost:${PORT}/health`);
});

// Добавьте эти endpoints после существующих

// Сохранить всю корзину
app.post("/cart/save", (req, res) => {
  try {
    const { telegramId, cart, totalPrice } = req.body;
    
    if (!telegramId) {
      return res.status(400).json({ error: "Missing telegramId" });
    }

    // Убедимся что пользователь существует
    if (!db.users[telegramId]) {
      return res.status(404).json({ error: "User not found" });
    }

    // Сохраняем всю корзину
    db.carts[telegramId] = cart || [];
    
    console.log(`💾 Cart saved for user ${telegramId}, items: ${cart ? cart.length : 0}`);
    res.json({ success: true, message: "Cart saved successfully" });
    
  } catch (error) {
    console.error("Error saving cart:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Очистить корзину
app.post("/cart/clear", (req, res) => {
  try {
    const { telegramId } = req.body;
    
    if (!telegramId) {
      return res.status(400).json({ error: "Missing telegramId" });
    }

    db.carts[telegramId] = [];
    
    console.log(`🗑️ Cart cleared for user ${telegramId}`);
    res.json({ success: true, message: "Cart cleared successfully" });
    
  } catch (error) {
    console.error("Error clearing cart:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Создать заказ
app.post("/orders", (req, res) => {
  try {
    const { telegramId, items, total, status } = req.body;
    
    if (!telegramId) {
      return res.status(400).json({ error: "Missing telegramId" });
    }

    const orderId = Date.now().toString();
    
    db.orders[orderId] = {
      orderId,
      telegramId,
      items: items || [],
      total: total || 0,
      status: status || "completed",
      orderDate: new Date().toISOString()
    };
    
    console.log(`✅ Order created: ${orderId} for user ${telegramId}, total: ${total}`);
    res.json({ success: true, orderId });
    
  } catch (error) {
    console.error("Order creation error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});
