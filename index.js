const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3001;

// --- PostgreSQL Connection ---
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://localhost:5432/telegram_app',
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Функция инициализации базы данных
async function initDatabase() {
  let retries = 5;
  
  while (retries > 0) {
    try {
      console.log("🔄 Attempting to connect to database...");
      
      // Создаем таблицы если они не существуют
      await pool.query(`
        CREATE TABLE IF NOT EXISTS users (
          id SERIAL PRIMARY KEY,
          telegram_id VARCHAR(255) UNIQUE NOT NULL,
          username VARCHAR(255),
          first_name VARCHAR(255),
          last_name VARCHAR(255),
          avatar_url TEXT,
          balance INTEGER DEFAULT 0,
          join_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS reviews (
          id SERIAL PRIMARY KEY,
          user_id VARCHAR(255) NOT NULL,
          author VARCHAR(255) NOT NULL,
          text TEXT NOT NULL,
          rating INTEGER DEFAULT 5,
          avatar_text VARCHAR(10),
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(user_id)
        );

        CREATE TABLE IF NOT EXISTS cart_items (
          id SERIAL PRIMARY KEY,
          telegram_id VARCHAR(255) NOT NULL,
          product_id VARCHAR(255) NOT NULL,
          name VARCHAR(255) NOT NULL,
          price INTEGER NOT NULL,
          quantity INTEGER DEFAULT 1,
          image TEXT,
          added_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(telegram_id, product_id)
        );

        CREATE TABLE IF NOT EXISTS orders (
          id SERIAL PRIMARY KEY,
          telegram_id VARCHAR(255) NOT NULL,
          total INTEGER NOT NULL,
          status VARCHAR(50) DEFAULT 'completed',
          order_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
      `);

      console.log("✅ Database tables initialized");
      return true;

    } catch (error) {
      console.error(`❌ Database initialization error (${retries} retries left):`, error.message);
      retries--;
      
      if (retries === 0) {
        console.error("❌ Failed to initialize database after multiple attempts");
        return false;
      }
      
      // Ждем перед повторной попыткой
      await new Promise(resolve => setTimeout(resolve, 3000));
    }
  }
}

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
  next();
});

// --- Health check ---
app.get("/health", async (req, res) => {
  try {
    // Проверяем подключение к базе
    await pool.query('SELECT 1');
    
    const usersCount = await pool.query('SELECT COUNT(*) FROM users');
    const reviewsCount = await pool.query('SELECT COUNT(*) FROM reviews');
    
    res.json({ 
      status: "ok", 
      message: "Telegram Mini App Backend with PostgreSQL is running!",
      users: parseInt(usersCount.rows[0].count),
      reviews: parseInt(reviewsCount.rows[0].count),
      timestamp: new Date().toISOString(),
      database: "connected"
    });
  } catch (error) {
    res.status(500).json({ 
      error: "Database error",
      details: error.message,
      database: "disconnected"
    });
  }
});

