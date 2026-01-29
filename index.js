const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
require("dotenv").config();

// если node < 18, то раскомментируй:
// const fetch = require("node-fetch");

const app = express();
const PORT = process.env.PORT || 3001;

// In-memory database
let db = {
  users: {},
  carts: {},
  orders: {},
  reviews: [],
  payments: []
};

// ===== ENV & TINKOFF CONFIG =====
const {
  TINKOFF_TERMINAL_KEY,
  TINKOFF_PASSWORD,
  TINKOFF_SUCCESS_URL,
  TINKOFF_FAIL_URL,
  TINKOFF_NOTIFICATION_URL,
  TELEGRAM_BOT_TOKEN
} = process.env;

function createTinkoffToken(params) {
  if (!TINKOFF_PASSWORD) {
    console.warn("⚠️ TINKOFF_PASSWORD is not set, token calculation may be invalid");
  }
  const data = { ...params, Password: TINKOFF_PASSWORD || "" };
  const orderedKeys = Object.keys(data).sort();
  const concatenated = orderedKeys.map((k) => data[k]).join("");
  return crypto.createHash("sha256").update(concatenated).digest("hex");
}

async function notifyUser(telegramId, text) {
  try {
    if (!TELEGRAM_BOT_TOKEN || !telegramId) return;
    const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: telegramId,
        text,
        parse_mode: "HTML"
      })
    });
  } catch (error) {
    console.error("❌ Telegram notify error:", error);
  }
}

// ===== DB SAVE/LOAD =====
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
  } catch {
    console.log("ℹ️ No existing DB found, starting fresh");
  }
}

loadDB();
setInterval(saveDB, 30000);

