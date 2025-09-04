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

// --- Cart Endpoints ---

// Добавить товар в корзину или обновить количество
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
      // Если передано отрицательное quantity - уменьшаем
      if (item.quantity < 0) {
        db.carts[telegramId][existingItemIndex].quantity += item.quantity;
        if (db.carts[telegramId][existingItemIndex].quantity <= 0) {
          // Если количество стало 0 или меньше - удаляем товар
          db.carts[telegramId].splice(existingItemIndex, 1);
        }
      } else {
        // Увеличиваем количество
        db.carts[telegramId][existingItemIndex].quantity += item.quantity || 1;
      }
    } else {
      // Добавляем новый товар только если quantity положительное
      if (item.quantity > 0) {
        db.carts[telegramId].push({
          productId: item.productId,
          name: item.name || "Unknown Product",
          price: item.price || 0,
          quantity: item.quantity || 1,
          image: item.image || null,
          addedAt: new Date().toISOString()
        });
      }
    }
    
    console.log(`🛒 Cart updated for user ${telegramId}`);
    res.json({ success: true, message: "Cart updated" });
    
  } catch (error) {
    console.error("Error saving cart:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Получить корзину пользователя
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

// Удалить товар из корзины
app.post("/cart/remove", (req, res) => {
  try {
    const { telegramId, productId } = req.body;
    
    if (!telegramId || !productId) {
      return res.status(400).json({ error: "Missing telegramId or productId" });
    }

    if (!db.users[telegramId]) {
      return res.status(404).json({ error: "User not found" });
    }

    db.carts[telegramId] = db.carts[telegramId] || [];
    
    // Удаляем товар из корзины
    const initialLength = db.carts[telegramId].length;
    db.carts[telegramId] = db.carts[telegramId].filter(
      item => String(item.productId) !== String(productId)
    );
    
    console.log(`🗑️ Removed product ${productId} from user ${telegramId}`);
    res.json({ 
      success: true, 
      message: "Product removed from cart"
    });
    
  } catch (error) {
    console.error("Error removing from cart:", error);
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
    
    console.log(`✅ Order created: ${orderId} for user ${telegramId}, total: ${total}`);
    res.json({ success: true, orderId });
    
  } catch (error) {
    console.error("Order creation error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Получить заказы пользователя
app.get("/orders/:telegramId", (req, res) => {
  try {
    const telegramId = String(req.params.telegramId);
    const userOrders = Object.values(db.orders).filter(order => order.telegramId === telegramId);
    
    res.json(userOrders);
    
  } catch (error) {
    console.error("Orders load error:", error);
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

// Получить информацию о пользователе
app.get("/users/:telegramId", (req, res) => {
  try {
    const telegramId = String(req.params.telegramId);
    const user = db.users[telegramId];
    
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }
    
    res.json(user);
    
  } catch (error) {
    console.error("User load error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// --- Start server ---
app.listen(PORT, () => {
  console.log(`⚓️ Backend running on port ${PORT}`);
  console.log(`📍 Health check: http://localhost:${PORT}/health`);
  console.log(`🛒 Available cart endpoints:`);
  console.log(`   POST /cart - Add/update item`);
  console.log(`   GET /cart/:telegramId - Get user's cart`);
  console.log(`   POST /cart/remove - Remove item`);
  console.log(`   POST /cart/clear - Clear cart`);
});
