const express = require("express");
const cors = require("cors");

const app = express();
const PORT = process.env.PORT || 3001;

// Максимально простой CORS
app.use(cors({
  origin: "*",
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  credentials: true
}));

app.use(express.json());

// Простейшая in-memory база
let db = {
  users: {},
  carts: {},
  reviews: []
};

// 📍 Health check
app.get("/health", (req, res) => {
  res.json({ status: "OK", message: "Backend is working!" });
});

// 📍 Сохранение пользователя (УПРОЩЕННЫЙ)
app.post("/users", (req, res) => {
  try {
    console.log("📍 /users called with:", req.body);
    
    const userData = req.body;
    const telegramId = String(`userData.telegramId  userData.id  "unknown"`);
    
    if (!telegramId) {
      return res.status(400).json({ error: "No telegramId" });
    }

    // Просто сохраняем что прислали
    db.users[telegramId] = {
      ...userData,
      id: telegramId,
      telegramId: telegramId,
      updatedAt: new Date().toISOString()
    };

    console.log("✅ User saved:", telegramId);
    res.json(db.users[telegramId]);

  } catch (error) {
    console.error("❌ Users error:", error);
    res.status(500).json({ error: "Server error" });
  }
});

// 📍 Добавление в корзину (УПРОЩЕННЫЙ)
app.post("/cart", (req, res) => {
  try {
    console.log("📍 /cart called with:", req.body);
    
    const item = req.body;
    const telegramId = String(item.telegramId || "unknown");
    
    if (!telegramId) {
      return res.status(400).json({ error: "No telegramId" });
    }

    // Инициализируем корзину если нет
    if (!db.carts[telegramId]) {
      db.carts[telegramId] = [];
    }

    // Просто добавляем item как есть
    db.carts[telegramId].push({
      ...item,
      addedAt: new Date().toISOString()
    });

    console.log("✅ Cart item added for:", telegramId);
    res.json({ success: true, message: "Item added" });

  } catch (error) {
    console.error("❌ Cart error:", error);
    res.status(500).json({ error: "Server error" });
  }
});

// 📍 Получение корзины
app.get("/cart/:telegramId", (req, res) => {
  try {
    const telegramId = req.params.telegramId;
    console.log("📍 GET /cart for:", telegramId);
    
    const cartItems = db.carts[telegramId] || [];
    res.json(cartItems);

  } catch (error) {
    console.error("❌ Get cart error:", error);
    res.status(500).json({ error: "Server error" });
  }
});

// 📍 Отзывы
app.post("/reviews", (req, res) => {
  try {
    console.log("📍 /reviews called with:", req.body);
    
    const review = req.body;
    if (!review.text) {
      return res.status(400).json({ error: "No text" });
    }

    const newReview = {
      id: Date.now(),
      ...review,
      date: new Date().toLocaleDateString('ru-RU')
    };

    db.reviews.push(newReview);
    res.json({ success: true, review: newReview });

  } catch (error) {
    console.error("❌ Reviews error:", error);
    res.status(500).json({ error: "Server error" });
  }
});

app.get("/reviews", (req, res) => {
  res.json(db.reviews);
});

// 📍 Баланс
app.get("/users/:telegramId/balance", (req, res) => {
  const telegramId = req.params.telegramId;
  const user = db.users[telegramId];
  res.json({ balance: user ? (user.balance || 0) : 0 });
});

app.listen(PORT, () => {
  console.log(`🚀 Simple backend running on port ${PORT}`);
  console.log(`🔗 Health check: http://localhost:${PORT}/health`);
});
