const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const fs = require("fs");
const path = require("path");

try { require("dotenv").config({ path: path.join(__dirname, ".env") }); } catch (e) { /* dotenv не обязателен */ }

// CRC32 для подписи Тинькофф (без внешних пакетов)
function crc32str(s) {
  let crc = -1;
  const table = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    table[n] = c;
  }
  for (let i = 0; i < s.length; i++) crc = table[(crc ^ s.charCodeAt(i)) & 0xff] ^ (crc >>> 8);
  return (crc ^ -1) >>> 0;
}

// если node < 18, то раскомментируй:
// const fetch = require("node-fetch");

const app = express();
const PORT = process.env.PORT || 3001;

// In-memory database (по ТЗ: заказы, платежи, история, возвраты)
let db = {
  users: {},
  carts: {},
  orders: {},
  reviews: [],
  payments: [],
  refunds: [],
  paymentEvents: []
};

function logPaymentEvent(event, data) {
  const entry = { at: new Date().toISOString(), event, ...data };
  db.paymentEvents.push(entry);
  if (db.paymentEvents.length > 5000) db.paymentEvents = db.paymentEvents.slice(-3000);
  console.log("[PAYMENT]", event, JSON.stringify(data));
}

async function notifyTelegram(telegramId, text) {
  const token = process.env.TG_BOT_TOKEN;
  if (!token) return;
  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: telegramId, text, parse_mode: "HTML" })
    });
  } catch (e) {
    console.error("Notify Telegram:", e);
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
      if (!Array.isArray(db.refunds)) db.refunds = [];
      if (!Array.isArray(db.paymentEvents)) db.paymentEvents = [];
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

// ===== ТИНЬКОФФ ЭКВАЙРИНГ (по ТЗ: заказы, статусы, webhook, отмена, возврат) =====

function tinkoffInitToken(terminalKey, amount, orderId, password) {
  return String(crc32str(terminalKey + String(amount) + orderId + password));
}

function tinkoffNotificationToken(body, password) {
  const keys = Object.keys(body).filter(k => k !== "Token" && body[k] !== "" && body[k] !== undefined).sort();
  const str = keys.map(k => String(body[k])).join("") + password;
  return String(crc32str(str));
}

app.post("/payments/create", async (req, res) => {
  try {
    const telegramId = String(req.body.telegramUserId || req.body.telegramId || "");
    const amount = req.body.totalAmount != null ? Number(req.body.totalAmount) : Number(req.body.amount || 0);
    const items = req.body.items || [];
    const source = req.body.source || "telegram_mini_app";

    if (!telegramId || !amount || amount < 10) {
      return res.status(400).json({ success: false, error: "Нужны telegramUserId и сумма не меньше 10" });
    }

    if (!db.users[telegramId]) {
      db.users[telegramId] = { telegramId, balance: 0, createdAt: new Date().toISOString() };
    }

    const terminalKey = process.env.TERMINAL_KEY;
    const terminalPassword = process.env.TERMINAL_PASSWORD;
    const successUrl = process.env.SUCCESS_URL || "https://t.me/";
    const failUrl = process.env.FAIL_URL || "https://t.me/";

    const idempotencyKey = req.body.idempotencyKey || req.body.orderId;
    const orderId = idempotencyKey || ("order_" + telegramId + "_" + Date.now());
    const amountKopecks = Math.round(amount * 100);

    const existingPayment = db.payments.find(p => p.orderId === orderId);
    if (existingPayment && existingPayment.paymentUrl) {
      logPaymentEvent("IDEMPOTENT_RETURN", { orderId, paymentId: existingPayment.paymentId });
      return res.json({ success: true, paymentId: existingPayment.paymentId, paymentUrl: existingPayment.paymentUrl });
    }

    const order = {
      orderId,
      telegramId,
      items,
      totalAmount: amount,
      status: "CREATED",
      createdAt: new Date().toISOString()
    };
    db.orders.push(order);
    logPaymentEvent("ORDER_CREATED", { orderId, telegramId, amount });

    if (terminalKey && terminalPassword) {
      const initData = {
        TerminalKey: terminalKey,
        Amount: amountKopecks,
        OrderId: orderId,
        Description: `Пополнение баланса ${amount} ₽`,
        SuccessURL: successUrl,
        FailURL: failUrl,
        Token: tinkoffInitToken(terminalKey, amountKopecks, orderId, terminalPassword)
      };

      const tinkoffResp = await fetch("https://securepay.tinkoff.ru/v2/Init", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(initData)
      });
      const tinkoffJson = await tinkoffResp.json();

      if (tinkoffJson.Success && tinkoffJson.PaymentURL) {
        const paymentId = tinkoffJson.PaymentId || orderId;
        const payment = {
          orderId,
          paymentId: String(paymentId),
          telegramId,
          amount,
          amountKopecks,
          status: "NEW",
          paymentUrl: tinkoffJson.PaymentURL,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          source
        };
        db.payments.push(payment);
        logPaymentEvent("PAYMENT_CREATED", { orderId, paymentId, amount });
        return res.json({ success: true, paymentId, paymentUrl: tinkoffJson.PaymentURL });
      }
      logPaymentEvent("TINKOFF_INIT_FAIL", { orderId, response: tinkoffJson });
      return res.status(500).json({ success: false, error: tinkoffJson.Message || "Ошибка Тинькофф" });
    }

    const payment = {
      orderId,
      paymentId: orderId,
      telegramId,
      amount,
      status: "NEW",
      paymentUrl: successUrl,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      source
    };
    db.payments.push(payment);
    res.json({ success: true, paymentId: orderId, paymentUrl: successUrl });
  } catch (e) {
    console.error("❌ Payment create:", e);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

app.get("/payments/status/:paymentId", (req, res) => {
  const payment = db.payments.find(p => p.paymentId === req.params.paymentId || p.orderId === req.params.paymentId);
  if (!payment) return res.status(404).json({ success: false, error: "Payment not found" });
  res.json({
    success: true,
    paymentId: payment.paymentId,
    orderId: payment.orderId,
    status: payment.status,
    amount: payment.amount,
    completedAt: payment.completedAt || null
  });
});

app.post("/payments/webhook/tinkoff", (req, res) => {
  const body = req.body;
  const terminalPassword = process.env.TERMINAL_PASSWORD || "";
  const receivedToken = body.Token;
  const expectedToken = tinkoffNotificationToken(body, terminalPassword);
  if (receivedToken !== undefined && receivedToken !== "" && expectedToken !== receivedToken) {
    logPaymentEvent("WEBHOOK_INVALID_TOKEN", { OrderId: body.OrderId });
    return res.status(400).json({ success: false, error: "Invalid token" });
  }

  const payment = db.payments.find(p => p.orderId === body.OrderId || String(p.paymentId) === String(body.PaymentId));
  if (!payment) {
    logPaymentEvent("WEBHOOK_PAYMENT_NOT_FOUND", { OrderId: body.OrderId });
    return res.status(404).json({ success: false, error: "Payment not found" });
  }

  const status = String(body.Status || "").toUpperCase();
  const order = db.orders.find(o => o.orderId === payment.orderId);
  const amountRub = (body.Amount != null ? Number(body.Amount) / 100 : payment.amount) || payment.amount;

  payment.updatedAt = new Date().toISOString();
  payment.status = status;
  if (order) order.status = status;

  switch (status) {
    case "CONFIRMED":
      payment.completedAt = new Date().toISOString();
      if (db.users[payment.telegramId]) {
        db.users[payment.telegramId].balance = (db.users[payment.telegramId].balance || 0) + amountRub;
        db.users[payment.telegramId].updatedAt = new Date().toISOString();
      }
      logPaymentEvent("CONFIRMED", { orderId: payment.orderId, telegramId: payment.telegramId, amount: amountRub });
      notifyTelegram(payment.telegramId, "✅ Оплата прошла. Зачислено " + amountRub + " ₽.");
      break;
    case "REJECTED":
    case "CANCELED":
      logPaymentEvent(status, { orderId: payment.orderId });
      notifyTelegram(payment.telegramId, status === "REJECTED" ? "❌ Платёж отклонён." : "❌ Платёж отменён.");
      break;
    case "REFUNDED":
      if (db.users[payment.telegramId]) {
        db.users[payment.telegramId].balance = Math.max(0, (db.users[payment.telegramId].balance || 0) - amountRub);
        db.users[payment.telegramId].updatedAt = new Date().toISOString();
      }
      logPaymentEvent("REFUNDED", { orderId: payment.orderId, amount: amountRub });
      notifyTelegram(payment.telegramId, "↩️ Возврат " + amountRub + " ₽.");
      break;
    default:
      logPaymentEvent("STATUS_UPDATE", { orderId: payment.orderId, status });
  }

  res.json({ success: true });
});

app.post("/payments/callback", (req, res) => {
  const body = req.body;
  const terminalPassword = process.env.TERMINAL_PASSWORD || "";
  const receivedToken = body.Token;
  const expectedToken = tinkoffNotificationToken(body, terminalPassword);
  if (receivedToken !== undefined && receivedToken !== "" && expectedToken !== receivedToken) {
    logPaymentEvent("WEBHOOK_INVALID_TOKEN", { OrderId: body.OrderId });
    return res.status(400).json({ success: false, error: "Invalid token" });
  }
  const payment = db.payments.find(p => p.orderId === body.OrderId || String(p.paymentId) === String(body.PaymentId));
  if (!payment) return res.status(404).json({ success: false, error: "Payment not found" });
  const status = String(body.Status || "").toUpperCase();
  const order = db.orders.find(o => o.orderId === payment.orderId);
  const amountRub = (body.Amount != null ? Number(body.Amount) / 100 : payment.amount) || payment.amount;
  payment.updatedAt = new Date().toISOString();
  payment.status = status;
  if (order) order.status = status;
  switch (status) {
    case "CONFIRMED":
      payment.completedAt = new Date().toISOString();
      if (db.users[payment.telegramId]) {
        db.users[payment.telegramId].balance = (db.users[payment.telegramId].balance || 0) + amountRub;
        db.users[payment.telegramId].updatedAt = new Date().toISOString();
      }
      logPaymentEvent("CONFIRMED", { orderId: payment.orderId, telegramId: payment.telegramId, amount: amountRub });
      notifyTelegram(payment.telegramId, "✅ Оплата прошла. Зачислено " + amountRub + " ₽.");
      break;
    case "REJECTED":
    case "CANCELED":
      logPaymentEvent(status, { orderId: payment.orderId });
      notifyTelegram(payment.telegramId, status === "REJECTED" ? "❌ Платёж отклонён." : "❌ Платёж отменён.");
      break;
    case "REFUNDED":
      if (db.users[payment.telegramId]) {
        db.users[payment.telegramId].balance = Math.max(0, (db.users[payment.telegramId].balance || 0) - amountRub);
        db.users[payment.telegramId].updatedAt = new Date().toISOString();
      }
      logPaymentEvent("REFUNDED", { orderId: payment.orderId, amount: amountRub });
      notifyTelegram(payment.telegramId, "↩️ Возврат " + amountRub + " ₽.");
      break;
    default:
      logPaymentEvent("STATUS_UPDATE", { orderId: payment.orderId, status });
  }
  res.json({ success: true });
});

app.post("/api/payments/cancel", async (req, res) => {
  try {
    const { orderId, paymentId } = req.body;
    const payment = db.payments.find(p => p.orderId === orderId || p.paymentId === paymentId);
    if (!payment) return res.status(404).json({ success: false, error: "Payment not found" });
    if (["CONFIRMED", "REFUNDED", "REJECTED", "CANCELED"].includes(payment.status)) {
      return res.status(400).json({ success: false, error: "Payment already in final state" });
    }
    const terminalKey = process.env.TERMINAL_KEY;
    const terminalPassword = process.env.TERMINAL_PASSWORD;
    if (!terminalKey || !terminalPassword) return res.status(500).json({ success: false, error: "Gateway not configured" });
    const cancelToken = String(crc32str(terminalKey + String(payment.paymentId) + terminalPassword));
    const cancelResp = await fetch("https://securepay.tinkoff.ru/v2/Cancel", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ TerminalKey: terminalKey, PaymentId: payment.paymentId, Token: cancelToken })
    });
    const cancelJson = await cancelResp.json();
    if (!cancelJson.Success) return res.status(500).json({ success: false, error: cancelJson.Message || "Cancel failed" });
    payment.status = "CANCELED";
    payment.updatedAt = new Date().toISOString();
    const order = db.orders.find(o => o.orderId === payment.orderId);
    if (order) order.status = "CANCELED";
    logPaymentEvent("CANCELED", { orderId: payment.orderId });
    res.json({ success: true, status: "CANCELED" });
  } catch (e) {
    console.error("❌ Cancel error:", e);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

app.post("/api/payments/refund", async (req, res) => {
  try {
    const { orderId, paymentId, amount } = req.body;
    const payment = db.payments.find(p => p.orderId === orderId || p.paymentId === paymentId);
    if (!payment) return res.status(404).json({ success: false, error: "Payment not found" });
    if (payment.status !== "CONFIRMED") return res.status(400).json({ success: false, error: "Only CONFIRMED can be refunded" });
    const refundAmount = amount != null ? Number(amount) : payment.amount;
    if (refundAmount <= 0 || refundAmount > payment.amount) return res.status(400).json({ success: false, error: "Invalid refund amount" });
    const terminalKey = process.env.TERMINAL_KEY;
    const terminalPassword = process.env.TERMINAL_PASSWORD;
    if (!terminalKey || !terminalPassword) return res.status(500).json({ success: false, error: "Gateway not configured" });
    const refundAmountKopecks = Math.round(refundAmount * 100);
    const refundToken = String(crc32str(terminalKey + String(payment.paymentId) + String(refundAmountKopecks) + terminalPassword));
    const refundResp = await fetch("https://securepay.tinkoff.ru/v2/Cancel", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        TerminalKey: terminalKey,
        PaymentId: payment.paymentId,
        Amount: refundAmountKopecks,
        Token: refundToken
      })
    });
    const refundJson = await refundResp.json();
    if (!refundJson.Success) return res.status(500).json({ success: false, error: refundJson.Message || "Refund failed" });
    const refundRecord = {
      id: "refund_" + Date.now(),
      orderId: payment.orderId,
      paymentId: payment.paymentId,
      telegramId: payment.telegramId,
      amount: refundAmount,
      createdAt: new Date().toISOString()
    };
    db.refunds.push(refundRecord);
    payment.status = refundAmount >= payment.amount ? "REFUNDED" : payment.status;
    payment.updatedAt = new Date().toISOString();
    if (db.users[payment.telegramId]) {
      db.users[payment.telegramId].balance = Math.max(0, (db.users[payment.telegramId].balance || 0) - refundAmount);
      db.users[payment.telegramId].updatedAt = new Date().toISOString();
    }
    logPaymentEvent("REFUND", refundRecord);
    res.json({ success: true, refund: refundRecord });
  } catch (e) {
    console.error("❌ Refund error:", e);
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