// --- Users ---
app.post("/users", async (req, res) => {
  try {
    const userData = req.body || {};
    const telegramId = String(userData.telegramId || userData.id || "");
    
    if (!telegramId) {
      return res.status(400).json({ error: "Missing telegramId" });
    }

    const result = await pool.query(`
      INSERT INTO users (telegram_id, username, first_name, last_name, avatar_url, balance)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (telegram_id) 
      DO UPDATE SET 
        username = EXCLUDED.username,
        first_name = EXCLUDED.first_name,
        last_name = EXCLUDED.last_name,
        avatar_url = EXCLUDED.avatar_url,
        balance = EXCLUDED.balance,
        updated_at = CURRENT_TIMESTAMP
      RETURNING *
    `, [
      telegramId,
      userData.username || "",
      userData.firstName || "",
      userData.lastName || "",
      userData.avatarUrl || null,
      userData.balance || 0
    ]);

    res.json(result.rows[0]);
    
  } catch (error) {
    console.error("Error saving user:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Получить баланс пользователя
app.get("/users/:telegramId/balance", async (req, res) => {
  try {
    const telegramId = String(req.params.telegramId);
    
    const result = await pool.query(
      'SELECT balance FROM users WHERE telegram_id = $1', 
      [telegramId]
    );

    if (result.rows.length === 0) {
      return res.json({ balance: 0 });
    }

    res.json({ balance: result.rows[0].balance });
    
  } catch (error) {
    console.error("Balance fetch error:", error);
    res.status(500).json({ error: "Internal server error", balance: 0 });
  }
});

// --- Cart ---
app.post("/cart", async (req, res) => {
  try {
    const item = req.body || {};
    const telegramId = String(item.telegramId || item.userId || "");
    
    console.log("🛒 CART UPDATE:", { 
      user: telegramId, 
      productId: item.productId,
      action: "ADD/UPDATE"
    });
    
    if (!telegramId) {
      return res.status(400).json({ error: "Missing telegramId" });
    }

    await pool.query(`
      INSERT INTO cart_items (telegram_id, product_id, name, price, quantity, image)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (telegram_id, product_id) 
      DO UPDATE SET 
        quantity = cart_items.quantity + EXCLUDED.quantity,
        added_at = CURRENT_TIMESTAMP
    `, [
      telegramId,
      item.productId,
      item.name || "Unknown Product",
      item.price || 0,
      item.quantity || 1,
      item.image || null
    ]);
    
    res.json({ success: true, message: "Item added to cart" });
    
  } catch (error) {
    console.error("❌ CART ERROR:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.get("/cart/:telegramId", async (req, res) => {
  try {
    const telegramId = String(req.params.telegramId);
    
    const result = await pool.query(
      'SELECT * FROM cart_items WHERE telegram_id = $1 ORDER BY added_at DESC',
      [telegramId]
    );
    
    res.json(result.rows);
    
  } catch (error) {
    console.error("❌ CART LOAD ERROR:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Удалить товар из корзины
app.post("/cart/remove", async (req, res) => {
  try {
    const { telegramId, productId } = req.body;
    
    if (!telegramId || !productId) {
      return res.status(400).json({ error: "Missing telegramId or productId" });
    }

    await pool.query(
      'DELETE FROM cart_items WHERE telegram_id = $1 AND product_id = $2',
      [telegramId, productId]
    );
    
    res.json({ success: true, message: "Product removed from cart" });
    
  } catch (error) {
    console.error("Error removing from cart:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Очистить корзину
app.post("/cart/clear", async (req, res) => {
  try {
    const { telegramId } = req.body;
    
    if (!telegramId) {
      return res.status(400).json({ error: "Missing telegramId" });
    }

    await pool.query(
      'DELETE FROM cart_items WHERE telegram_id = $1',
      [telegramId]
    );
    
    res.json({ success: true, message: "Cart cleared successfully" });
    
  } catch (error) {
    console.error("Error clearing cart:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// --- Balance operations ---
app.post("/users/:telegramId/balance/add", async (req, res) => {
  try {
    const telegramId = String(req.params.telegramId);
    const { amount } = req.body;
    
    if (!amount || amount <= 0) {
      return res.status(400).json({ error: "Invalid amount" });
    }
    
    await pool.query(`
      INSERT INTO users (telegram_id, balance)
      VALUES ($1, $2)
      ON CONFLICT (telegram_id) 
      DO UPDATE SET 
        balance = users.balance + EXCLUDED.balance,
        updated_at = CURRENT_TIMESTAMP
    `, [telegramId, amount]);
    
    const result = await pool.query(
      'SELECT balance FROM users WHERE telegram_id = $1',
      [telegramId]
    );
    
    res.json({ newBalance: result.rows[0]?.balance || 0 });
    
  } catch (error) {
    console.error("Balance add error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.post("/users/:telegramId/balance/subtract", async (req, res) => {
  try {
    const telegramId = String(req.params.telegramId);
    const { amount } = req.body;
    
    if (!amount || amount <= 0) {
      return res.status(400).json({ error: "Invalid amount" });
    }
    
    const result = await pool.query(
      'SELECT balance FROM users WHERE telegram_id = $1',
      [telegramId]
    );
    
    if (result.rows.length === 0 || result.rows[0].balance < amount) {
      return res.status(400).json({ error: "Insufficient balance" });
    }
    
    await pool.query(
      'UPDATE users SET balance = balance - $1, updated_at = CURRENT_TIMESTAMP WHERE telegram_id = $2',
      [amount, telegramId]
    );
    
    const newBalanceResult = await pool.query(
      'SELECT balance FROM users WHERE telegram_id = $1',
      [telegramId]
    );
    
    res.json({ success: true, newBalance: newBalanceResult.rows[0].balance });
    
  } catch (error) {
    console.error("Balance subtract error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// --- Reviews ---
app.post("/reviews", async (req, res) => {
  try {
    const reviewData = req.body || {};
    const telegramId = String(reviewData.userId || reviewData.telegramId || "");
    
    if (!telegramId) {
      return res.status(400).json({ error: "User ID is required" });
    }
    
    if (!reviewData.text || reviewData.text.trim().length < 5) {
      return res.status(400).json({ error: "Review text must be at least 5 characters" });
    }

    const existingReview = await pool.query(
      'SELECT * FROM reviews WHERE user_id = $1',
      [telegramId]
    );

    if (existingReview.rows.length > 0) {
      return res.status(400).json({ error: "User has already submitted a review" });
    }

    const result = await pool.query(`
      INSERT INTO reviews (user_id, author, text, rating, avatar_text)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *
    `, [
      telegramId,
      reviewData.author || "User_" + telegramId.slice(-4),
      reviewData.text.trim(),
      reviewData.rating || 5,
      (reviewData.author || "U").charAt(0).toUpperCase()
    ]);

    console.log("📝 NEW REVIEW ADDED:", { user: telegramId });
    res.json({ success: true, review: result.rows[0] });

  } catch (error) {
    console.error("❌ REVIEW ERROR:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.get("/reviews", async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const offset = (page - 1) * limit;

    const reviewsResult = await pool.query(
      'SELECT * FROM reviews ORDER BY created_at DESC LIMIT $1 OFFSET $2',
      [limit, offset]
    );

    const countResult = await pool.query('SELECT COUNT(*) FROM reviews');

    res.json({
      reviews: reviewsResult.rows,
      total: parseInt(countResult.rows[0].count),
      page,
      totalPages: Math.ceil(parseInt(countResult.rows[0].count) / limit)
    });

  } catch (error) {
    console.error("❌ REVIEWS LOAD ERROR:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.get("/reviews/user/:telegramId", async (req, res) => {
  try {
    const telegramId = String(req.params.telegramId);
    
    const result = await pool.query(
      'SELECT * FROM reviews WHERE user_id = $1',
      [telegramId]
    );

    res.json({ hasReviewed: result.rows.length > 0 });

  } catch (error) {
    console.error("❌ USER REVIEW CHECK ERROR:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// --- Orders ---
app.post("/orders", async (req, res) => {
  try {
    const { telegramId, items, total, status } = req.body;
    
    if (!telegramId) {
      return res.status(400).json({ error: "Missing telegramId" });
    }

    const result = await pool.query(`
      INSERT INTO orders (telegram_id, total, status)
      VALUES ($1, $2, $3)
      RETURNING id
    `, [telegramId, total || 0, status || "completed"]);

    res.json({ success: true, orderId: result.rows[0].id });
    
  } catch (error) {
    console.error("Order creation error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// --- Debug ---
app.get("/debug", async (req, res) => {
  try {
    const usersCount = await pool.query('SELECT COUNT(*) FROM users');
    const cartsCount = await pool.query('SELECT COUNT(*) FROM cart_items');
    const ordersCount = await pool.query('SELECT COUNT(*) FROM orders');
    const reviewsCount = await pool.query('SELECT COUNT(*) FROM reviews');

    res.json({
      usersCount: parseInt(usersCount.rows[0].count),
      cartsCount: parseInt(cartsCount.rows[0].count),
      ordersCount: parseInt(ordersCount.rows[0].count),
      reviewsCount: parseInt(reviewsCount.rows[0].count),
      uptime: process.uptime()
    });
  } catch (error) {
    res.status(500).json({ error: "Database error" });
  }
});

// Принудительная инициализация базы
app.get("/force-init", async (req, res) => {
  try {
    await initDatabase();
    res.json({ success: true, message: "Database initialized" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// --- Start server ---
async function startServer() {
  try {
    console.log("🔧 Initializing database...");
    
    const dbInitialized = await initDatabase();
    
    if (!dbInitialized) {
      console.error("❌ Critical: Database initialization failed");
      process.exit(1);
    }
    
    app.listen(PORT, () => {
      console.log(`🚀 Backend running on port ${PORT}`);
      console.log(`🏥 Health check: http://localhost:${PORT}/health`);
      console.log(`💾 Connected to PostgreSQL`);
    });
    
  } catch (error) {
    console.error("❌ Failed to start server:", error);
    process.exit(1);
  }
}

// Проверяем переменные окружения
console.log("🔍 Environment check:");
console.log("PORT:", process.env.PORT);
console.log("DATABASE_URL:", process.env.DATABASE_URL ? "✅ Set" : "❌ Not set");
console.log("NODE_ENV:", process.env.NODE_ENV);

startServer();
