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
  reviews: [],
  payments: [] // Новая коллекция для платежей
};

// Функции для сохранения/загрузки базы данных
function saveDB() {
  try {
    fs.writeFileSync('db_backup.json', JSON.stringify(db, null, 2));
    console.log("💾 Database backup saved");
  } catch (error) {
    console.error("❌ Error saving database:", error);
  }
}

function loadDB() {
  try {
    if (fs.existsSync('db_backup.json')) {
      const data = fs.readFileSync('db_backup.json', 'utf8');
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

// ===== ПРАВИЛЬНЫЕ CORS НАСТРОЙКИ =====
app.use(cors({
  origin: "*",
  methods: ["GET", "POST", "DELETE", "PUT", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With", "Accept"],
  credentials: true,
  preflightContinue: false,
  optionsSuccessStatus: 204
}));

app.options('*', cors());
app.use(helmet());
app.use(express.json({ limit: "2mb" }));

// Простое логирование
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} ${req.method} ${req.path}`);
  
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
    timestamp: new Date().toISOString(),
    reviewsCount: db.reviews.length,
    usersCount: Object.keys(db.users).length,
    cartsCount: Object.keys(db.carts).length,
    paymentsCount: db.payments.length
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
        avatarUrl: userData.avatarUrl || existingUser.avatarUrl,
        updatedAt: new Date().toISOString()
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
        createdAt: new Date().toISOString()
      };
    }
    
    console.log("✅ User saved:", telegramId);
    res.json(db.users[telegramId]);
    
  } catch (error) {
    console.error("❌ Error saving user:", error);
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

    res.json({ 
      success: true,
      balance: user.balance || 0 
    });
    
  } catch (error) {
    console.error("❌ Balance fetch error:", error);
    res.status(500).json({ error: "Internal server error", balance: 0 });
  }
});

// ===== НОВАЯ СИСТЕМА ПОПОЛНЕНИЯ ЧЕРЕЗ СБП =====

// 1. Создание запроса на пополнение
app.post("/payments/create", (req, res) => {
  try {
    const { telegramId, amount, bank } = req.body;
    
    if (!telegramId || !amount || amount < 10) {
      return res.status(400).json({ 
        success: false, 
        error: "Invalid parameters. Minimum amount: 10" 
      });
    }

    // Создаем пользователя если не существует
    if (!db.users[telegramId]) {
      db.users[telegramId] = {
        telegramId: telegramId,
        balance: 0,
        createdAt: new Date().toISOString()
      };
    }

    const paymentId = Date.now().toString();
    const payment = {
      id: paymentId,
      telegramId: telegramId,
      amount: Number(amount),
      bank: bank || 'other',
      status: 'pending', // pending, completed, failed, expired
      receiverCard: '2200702019610646', // Ваша карта
      comment: `FollenShaid ID:${telegramId}`, // Комментарий для отслеживания
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString() // 10 минут
    };

    db.payments.push(payment);
    
    console.log("💰 Payment request created:", { 
      paymentId, telegramId, amount, bank 
    });

    res.json({
      success: true,
      paymentId: paymentId,
      payment: payment,
      message: "Запрос на пополнение создан"
    });

  } catch (error) {
    console.error("❌ Payment creation error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// 2. Проверка статуса платежа (фронтенд опрашивает этот endpoint)
app.post("/payments/check", (req, res) => {
  try {
    const { telegramId, amount, timestamp } = req.body;
    
    if (!telegramId) {
      return res.status(400).json({ 
        success: false, 
        error: "Missing telegramId",
        verified: false 
      });
    }

    // Ищем платежи пользователя за последние 10 минут
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
    
    const userPayments = db.payments.filter(payment => 
      payment.telegramId === telegramId && 
      new Date(payment.createdAt) >= tenMinutesAgo
    );

    // Проверяем есть ли завершенный платеж с указанной суммой
    const completedPayment = userPayments.find(payment => 
      payment.status === 'completed' && 
      payment.amount === Number(amount)
    );

    if (completedPayment) {
      console.log("✅ Payment verified:", { 
        telegramId, amount, paymentId: completedPayment.id 
      });
      
      // Зачисляем средства на баланс
      if (db.users[telegramId]) {
        db.users[telegramId].balance += Number(amount);
        db.users[telegramId].updatedAt = new Date().toISOString();
        
        // Помечаем платеж как обработанный
        completedPayment.processed = true;
        completedPayment.processedAt = new Date().toISOString();
        
        console.log("💰 Balance updated:", {
          telegramId, 
          amount, 
          newBalance: db.users[telegramId].balance 
        });
      }

      return res.json({ 
        success: true, 
        verified: true,
        paymentId: completedPayment.id,
        newBalance: db.users[telegramId] ? db.users[telegramId].balance : 0
      });
    }

    // Проверяем есть ли просроченные платежи
    const now = new Date();
    userPayments.forEach(payment => {
      if (payment.status === 'pending' && new Date(payment.expiresAt) < now) {
        payment.status = 'expired';
        console.log("⏰ Payment expired:", payment.id);
      }
    });

    res.json({ 
      success: true, 
      verified: false,
      message: "Платеж не найден или еще обрабатывается"
    });

  } catch (error) {
    console.error("❌ Payment check error:", error);
    res.status(500).json({ 
      success: false, 
      error: "Internal server error",
      verified: false 
    });
  }
});

// 3. Ручное подтверждение платежа (для админа или автоматической проверки)
app.post("/payments/confirm", (req, res) => {
  try {
    const { paymentId, amount, receiverCard, comment } = req.body;
    
    // Ищем платеж по ID или параметрам
    let payment;
    
    if (paymentId) {
      payment = db.payments.find(p => p.id === paymentId);
    } else if (amount && receiverCard) {
      // Ищем по сумме и карте получателя (для автоматического подтверждения)
      payment = db.payments.find(p => 
        p.amount === Number(amount) && 
        p.receiverCard === receiverCard &&
        p.status === 'pending'
      );
      
      // Дополнительная проверка по комментарию если есть
      if (comment && payment) {
        if (!payment.comment.includes(comment)) {
          payment = null;
        }
      }
    }

    if (!payment) {
      return res.status(404).json({ 
        success: false, 
        error: "Payment not found" 
      });
    }

    if (payment.status !== 'pending') {
      return res.status(400).json({ 
        success: false, 
        error: `Payment already ${payment.status}` 
      });
    }

    // Обновляем статус платежа
    payment.status = 'completed';
    payment.completedAt = new Date().toISOString();
    
    // Зачисляем средства на баланс
    if (db.users[payment.telegramId]) {
      db.users[payment.telegramId].balance += payment.amount;
      db.users[payment.telegramId].updatedAt = new Date().toISOString();
    }

    console.log("✅ Payment confirmed:", { 
      paymentId: payment.id, 
      telegramId: payment.telegramId,
      amount: payment.amount 
    });

    res.json({
      success: true,
      payment: payment,
      newBalance: db.users[payment.telegramId] ? db.users[payment.telegramId].balance : 0
    });

  } catch (error) {
    console.error("❌ Payment confirmation error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// 4. Получить историю платежей пользователя
app.get("/payments/user/:telegramId", (req, res) => {
  try {
    const telegramId = String(req.params.telegramId);
    const limit = parseInt(req.query.limit) || 10;
    
    const userPayments = db.payments
      .filter(payment => payment.telegramId === telegramId)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .slice(0, limit);

    res.json({
      success: true,
      payments: userPayments,
      total: db.payments.filter(p => p.telegramId === telegramId).length
    });

  } catch (error) {
    console.error("❌ Payments history error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// 5. Очистка старых платежей (можно вызывать периодически)
app.post("/payments/cleanup", (req, res) => {
  try {
    const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const initialCount = db.payments.length;
    
    db.payments = db.payments.filter(payment => 
      new Date(payment.createdAt) > dayAgo
    );
    
    const removedCount = initialCount - db.payments.length;
    console.log("🧹 Payments cleanup completed:", { removed: removedCount, remaining: db.payments.length });

    res.json({
      success: true,
      removed: removedCount,
      remaining: db.payments.length
    });

  } catch (error) {
    console.error("❌ Payments cleanup error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ===== СТАРЫЕ ФУНКЦИИ (остаются без изменений) =====

// 1. ПОЛУЧИТЬ корзину (GET)
app.get("/cart/get", (req, res) => {
  try {
    const telegramId = req.query.telegramId;
    
    if (!telegramId) {
      return res.status(400).json({ 
        success: false, 
        error: "Missing telegramId parameter",
        cart: []
      });
    }

    const cartItems = db.carts[telegramId] || [];
    
    console.log("📦 Cart loaded for user:", telegramId, "items:", cartItems.length);
    
    res.json({
      success: true,
      cart: cartItems,
      count: cartItems.length,
      total: cartItems.reduce((sum, item) => sum + (item.price * item.quantity), 0)
    });
    
  } catch (error) {
    console.error("❌ CART GET ERROR:", error);
    res.status(500).json({ 
      success: false, 
      error: "Internal server error",
      cart: []
    });
  }
});

// 2. ДОБАВИТЬ в корзину (POST)
app.post("/cart/add", (req, res) => {
  try {
    const { telegramId, productId, name, price, quantity, image } = req.body;
    
    console.log("🛒 Add to cart request:", { telegramId, productId });
    
    if (!telegramId || !productId) {
      return res.status(400).json({ 
        success: false, 
        error: "Missing telegramId or productId",
        cart: []
      });
    }

    // Создаем пользователя если не существует
    if (!db.users[telegramId]) {
      db.users[telegramId] = {
        telegramId: telegramId,
        balance: 0,
        createdAt: new Date().toISOString()
      };
    }

    // Инициализируем корзину если не существует
    if (!db.carts[telegramId]) {
      db.carts[telegramId] = [];
    }
    
    // Проверяем есть ли уже товар в корзине
    const existingItemIndex = db.carts[telegramId].findIndex(
      item => item.productId == productId
    );

    if (existingItemIndex >= 0) {
      // Увеличиваем количество
      db.carts[telegramId][existingItemIndex].quantity += quantity || 1;
      console.log("📊 Item quantity updated:", db.carts[telegramId][existingItemIndex].quantity);
    } else {
      // Добавляем новый товар
      const newItem = {
        productId: productId,
        name: name || "Unknown Product",
        price: price || 0,
        quantity: quantity || 1,
        image: image || null,
        addedAt: new Date().toISOString()
      };
      db.carts[telegramId].push(newItem);
      console.log("🆕 New item added to cart:", newItem);
    }

    res.json({
      success: true,
      message: "Товар добавлен в корзину",
      cart: db.carts[telegramId],
      count: db.carts[telegramId].length
    });
    
  } catch (error) {
    console.error("❌ CART ADD ERROR:", error);
    res.status(500).json({ 
      success: false, 
      error: "Internal server error",
      cart: []
    });
  }
});

// 3. ОБНОВИТЬ количество (POST)
app.post("/cart/update", (req, res) => {
  try {
    const { telegramId, productId, quantity } = req.body;
    
    console.log("🔄 Update cart request:", { telegramId, productId, quantity });
    
    if (!telegramId || !productId) {
      return res.status(400).json({ 
        success: false, 
        error: "Missing telegramId or productId",
        cart: []
      });
    }

    if (!db.carts[telegramId]) {
      return res.status(404).json({ 
        success: false, 
        error: "Cart not found",
        cart: []
      });
    }

    const itemIndex = db.carts[telegramId].findIndex(
      item => item.productId == productId
    );

    if (itemIndex === -1) {
      return res.status(404).json({ 
        success: false, 
        error: "Item not found in cart",
        cart: []
      });
    }

    // Обновляем количество
    db.carts[telegramId][itemIndex].quantity += quantity;

    // Если количество стало 0 или меньше, удаляем товар
    if (db.carts[telegramId][itemIndex].quantity <= 0) {
      db.carts[telegramId].splice(itemIndex, 1);
      console.log("🗑 Item removed from cart");
    } else {
      console.log("📊 Item quantity updated to:", db.carts[telegramId][itemIndex].quantity);
    }

    res.json({
      success: true,
      cart: db.carts[telegramId],
      count: db.carts[telegramId].length
    });
    
  } catch (error) {
    console.error("❌ CART UPDATE ERROR:", error);
    res.status(500).json({ 
      success: false, 
      error: "Internal server error",
      cart: []
    });
  }
});

// 4. УДАЛИТЬ товар (POST)
app.post("/cart/remove", (req, res) => {
  try {
    const { telegramId, productId } = req.body;
    
    console.log("❌ Remove from cart request:", { telegramId, productId });
    
    if (!telegramId || !productId) {
      return res.status(400).json({ 
        success: false, 
        error: "Missing telegramId or productId",
        cart: []
      });
    }

    if (!db.carts[telegramId]) {
      return res.status(404).json({ 
        success: false, 
        error: "Cart not found",
        cart: []
      });
    }

    const initialLength = db.carts[telegramId].length;
    
    // Удаляем товар
    db.carts[telegramId] = db.carts[telegramId].filter(
      item => item.productId != productId
    );

    console.log("🗑 Item removed, cart size:", initialLength, "->", db.carts[telegramId].length);

    res.json({
      success: true,
      cart: db.carts[telegramId],
      count: db.carts[telegramId].length,
      message: "Товар удален из корзины"
    });
    
  } catch (error) {
    console.error("❌ CART REMOVE ERROR:", error);
    res.status(500).json({ 
      success: false, 
      error: "Internal server error",
      cart: []
    });
  }
});

// 5. ОЧИСТИТЬ корзину (POST)
app.post("/cart/clear", (req, res) => {
  try {
    const { telegramId } = req.body;
    
    console.log("🧹 Clear cart request for user:", telegramId);
    
    if (!telegramId) {
      return res.status(400).json({ 
        success: false, 
        error: "Missing telegramId",
        cart: []
      });
    }

    const cartItemsCount = db.carts[telegramId] ? db.carts[telegramId].length : 0;
    db.carts[telegramId] = [];
    
    console.log("✅ Cart cleared, removed", cartItemsCount, "items");

    res.json({
      success: true,
      message: "Корзина очищена",
      cart: [],
      count: 0,
      removedItems: cartItemsCount
    });
    
  } catch (error) {
    console.error("❌ CART CLEAR ERROR:", error);
    res.status(500).json({ 
      success: false, 
      error: "Internal server error",
      cart: []
    });
  }
});

// --- Balance operations (старые методы для совместимости) ---
app.post("/users/:telegramId/balance/add", (req, res) => {
  try {
    const telegramId = String(req.params.telegramId);
    const { amount } = req.body;
    
    if (!db.users[telegramId]) {
      db.users[telegramId] = {
        telegramId: telegramId,
        balance: 0,
        createdAt: new Date().toISOString()
      };
    }
    
    if (!amount || amount <= 0) {
      return res.status(400).json({ error: "Invalid amount" });
    }
    
    const currentBalance = db.users[telegramId].balance || 0;
    const newBalance = currentBalance + (Number(amount) || 0);

    db.users[telegramId].balance = newBalance;
    db.users[telegramId].updatedAt = new Date().toISOString();

    console.log("💰 Balance added:", { telegramId, amount, newBalance });
    res.json({ success: true, newBalance });
    
  } catch (error) {
    console.error("❌ Balance add error:", error);
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
    
    console.log("💰 Balance subtracted:", { user: telegramId, amount, newBalance: db.users[telegramId].balance });
    res.json({ success: true, newBalance: db.users[telegramId].balance });
    
  } catch (error) {
    console.error("❌ Balance subtract error:", error);
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
    
    console.log("📦 Order created:", { orderId, user: telegramId, total, itemsCount: items ? items.length : 0 });
    res.json({ success: true, orderId });
    
  } catch (error) {
    console.error("❌ Order creation error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// --- Reviews ---
app.post("/reviews", (req, res) => {
  try {
    const reviewData = req.body || {};
    const telegramId = String(reviewData.userId || reviewData.telegramId || "");
    
    console.log("📝 Review submission:", { telegramId, textLength: reviewData.text ? reviewData.text.length : 0 });
    
    if (!telegramId) {
      return res.status(400).json({ error: "User ID is required" });
    }
    
    if (!reviewData.text || reviewData.text.trim().length < 5) {
      return res.status(400).json({ error: "Review text must be at least 5 characters" });
    }

    const existingReviewIndex = db.reviews.findIndex(review => review.userId === telegramId);
    if (existingReviewIndex >= 0) {
      return res.status(400).json({ error: "User has already submitted a review" });
    }

    const newReview = {
      id: Date.now().toString(),
      userId: telegramId,
      author: reviewData.author || "User_" + telegramId.slice(-4),
      text: reviewData.text.trim(),
      rating: reviewData.rating || 5,
      date: new Date().toLocaleDateString('ru-RU'),
      timestamp: Date.now(),
      avatarText: (reviewData.author || "U").charAt(0).toUpperCase()
    };

    db.reviews.unshift(newReview);
    console.log("✅ New review added, total:", db.reviews.length);

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
      success: true,
      reviews: paginatedReviews,
      total: db.reviews.length,
      page,
      totalPages: Math.ceil(db.reviews.length / limit)
    });

  } catch (error) {
    console.error("❌ REVIEWS LOAD ERROR:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.get("/reviews/user/:telegramId", (req, res) => {
  try {
    const telegramId = String(req.params.telegramId);
    
    const userReview = db.reviews.find(review => review.userId === telegramId);
    res.json({ success: true, hasReviewed: !!userReview });

  } catch (error) {
    console.error("❌ USER REVIEW CHECK ERROR:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// --- Debug ---
app.get("/debug", (req, res) => {
  res.json({
    success: true,
    usersCount: Object.keys(db.users).length,
    cartsCount: Object.keys(db.carts).length,
    ordersCount: Object.keys(db.orders).length,
    reviewsCount: db.reviews.length,
    paymentsCount: db.payments.length,
    memoryUsage: process.memoryUsage(),
    uptime: process.uptime()
  });
});

// --- Start server ---
app.listen(PORT, () => {
  console.log(`🚀 Backend running on port ${PORT}`);
  console.log(`🏥 Health check: http://localhost:${PORT}/health`);
  console.log(`💰 New Payment endpoints:`);
  console.log(`   POST /payments/create - Создать запрос на пополнение`);
  console.log(`   POST /payments/check - Проверить статус платежа`);
  console.log(`   POST /payments/confirm - Подтвердить платеж (админ)`);
  console.log(`   GET  /payments/user/:id - История платежей`);
  console.log(`⭐️ Reviews API: http://localhost:${PORT}/reviews`);
  console.log(`🛒 Cart endpoints available`);
  console.log(`📊 Total reviews in DB: ${db.reviews.length}`);
  console.log(`👥 Total users: ${Object.keys(db.users).length}`);
  console.log(`💳 Total payments: ${db.payments.length}`);
});
