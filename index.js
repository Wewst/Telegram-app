const express = require("express");
const cors = require("cors");
const helmet = require("helmet");

const app = express();
const PORT = process.env.PORT || 3001;

// In-memory database
let db = {
  users: {},
  carts: {},
  orders: {}
};

// --- Middlewares ---
app.use(cors({
  origin: "*",
  methods: ["GET", "POST", "DELETE", "PUT"],
  allowedHeaders: ["Content-Type", "Authorization"]
}));

app.use(helmet());
app.use(express.json({ limit: "2mb" }));

// Простое логирование
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} ${req.method} ${req.path}`);
  
  // Только для POST/PUT запросов логируем body
  if (['POST', 'PUT'].includes(req.method) && req.body && Object.keys(req.body).length > 0) {
    console.log('Request body:', JSON.stringify(req.body));
  }
  
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
    
    console.log("User saved:", db.users[telegramId]);
    res.json(db.users[telegramId]);
    
  } catch (error) {
    console.error("Error saving user:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// --- Cart ---
app.post("/cart", (req, res) => {
  try {
    const item = req.body || {};
    const telegramId = String(item.telegramId || item.userId || "");
    
    console.log("📥 CART POST REQUEST:", item);
    
    if (!telegramId) {
      return res.status(400).json({ error: "Missing telegramId" });
    }

    if (!db.users[telegramId]) {
      return res.status(404).json({ error: "User not found" });
    }

    db.carts[telegramId] = db.carts[telegramId] || [];
    
    const existingItemIndex = db.carts[telegramId].findIndex(
      x => String(x.productId) === String(item.productId)
    );

    if (existingItemIndex >= 0) {
      db.carts[telegramId][existingItemIndex].quantity += item.quantity || 1;
      console.log("🛒 CART ITEM UPDATED:", {
        user: telegramId,
        productId: item.productId,
        name: db.carts[telegramId][existingItemIndex].name,
        price: db.carts[telegramId][existingItemIndex].price,
        quantity: db.carts[telegramId][existingItemIndex].quantity
      });
    } else {
      const newItem = {
        productId: item.productId,
        name: item.name || "Unknown Product",
        price: item.price || 0,
        quantity: item.quantity || 1,
        image: item.image || null,
        addedAt: new Date().toISOString()
      };
      db.carts[telegramId].push(newItem);
      console.log("🛒 NEW CART ITEM ADDED:", {
        user: telegramId,
        productId: newItem.productId,
        name: newItem.name,
        price: newItem.price,
        quantity: newItem.quantity
      });
    }

    // Логируем всю корзину после изменения
    console.log("📊 FULL CART AFTER UPDATE:", {
      user: telegramId,
      totalItems: db.carts[telegramId].length,
      items: db.carts[telegramId].map(item => ({
        productId: item.productId,
        name: item.name,
        price: item.price,
        quantity: item.quantity
      }))
    });
    
    res.json({ success: true, message: "Item added to cart" });
    
  } catch (error) {
    console.error("❌ CART ERROR:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.get("/cart/:telegramId", (req, res) => {
  try {
    const telegramId = String(req.params.telegramId);
    const cartItems = db.carts[telegramId] || [];
    
    console.log("📦 CART LOADED:", {
      user: telegramId,
      itemCount: cartItems.length,
      items: cartItems.map(item => ({
        productId: item.productId,
        name: item.name,
        price: item.price,
        quantity: item.quantity
      }))
    });
    
    res.json(cartItems);
    
  } catch (error) {
    console.error("❌ CART LOAD ERROR:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Удалить товар из корзины
app.post("/cart/remove", (req, res) => {
  try {
    const { telegramId, productId } = req.body;
    
    console.log("📥 REMOVE ITEM REQUEST:", { telegramId, productId });
    
    if (!telegramId || !productId) {
      return res.status(400).json({ error: "Missing telegramId or productId" });
    }

    if (!db.users[telegramId]) {
      return res.status(404).json({ error: "User not found" });
    }

    db.carts[telegramId] = db.carts[telegramId] || [];
    
    // Находим товар для логирования перед удалением
    const itemToRemove = db.carts[telegramId].find(
      item => String(item.productId) === String(productId)
    );
    
    // Удаляем товар из корзины
    db.carts[telegramId] = db.carts[telegramId].filter(
      item => String(item.productId) !== String(productId)
    );
    
    if (itemToRemove) {
      console.log("🗑️ REMOVED ITEM COMPLETELY:", {
        user: telegramId,
        productId: itemToRemove.productId,
        name: itemToRemove.name,
        price: itemToRemove.price
      });
    }
    
    res.json({ success: true, message: "Product removed from cart" });
    
  } catch (error) {
    console.error("Error removing from cart:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Очистить корзину
app.post("/cart/clear", (req, res) => {
  try {
    const { telegramId } = req.body;
    
    console.log("📥 CLEAR CART REQUEST for user:", telegramId);
    
    if (!telegramId) {
      return res.status(400).json({ error: "Missing telegramId" });
    }

    const cartItems = db.carts[telegramId] || [];
    console.log("🗑️ CLEARING CART:", {
      user: telegramId,
      itemsBeingRemoved: cartItems.length
    });
    
    db.carts[telegramId] = [];
    
    console.log("✅ CART CLEARED for user:", telegramId);
    res.json({ success: true, message: "Cart cleared successfully" });
    
  } catch (error) {
    console.error("Error clearing cart:", error);
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
    
    console.log("Balance added:", { user: telegramId, amount, newBalance: db.users[telegramId].balance });
    res.json({ success: true, newBalance: db.users[telegramId].balance });
    
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
    
    console.log("Balance subtracted:", { user: telegramId, amount, newBalance: db.users[telegramId].balance });
    res.json({ success: true, newBalance: db.users[telegramId].balance });
    
  } catch (error) {
    console.error("Balance subtract error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// --- Orders ---
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
    
    console.log("Order created:", { orderId, user: telegramId, total, itemsCount: items ? items.length : 0 });
    res.json({ success: true, orderId });
    
  } catch (error) {
    console.error("Order creation error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// --- Debug ---
app.get("/debug", (req, res) => {
  res.json({
    usersCount: Object.keys(db.users).length,
    cartsCount: Object.keys(db.carts).length,
    ordersCount: Object.keys(db.orders).length,
    memoryUsage: process.memoryUsage(),
    uptime: process.uptime()
  });
});

// --- Start server ---
app.listen(PORT, () => {
  console.log(`Backend running on port ${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/health`);
});