// ===== MIDDLEWARE =====
app.use(cors({
  origin: "*",
  methods: ["GET", "POST", "DELETE", "PUT", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With", "Accept"],
  credentials: true,
  preflightContinue: false,
  optionsSuccessStatus: 204
}));
app.options("*", cors());
app.use(helmet());
app.use(express.json({ limit: "2mb" }));

// Простое логирование
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} ${req.method} ${req.path}`);
  if (["POST", "PUT"].includes(req.method) && req.body && Object.keys(req.body).length > 0) {
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
    usersCount: Object.keys(db.users).length,
    cartsCount: Object.keys(db.carts).length,
    paymentsCount: db.payments.length
  });
});

// ===== USERS =====
app.post("/users", (req, res) => {
  try {
    const userData = req.body || {};
    const telegramId = String(userData.telegramId || userData.id || "");
    if (!telegramId) return res.status(400).json({ error: "Missing telegramId" });

    const existingUser = db.users[telegramId];
    if (existingUser) {
      db.users[telegramId] = {
        ...existingUser,
        balance: userData.balance !== undefined ? userData.balance : existingUser.balance,
        username: userData.username || existingUser.username,
        firstName: userData.firstName || existingUser.firstName,
        lastName: userData.lastName || existingUser.lastName,
        avatarUrl: userData.avatarUrl || existingUser.avatarUrl,
        level: userData.level || existingUser.level || "Юнга", // уровень с дефолтом
        updatedAt: new Date().toISOString()
      };
    } else {
      db.users[telegramId] = {
        id: telegramId,
        telegramId,
        username: userData.username || "",
        firstName: userData.firstName || "",
        lastName: userData.lastName || "",
        avatarUrl: userData.avatarUrl || null,
        joinDate: new Date().toISOString(),
        balance: userData.balance !== undefined ? userData.balance : 0,
        level: "Юнга", // дефолт для новых
        createdAt: new Date().toISOString()
      };
    }
    console.log("✅ User saved:", telegramId);
    res.json(db.users[telegramId]);
  } catch (e) {
    console.error("❌ Error saving user:", e);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Баланс
app.get("/users/:telegramId/balance", (req, res) => {
  const user = db.users[req.params.telegramId];
  if (!user) return res.status(404).json({ error: "User not found", balance: 0 });
  res.json({ success: true, balance: user.balance || 0 });
});

// НОВЫЙ: Получить пользователя с уровнем
app.get("/users/:telegramId", (req, res) => {
  try {
    const telegramId = req.params.telegramId;
    console.log(`📥 GET запрос пользователя: ${telegramId}`);
    
    const user = db.users[telegramId] || {};
    const level = user.level || "Юнга";
    console.log(`Возвращаем уровень: ${level}`);
    
    res.json({
      success: true,
      ...user,
      level: level
    });
  } catch (error) {
    console.error("❌ Error getting user:", error);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

// НОВЫЙ: Обновить уровень
app.post("/users/:telegramId/update-level", (req, res) => {
  try {
    const telegramId = req.params.telegramId;
    const { level } = req.body;
    
    console.log(`🏆 POST update-level для ${telegramId}: level = "${level}"`);
    
    if (!level) {
      console.error("❌ Missing level in request");
      return res.status(400).json({ success: false, error: "Missing level" });
    }
    
    if (!db.users[telegramId]) {
      db.users[telegramId] = {
        telegramId,
        level,
        createdAt: new Date().toISOString()
      };
      console.log("Создан новый пользователь с уровнем:", level);
    } else {
      db.users[telegramId].level = level;
      db.users[telegramId].updatedAt = new Date().toISOString();
      console.log("Уровень обновлён:", level);
    }
    
    res.json({ success: true, level });
  } catch (error) {
    console.error("❌ Error updating level:", error);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

// ===== PAYMENTS через Tinkoff =====
// Создание платежа (инициализация в Тинькофф + idempotency)
app.post("/payments/create", async (req, res) => {
  try {
    const { telegramId, amount, items, source } = req.body || {};

    if (!telegramId || !amount || amount < 10) {
      return res.status(400).json({
        success: false,
        error: "Invalid parameters. Minimum amount: 10"
      });
    }

    if (!TINKOFF_TERMINAL_KEY) {
      return res.status(500).json({
        success: false,
        error: "TINKOFF_TERMINAL_KEY is not configured on backend"
      });
    }

    if (!db.users[telegramId]) {
      db.users[telegramId] = {
        telegramId,
        balance: 0,
        createdAt: new Date().toISOString()
      };
    }

    // Idempotency: если есть уже активный платеж с такой же суммой и пользователем — вернем его
    const existingPayment = db.payments.find(
      (p) =>
        p.telegramId === telegramId &&
        Number(p.amount) === Number(amount) &&
        ["NEW", "PENDING"].includes(p.status)
    );

    if (existingPayment) {
      console.log("♻️ Returning existing payment (idempotent):", existingPayment.id);
      return res.json({
        success: true,
        paymentId: existingPayment.id,
        paymentUrl: existingPayment.paymentUrl
      });
    }

    const now = new Date().toISOString();
    const orderId = `tg-${telegramId}-${Date.now()}`;

    // Создаем заказ в "БД"
    db.orders[orderId] = {
      orderId,
      telegramId,
      items: items || [],
      total: amount,
      status: "CREATED",
      source: source || "telegram_mini_app",
      createdAt: now
    };

    const initData = {
      TerminalKey: TINKOFF_TERMINAL_KEY,
      Amount: Math.round(amount * 100),
      OrderId: orderId,
      Description: `Пополнение баланса для Telegram ID ${telegramId}`,
      SuccessURL:
        TINKOFF_SUCCESS_URL || "https://t.me/FOLLENSHAIDbot?start=payment_success",
      FailURL:
        TINKOFF_FAIL_URL || "https://t.me/FOLLENSHAIDbot?start=payment_fail"
    };

    if (TINKOFF_NOTIFICATION_URL) {
      initData.NotificationURL = TINKOFF_NOTIFICATION_URL;
    }

    initData.Token = createTinkoffToken(initData);

    const tinkoffResp = await fetch("https://securepay.tinkoff.ru/v2/Init", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(initData)
    });
    const tinkoffJson = await tinkoffResp.json();

    console.log("📡 Tinkoff Init response:", tinkoffJson);

    if (!tinkoffJson.Success) {
      console.error("❌ Tinkoff Init error:", tinkoffJson);
      return res.status(500).json({
        success: false,
        error: "Tinkoff Init failed",
        details: tinkoffJson
      });
    }

    const payment = {
      id: orderId,
      telegramId,
      amount,
      status: "NEW",
      createdAt: now,
      paymentUrl: tinkoffJson.PaymentURL,
      tinkoffPaymentId: tinkoffJson.PaymentId,
      history: [
        {
          status: "NEW",
          rawStatus: tinkoffJson.Status || "NEW",
          at: now
        }
      ],
      source: source || "telegram_mini_app"
    };
    db.payments.push(payment);

    console.log("💰 Tinkoff payment created:", payment);
    res.json({ success: true, paymentId: orderId, paymentUrl: tinkoffJson.PaymentURL });
  } catch (e) {
    console.error("❌ Payment creation error:", e);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

// Webhook / callback от Tinkoff (истина по статусам)
app.post("/payments/webhook", async (req, res) => {
  try {
    const data = req.body || {};
    console.log("📩 Tinkoff webhook:", data);

    const { Token: receivedToken, ...unsigned } = data;
    const expectedToken = createTinkoffToken(unsigned);

    if (!receivedToken || receivedToken !== expectedToken) {
      console.error("❌ Invalid Tinkoff webhook signature");
      // Не обновляем ничего, но отвечаем 200, чтобы Tinkoff не спамил
      return res.json({ success: false, message: "Invalid signature" });
    }

    const { OrderId, Status, Amount, PaymentId } = data;

    let payment =
      db.payments.find((p) => p.id === OrderId) ||
      db.payments.find((p) => p.tinkoffPaymentId === PaymentId);

    if (!payment) {
      console.warn("⚠️ Payment not found for webhook, creating stub record");
      payment = {
        id: OrderId || `p-${PaymentId}`,
        telegramId: null,
        amount: Amount ? Amount / 100 : 0,
        status: Status || "UNKNOWN",
        createdAt: new Date().toISOString(),
        tinkoffPaymentId: PaymentId,
        history: []
      };
      db.payments.push(payment);
    }

    const now = new Date().toISOString();
    payment.history = payment.history || [];
    payment.history.push({
      status: Status,
      rawStatus: Status,
      at: now
    });

    const user = payment.telegramId ? db.users[payment.telegramId] : null;
    const order = db.orders[payment.id];

    switch (Status) {
      case "NEW":
        payment.status = "NEW";
        if (order) order.status = "CREATED";
        break;

      case "CONFIRMED":
        payment.status = "CONFIRMED";
        payment.completedAt = now;
        if (order) order.status = "COMPLETED";

        if (user && Amount) {
          const delta = Amount / 100;
          user.balance = (user.balance || 0) + delta;
          user.updatedAt = now;
          console.log("💰 Balance increased via webhook:", {
            telegramId: payment.telegramId,
            delta,
            newBalance: user.balance
          });
        }

        await notifyUser(
          payment.telegramId,
          `✅ Оплата успешно подтверждена.\nСумма: ${Amount / 100} ₽`
        );
        break;

      case "REJECTED":
        payment.status = "REJECTED";
        if (order) order.status = "REJECTED";
        await notifyUser(
          payment.telegramId,
          "❌ Платёж был отклонён банком или платёжной системой."
        );
        break;

      case "CANCELED":
        payment.status = "CANCELED";
        if (order) order.status = "CANCELED";
        await notifyUser(payment.telegramId, "⚠️ Платёж был отменён.");
        break;

      case "REFUNDED":
        payment.status = "REFUNDED";
        if (!payment.refunds) payment.refunds = [];
        payment.refunds.push({
          amount: Amount ? Amount / 100 : 0,
          at: now
        });
        if (order) order.status = "REFUNDED";

        if (user && Amount) {
          const delta = Amount / 100;
          user.balance = Math.max(0, (user.balance || 0) - delta);
          user.updatedAt = now;
          console.log("↩️ Balance decreased due to refund:", {
            telegramId: payment.telegramId,
            delta,
            newBalance: user.balance
          });
        }

        await notifyUser(
          payment.telegramId,
          `↩️ По вашему платежу выполнен возврат.\nСумма: ${Amount / 100} ₽`
        );
        break;

      default:
        console.log("ℹ️ Unhandled Tinkoff status:", Status);
        payment.status = Status || payment.status;
        break;
    }

    res.json({ success: true });
  } catch (e) {
    console.error("❌ Webhook error:", e);
    res.status(500).json({ success: false });
  }
});

// Для совместимости со старым URL
app.post("/payments/callback", (req, res) => {
  console.log("ℹ️ /payments/callback called, redirecting to /payments/webhook handler");
  req.url = "/payments/webhook";
  app._router.handle(req, res);
});

// Отмена платежа через Tinkoff API
app.post("/payments/:paymentId/cancel", async (req, res) => {
  try {
    const paymentId = req.params.paymentId;
    const payment =
      db.payments.find((p) => p.id === paymentId) ||
      db.payments.find((p) => String(p.tinkoffPaymentId) === String(paymentId));

    if (!payment || !payment.tinkoffPaymentId) {
      return res.status(404).json({ success: false, error: "Payment not found" });
    }

    const payload = {
      TerminalKey: TINKOFF_TERMINAL_KEY,
      PaymentId: payment.tinkoffPaymentId
    };
    payload.Token = createTinkoffToken(payload);

    const resp = await fetch("https://securepay.tinkoff.ru/v2/Cancel", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const json = await resp.json();
    console.log("📡 Tinkoff Cancel response:", json);

    if (!json.Success) {
      return res.status(500).json({ success: false, error: "Cancel failed", details: json });
    }

    payment.status = "CANCELED";
    payment.canceledAt = new Date().toISOString();

    const order = db.orders[payment.id];
    if (order) order.status = "CANCELED";

    await notifyUser(
      payment.telegramId,
      "⚠️ Ваш платёж был отменён. Если это ошибка — попробуйте оплатить ещё раз."
    );

    res.json({ success: true });
  } catch (error) {
    console.error("❌ Payment cancel error:", error);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

// Полный / частичный возврат средств
app.post("/payments/:paymentId/refund", async (req, res) => {
  try {
    const paymentId = req.params.paymentId;
    const { amount } = req.body || {};

    const payment =
      db.payments.find((p) => p.id === paymentId) ||
      db.payments.find((p) => String(p.tinkoffPaymentId) === String(paymentId));

    if (!payment || !payment.tinkoffPaymentId) {
      return res.status(404).json({ success: false, error: "Payment not found" });
    }

    const refundAmount = amount ? Number(amount) : Number(payment.amount);
    if (!refundAmount || refundAmount <= 0) {
      return res.status(400).json({ success: false, error: "Invalid refund amount" });
    }

    const payload = {
      TerminalKey: TINKOFF_TERMINAL_KEY,
      PaymentId: payment.tinkoffPaymentId,
      Amount: Math.round(refundAmount * 100)
    };
    payload.Token = createTinkoffToken(payload);

    const resp = await fetch("https://securepay.tinkoff.ru/v2/Refund", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const json = await resp.json();
    console.log("📡 Tinkoff Refund response:", json);

    if (!json.Success) {
      return res
        .status(500)
        .json({ success: false, error: "Refund failed", details: json });
    }

    const now = new Date().toISOString();
    if (!payment.refunds) payment.refunds = [];
    payment.refunds.push({
      amount: refundAmount,
      at: now
    });
    payment.status = "REFUNDED";

    const order = db.orders[payment.id];
    if (order) order.status = "REFUNDED";

    const user = payment.telegramId ? db.users[payment.telegramId] : null;
    if (user) {
      user.balance = Math.max(0, (user.balance || 0) - refundAmount);
      user.updatedAt = now;
    }

    await notifyUser(
      payment.telegramId,
      `↩️ По вашему платежу выполнен возврат.\nСумма: ${refundAmount} ₽`
    );

    res.json({ success: true });
  } catch (error) {
    console.error("❌ Payment refund error:", error);
    res.status(500).json({ success: false, error: "Internal server error" });
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
    const { telegramId, productId, name, price, quantity, image, description, category } = req.body;

    if (!telegramId || !productId) {
      return res.status(400).json({
        success: false,
        error: "Missing telegramId or productId",
        cart: []
      });
    }

    if (!db.users[telegramId]) {
      db.users[telegramId] = {
        telegramId,
        balance: 0,
        createdAt: new Date().toISOString()
      };
    }

    if (!db.carts[telegramId]) {
      db.carts[telegramId] = [];
    }

    const existingItemIndex = db.carts[telegramId].findIndex(item => item.productId === productId);

    if (existingItemIndex >= 0) {
      db.carts[telegramId][existingItemIndex].quantity += quantity || 1;
    } else {
      const newItem = {
        productId,
        name: name || "Unknown Product",
        price: price || 0,
        quantity: quantity || 1,
        image: image || null,
        description: description || "",
        category: category || "",
        addedAt: new Date().toISOString()
      };
      db.carts[telegramId].push(newItem);
    }

    res.json({
      success: true,
      message: "Товар добавлен в корзину",
      cart: db.carts[telegramId],
      count: db.carts[telegramId].length
    });

  } catch (error) {
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

    db.carts[telegramId][itemIndex].quantity += quantity;

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
  console.log(`   POST /payments/callback - Callback от Tinkoff`);
  console.log(`⭐️ Reviews API: http://localhost:${PORT}/reviews`);
  console.log(`🛒 Cart endpoints available`);
  console.log(`📊 Total reviews in DB: ${db.reviews.length}`);
  console.log(`👥 Total users: ${Object.keys(db.users).length}`);
  console.log(`💳 Payments: POST /payments/create, POST /payments/callback`);
  console.log(`🏆 Levels support added: GET /users/:id, POST /users/:id/update-level`);
});
