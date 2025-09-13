const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3001;

// In-memory database
let db = {
  users: {},
  carts: {},
  orders: {},
  reviews: [] // Добавляем хранилище для отзывов
};

// Функции для сохранения/загрузки базы данных
function saveDB() {
  try {
    fs.writeFileSync("db_backup.json", JSON.stringify(db, null, 2));
    console.log("💾 Database backup saved");
  } catch (error) {
    console.error("❌ Error saving database:", error);
  }
}

function loadDB() {
  try {
    if (fs.existsSync("db_backup.json")) {
      const data = fs.readFileSync("db_backup.json", "utf8");
      db = JSON.parse(data);
      console.log("💾 Database loaded from backup");
    }
  } catch (error) {
    console.log("ℹ️ No existing DB found, starting fresh");
  }
}

// Загружаем базу при старте
loadDB();

// Автосохранение каждые 30 секунд
setInterval(saveDB, 30000);

// --- CORS Middleware ---
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
  next();
});

app.use(
  cors({
    origin: "*",
    methods: ["GET", "POST", "DELETE", "PUT", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
    credentials: true,
    preflightContinue: false,
    optionsSuccessStatus: 204,
  })
);

app.options("*", cors());

app.use(helmet());
app.use(express.json({ limit: "2mb" }));

// Простое логирование
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} ${req.method} ${req.path}`);
  if (["POST", "PUT"].includes(req.method) && req.body) {
    console.log("Request body:", JSON.stringify(req.body));
  }
  next();
});

// --- Health check ---
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    message: "Telegram Mini App Backend is running!",
    timestamp: new Date().toISOString(),
    reviewsCount: db.reviews.length,
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
        balance:
          userData.balance !== undefined ? userData.balance : existingUser.balance,
        username: userData.username || existingUser.username,
        firstName: userData.firstName || existingUser.firstName,
        lastName: userData.lastName || existingUser.lastName,
        avatarUrl: userData.avatarUrl || existingUser.avatarUrl,
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
        balance: userData.balance !== undefined ? userData.balance : 0,
      };
    }

    console.log("User saved:", db.users[telegramId]);
    res.json(db.users[telegramId]);
  } catch (error) {
    console.error("Error saving user:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Получить баланс пользователя
app.get("/users/:telegramId/balance", (req, res) => {
  try {
    const telegramId = String(req.params.telegramId);
    const user = db.users[telegramId];

    if (!user) {
      return res.status(404).json({ error: "User not found", balance: 0 });
    }

    res.json({ balance: user.balance || 0 });
  } catch (error) {
    console.error("Balance fetch error:", error);
    res.status(500).json({ error: "Internal server error", balance: 0 });
  }
});

// --- Cart ---
// Добавить товар
app.post("/cart", (req, res) => {
  try {
    const item = req.body || {};
    const telegramId = String(item.telegramId || item.userId || "");

    if (!telegramId) {
      return res.status(400).json({ error: "Missing telegramId" });
    }

    if (!db.users[telegramId]) {
      return res.status(404).json({ error: "User not found" });
    }

    db.carts[telegramId] = db.carts[telegramId] || [];

    const existingItemIndex = db.carts[telegramId].findIndex(
      (x) => String(x.productId) === String(item.productId)
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
        addedAt: new Date().toISOString(),
      });
    }

    return res.json(db.carts[telegramId]);
  } catch (error) {
    console.error("❌ CART ERROR:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Получить корзину
app.get("/cart/:telegramId", (req, res) => {
  try {
    const telegramId = String(req.params.telegramId);
    const cartItems = db.carts[telegramId] || [];
    res.json(cartItems);
  } catch (error) {
    console.error("❌ CART LOAD ERROR:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Удалить товар
app.post("/cart/remove", (req, res) => {
  try {
    const { telegramId, productId } = req.body;

    if (!telegramId || !productId) {
      return res.status(400).json({ error: "Missing telegramId or productId" });
    }

    db.carts[telegramId] = db.carts[telegramId] || [];
    db.carts[telegramId] = db.carts[telegramId].filter(
      (item) => String(item.productId) !== String(productId)
    );

    return res.json(db.carts[telegramId]);
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
    return res.json(db.carts[telegramId]);
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
      db.users[telegramId] = {
        telegramId: telegramId,
        balance: 0,
        createdAt: new Date().toISOString(),
      };
    }

    if (!amount || amount <= 0) {
      return res.status(400).json({ error: "Invalid amount" });
    }

    const currentBalance = db.users[telegramId].balance || 0;
    const newBalance = currentBalance + (parseFloat(amount) || 0);

    db.users[telegramId].balance = newBalance;
    db.users[telegramId].updatedAt = new Date().toISOString();

    console.log("💰 BALANCE ADDED:", { telegramId, amount, newBalance });
    res.json({ newBalance });
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

    console.log("Balance subtracted:", {
      user: telegramId,
      amount,
      newBalance: db.users[telegramId].balance,
    });
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
      orderDate: new Date().toISOString(),
    };

    console.log("Order created:", {
      orderId,
      user: telegramId,
      total,
      itemsCount: items ? items.length : 0,
    });
    res.json({ success: true, orderId });
  } catch (error) {
    console.error("Order creation error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// --- Reviews ---
app.post("/reviews", (req, res) => {
  try {
    const reviewData = req.body || {};
    const telegramId = String(reviewData.userId || reviewData.telegramId || "");

    if (!telegramId) {
      return res.status(400).json({ error: "User ID is required" });
    }

    if (!reviewData.text || reviewData.text.trim().length < 5) {
      return res
        .status(400)
        .json({ error: "Review text must be at least 5 characters" });
    }

    const existingReviewIndex = db.reviews.findIndex(
      (review) => review.userId === telegramId
    );
    if (existingReviewIndex >= 0) {
      return res.status(400).json({ error: "User has already submitted a review" });
    }

    const newReview = {
      id: Date.now().toString(),
      userId: telegramId,
      author: reviewData.author || "User_" + telegramId.slice(-4),
      text: reviewData.text.trim(),
      rating: reviewData.rating || 5,
      date: new Date().toLocaleDateString("ru-RU"),
      timestamp: Date.now(),
      avatarText: (reviewData.author || "U").charAt(0).toUpperCase(),
    };

    db.reviews.unshift(newReview);
    res.json({ success: true, review: newReview });
  } catch (error) {
    console.error("❌ REVIEW ERROR:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.get("/reviews", (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;

    const sortedReviews = db.reviews.sort((a, b) => b.timestamp - a.timestamp);

    const startIndex = (page - 1) * limit;
    const endIndex = startIndex + limit;
    const paginatedReviews = sortedReviews.slice(startIndex, endIndex);

    res.json({
      reviews: paginatedReviews,
      total: db.reviews.length,
      page,
      totalPages: Math.ceil(db.reviews.length / limit),
    });
  } catch (error) {
    console.error("❌ REVIEWS LOAD ERROR:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.get("/reviews/user/:telegramId", (req, res) => {
  try {
    const telegramId = String(req.params.telegramId);
    const userReview = db.reviews.find((review) => review.userId === telegramId);
    res.json({ hasReviewed: !!userReview });
  } catch (error) {
    console.error("❌ USER REVIEW CHECK ERROR:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// --- Debug ---
app.get("/debug", (req, res) => {
  res.json({
    usersCount: Object.keys(db.users).length,
    cartsCount: Object.keys(db.carts).length,
    ordersCount: Object.keys(db.orders).length,
    reviewsCount: db.reviews.length,
    memoryUsage: process.memoryUsage(),
    uptime: process.uptime(),
  });
});

// --- Start server ---
app.listen(PORT, () => {
  console.log(`✅ Backend running on port ${PORT}`);
  console.log(`➡️ Health check: http://localhost:${PORT}/health`);
  console.log(`➡️ Reviews API: http://localhost:${PORT}/reviews`);
});
