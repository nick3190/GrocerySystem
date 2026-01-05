import 'dotenv/config';
import express from "express";
import cors from "cors";
import crypto from 'crypto';
import cookieParser from 'cookie-parser';
import pool from './db.js';
import ExcelJS from 'exceljs';
import moment from 'moment';
import twilio from 'twilio';
import rateLimit from 'express-rate-limit';

import path from 'path';
import { fileURLToPath } from 'url';

// ⭐ 1. 關鍵修正：將環境變數宣告移至最上方，確保全域可用
const ADMIN_USERNAME = process.env.ADMIN_USERNAME;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const SECRET_KEY = process.env.SECRET_KEY;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 4000;

// 信任 Proxy (解決 Render 上的 Rate Limit 錯誤)
app.set('trust proxy', 1);

const distPath = path.join(__dirname, "../dist");
app.use(express.static(path.join(distPath)));

let twilioClient;
if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN) {
    twilioClient = new twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
}

const isProduction = process.env.NODE_ENV === 'production';

// --- 工具函式 ---
const formatPhone = (rawPhone) => {
    if (!rawPhone) return null;
    let p = rawPhone.toString().replace(/\s+/g, '').replace(/-/g, '');
    if (p.startsWith('+886')) {
        if (p.startsWith('+88609')) return '+886' + p.substring(5);
        return p;
    }
    if (p.startsWith('886')) {
        if (p.startsWith('88609')) return '+886' + p.substring(4);
        return '+' + p;
    }
    if (p.startsWith('09')) return '+886' + p.substring(1);
    return p;
};

const generateOrderId = () => {
    const now = new Date();
    const dateStr = now.toISOString().replace(/[-T:.Z]/g, "").slice(0, 12);
    const random = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
    return `${dateStr}${random}`;
};

// --- JWT 驗證 ---
const verifyToken = (req) => {
    const token = req.cookies.auth_token;
    if (!token) return null;
    try {
        const [dataBase64, signature] = token.split('.');
        if (!dataBase64 || !signature) return null;
        
        const newSignature = crypto.createHmac('sha256', SECRET_KEY).update(dataBase64).digest('hex');
        if (newSignature === signature) {
            return JSON.parse(Buffer.from(dataBase64, 'base64').toString());
        }
    } catch (e) { return null; }
    return null;
};

const requireAuth = (req, res, next) => {
    const user = verifyToken(req);
    // 開發後門 (Render 上不會執行)
    if (!isProduction && !user) {
        req.user = { uuid: "DEV-UUID", priceTier: "A", store_name: "開發測試店", phone: "0900000000" };
        return next();
    }
    if (!user) {
        return res.status(401).json({ message: "Token 無效或已過期" });
    }
    req.user = user;
    next();
};

app.use(cors({
    origin: isProduction
        ? ["https://grocerysystem-s04n.onrender.com"]
        : ["http://localhost:5173", "http://127.0.0.1:5173"],
    methods: ["GET", "POST", "PUT", "DELETE"],
    credentials: true
}));

app.use(express.json());
app.use(cookieParser());

const otpLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, 
    max: 10, 
    message: { message: "簡訊發送過於頻繁" }
});

const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 200, 
    standardHeaders: true,
    legacyHeaders: false,
});

app.use('/api', limiter);

// ================= API 路由 =================

// 手機自動帶入資料 API
app.get("/api/lookup-user", async (req, res) => {
    const { phone } = req.query;
    const formatted = formatPhone(phone);
    if (!formatted) return res.json({ found: false });

    try {
        const result = await pool.query("SELECT * FROM users WHERE phone = $1", [formatted]);
        if (result.rows.length > 0) {
            const u = result.rows[0];
            res.json({
                found: true,
                user: {
                    storeName: u.store_name,
                    address: u.address,
                    deliveryType: u.delivery_type
                }
            });
        } else {
            res.json({ found: false });
        }
    } catch (e) {
        res.status(500).json({ found: false });
    }
});

app.post("/api/send-otp", otpLimiter, async (req, res) => {
    let { phone } = req.body;
    const formattedPhone = formatPhone(phone);
    if (!formattedPhone) return res.status(400).json({ message: "手機號碼格式錯誤" });

    const code = Math.floor(1000 + Math.random() * 9000).toString();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

    try {
        await pool.query(
            `INSERT INTO otps (phone, code, expires_at) VALUES ($1, $2, $3)
             ON CONFLICT (phone) DO UPDATE SET code = $2, expires_at = $3`,
            [formattedPhone, code, expiresAt]
        );

        if (twilioClient && process.env.TWILIO_PHONE_NUMBER) {
            await twilioClient.messages.create({
                body: `【元榮批發】您的驗證碼是：${code}`,
                from: process.env.TWILIO_PHONE_NUMBER,
                to: formattedPhone
            });
            res.json({ message: "驗證碼已發送" });
        } else {
            console.log(`=== OTP: ${code} ===`);
            res.json({ message: "驗證碼已發送 (開發模式)" });
        }
    } catch (err) {
        console.error("Send OTP Error:", err);
        res.status(500).json({ message: "系統錯誤" });
    }
});

app.post("/api/verify-otp", async (req, res) => {
    const { phone, otp, storeName, deliveryType, address, pickupDate, pickupTime } = req.body;
    const formattedPhone = formatPhone(phone);

    try {
        const otpResult = await pool.query('SELECT * FROM otps WHERE phone = $1', [formattedPhone]);
        if (otpResult.rows.length === 0) return res.status(400).json({ message: "驗證碼無效" });

        const record = otpResult.rows[0];
        if (new Date() > new Date(record.expires_at)) return res.status(400).json({ message: "驗證碼已過期" });
        if (record.code !== otp) return res.status(400).json({ message: "驗證碼錯誤" });

        let finalDate = pickupDate === 'today' ? moment().format('YYYY-MM-DD') : pickupDate;
        if (!finalDate) finalDate = null; 

        const finalTime = (deliveryType === 'delivery' || !pickupTime) ? null : pickupTime;
        const safeAddress = address || '';

        const sqlParams = [storeName, formattedPhone, deliveryType, safeAddress, finalDate, finalTime];

        let userResult = await pool.query('SELECT * FROM users WHERE phone = $1', [formattedPhone]);

        if (userResult.rows.length === 0) {
            userResult = await pool.query(
                `INSERT INTO users (store_name, phone, delivery_type, address, pickup_date, pickup_time, price_tier)
                 VALUES ($1, $2, $3, $4, $5, $6, 'A') RETURNING *`,
                sqlParams
            );
        } else {
            userResult = await pool.query(
                `UPDATE users SET store_name = $1, delivery_type = $3, address = $4, pickup_date = $5, pickup_time = $6
                 WHERE phone = $2 RETURNING *`,
                sqlParams
            );
        }

        const user = userResult.rows[0];
        const payload = {
            uuid: user.uuid,
            storeName: user.store_name,
            phone: user.phone,
            priceTier: user.price_tier || 'A',
            deliveryType: user.delivery_type,
            pickupDate: user.pickup_date,
            pickupTime: user.pickup_time,
            address: user.address
        };

        const userDataStr = JSON.stringify(payload);
        const dataBase64 = Buffer.from(userDataStr).toString('base64');
        const signature = crypto.createHmac('sha256', SECRET_KEY).update(dataBase64).digest('hex');
        const token = `${dataBase64}.${signature}`;

        await pool.query('DELETE FROM otps WHERE phone = $1', [formattedPhone]);

        res.cookie("auth_token", token, {
            httpOnly: true, maxAge: 86400000 * 30, path: "/",
            secure: isProduction, sameSite: isProduction ? "None" : "Lax"
        });

        res.json({ message: "登入成功", user: payload });
    } catch (err) {
        console.error("Login Error (500):", err);
        res.status(500).json({ message: "登入失敗 (伺服器錯誤)" });
    }
});

app.get("/api/me", requireAuth, async (req, res) => {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    
    const user = req.user;
    try {
        const userRes = await pool.query('SELECT * FROM users WHERE uuid = $1', [user.uuid]);
        if (userRes.rows.length > 0) {
            const u = userRes.rows[0];
            const userData = {
                ...u,
                deliveryType: u.delivery_type,
                pickupDate: u.pickup_date,
                pickupTime: u.pickup_time,
                storeName: u.store_name,
                address: u.address
            };
            res.json({ isAuthenticated: true, user: userData });
        } else {
            res.json({ isAuthenticated: true, user: user });
        }
    } catch (e) {
        res.json({ isAuthenticated: true, user: user });
    }
});

app.post("/logout", (req, res) => {
    res.clearCookie('auth_token');
    res.json({ message: "已登出" });
});

// --- 商品 & 購物車 ---
app.get("/products", async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM products ORDER BY name, id');
        res.json(result.rows);
    } catch (err) { res.status(500).json({ message: "Error" }); }
});

app.put("/products/:id", async (req, res) => {
    const { id } = req.params;
    const { name, price_A, price_B, spec, unit, brand } = req.body;
    try {
        await pool.query(
            `UPDATE products SET name=$1, "price_A"=$2, "price_B"=$3, spec=$4, unit=$5, brand=$6 WHERE id=$7`,
            [name, price_A, price_B, spec, unit, brand, id]
        );
        res.json({ message: "更新成功" });
    } catch (err) { res.status(500).json({ message: "Error" }); }
});

app.get("/api/categories", async (req, res) => { try { const result = await pool.query('SELECT DISTINCT main_category, sub_category FROM products'); const map = {}; result.rows.forEach(row => { const main = row.main_category || '其他'; const sub = row.sub_category || '其他'; if (!map[main]) map[main] = []; if (!map[main].includes(sub)) map[main].push(sub); }); res.json(map); } catch (err) { res.status(500).json({}); } });
app.get("/api/brands", async (req, res) => { try { const result = await pool.query("SELECT DISTINCT brand FROM products WHERE brand IS NOT NULL AND brand != ''"); res.json(result.rows.map(r => r.brand)); } catch (err) { res.json([]); } });

app.get("/cart", requireAuth, async (req, res) => {
    const user = req.user;
    try {
        const tier = user.priceTier || user.price_tier || 'A';
        const priceColumn = tier === 'B' ? 'price_B' : 'price_A';
        const sql = `SELECT c.id, c.product_id, c.quantity, c.note, p.name, p.spec, p.unit, p.brand, p."${priceColumn}" as price FROM cart_items c JOIN products p ON CAST(c.product_id AS INTEGER) = p.id WHERE c.user_uuid = $1 ORDER BY c.created_at DESC`;
        const result = await pool.query(sql, [user.uuid]);
        res.json(result.rows);
    } catch (err) { res.status(500).json({ message: "Error" }); }
});

app.post("/cart", requireAuth, async (req, res) => {
    const user = req.user;
    const { productId, quantity, note } = req.body;
    try {
        await pool.query(
            `INSERT INTO cart_items (user_uuid, product_id, quantity, note) VALUES ($1, $2, $3, $4) ON CONFLICT (user_uuid, product_id) DO UPDATE SET quantity = cart_items.quantity + $3, note = $4`,
            [user.uuid, productId, quantity, note]
        );
        res.json({ message: "已加入" });
    } catch (err) { res.status(500).json({ message: "Error" }); }
});

app.delete("/cart/:id", requireAuth, async (req, res) => {
    const user = req.user;
    try { await pool.query('DELETE FROM cart_items WHERE id = $1 AND user_uuid = $2', [req.params.id, user.uuid]); res.json({ message: "已刪除" }); } catch (err) { res.status(500).json({}); }
});

app.post("/api/checkout", requireAuth, async (req, res) => {
    const user = req.user;
    const { orderNote, deliveryType, address, pickupDate, pickupTime } = req.body;
    try {
        const userRes = await pool.query("SELECT * FROM users WHERE uuid = $1", [user.uuid]);
        const dbUser = userRes.rows[0];
        
        const finalDeliveryType = deliveryType || dbUser.delivery_type;
        const finalAddress = address || dbUser.address;
        
        let finalPickupDate = pickupDate || dbUser.pickup_date;
        if (!finalPickupDate) finalPickupDate = null;
        
        let finalPickupTime = pickupTime || dbUser.pickup_time;
        if (!finalPickupTime) finalPickupTime = null;

        const cartRes = await pool.query(`SELECT c.*, p.name, p."price_A", p."price_B" FROM cart_items c JOIN products p ON CAST(c.product_id AS INTEGER) = p.id WHERE c.user_uuid = $1`, [user.uuid]);
        if (cartRes.rows.length === 0) return res.status(400).json({ message: "Empty" });

        const isB = dbUser.price_tier === 'B';
        const total = cartRes.rows.reduce((sum, item) => sum + (Number(isB ? item.price_B : item.price_A) * item.quantity), 0);
        const itemsJson = cartRes.rows.map(item => ({ id: item.product_id, name: item.name, qty: item.quantity, note: item.note, price: isB ? item.price_B : item.price_A }));
        const newOrderId = generateOrderId();

        await pool.query(
            `INSERT INTO orders (order_id, user_uuid, receiver_name, receiver_phone, address, pickup_type, pickup_date, pickup_time, items, total_amount, order_note, status, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'pending_review', NOW())`,
            [newOrderId, user.uuid, dbUser.store_name, dbUser.phone, finalAddress, finalDeliveryType, finalPickupDate, finalPickupTime, JSON.stringify(itemsJson), total, orderNote]
        );
        await pool.query("DELETE FROM cart_items WHERE user_uuid = $1", [user.uuid]);
        res.json({ message: "Order Sent", orderId: newOrderId });
    } catch (err) { 
        console.error("Checkout Error:", err);
        res.status(500).json({ message: "Error" }); 
    }
});

// --- 後台管理 API ---
app.get("/history", async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM orders ORDER BY created_at DESC');
        const formatted = result.rows.map(row => ({
            id: row.order_id,
            時間: moment(row.created_at).format('YYYY-MM-DD HH:mm'),
            rawTime: row.created_at,
            pickupDate: row.pickup_date,
            pickupTime: row.pickup_time,
            pickupType: row.pickup_type,
            storeName: row.receiver_name,
            total: row.total_amount,
            products: row.items,
            isPrinted: row.is_printed || false,
            user_uuid: row.user_uuid,
            status: row.status || 'pending',
            order_note: row.order_note
        }));
        res.json(formatted);
    } catch (err) { res.status(500).json([]); }
});

app.put("/api/orders/:id", async (req, res) => {
    const { id } = req.params;
    const { items, total, order_note } = req.body;
    try {
        await pool.query(
            "UPDATE orders SET items=$1, total_amount=$2, order_note=$3 WHERE order_id=$4",
            [JSON.stringify(items), total, order_note, id]
        );
        res.json({ message: "訂單已更新" });
    } catch (err) { res.status(500).json({ message: "更新失敗" }); }
});

app.put("/api/orders/:id/confirm", async (req, res) => {
    const { id } = req.params;
    const { pickupDate } = req.body;
    try {
        if (pickupDate) {
            await pool.query("UPDATE orders SET status = 'pending', pickup_date = $1 WHERE order_id = $2", [pickupDate, id]);
        } else {
            await pool.query("UPDATE orders SET status = 'pending' WHERE order_id = $1", [id]);
        }
        res.json({ message: "訂單已確認" });
    } catch (err) { res.status(500).json({ message: "Error" }); }
});

app.put("/api/orders/:id/complete", async (req, res) => {
    const { id } = req.params;
    try {
        await pool.query("UPDATE orders SET status = 'completed' WHERE order_id = $1", [id]);
        res.json({ message: "Completed" });
    } catch (err) { res.status(500).json({ message: "Error" }); }
});

app.get("/api/users", async (req, res) => {
    try {
        const result = await pool.query(`SELECT u.*, COUNT(o.order_id) as order_count, SUM(o.total_amount) as total_spent FROM users u LEFT JOIN orders o ON u.uuid = o.user_uuid GROUP BY u.uuid ORDER BY order_count DESC`);
        res.json(result.rows);
    } catch (err) { res.status(500).json([]); }
});

app.get("/api/orders/:id/print", async (req, res) => {
    const { id } = req.params; try { const orderRes = await pool.query("SELECT * FROM orders WHERE order_id = $1", [id]); if (orderRes.rows.length === 0) return res.status(404).send("無此訂單"); const order = orderRes.rows[0]; await pool.query("UPDATE orders SET is_printed = TRUE WHERE order_id = $1", [id]); const workbook = new ExcelJS.Workbook(); const sheet = workbook.addWorksheet('訂單明細'); sheet.columns = [{ header: '商品名稱', key: 'name', width: 30 }, { header: '數量', key: 'qty', width: 10 }, { header: '單價', key: 'price', width: 15 }, { header: '備註', key: 'note', width: 20 }, { header: '小計', key: 'subtotal', width: 15 }]; sheet.insertRow(1, [`訂單編號: ${order.order_id}`, `店家: ${order.receiver_name}`]); sheet.insertRow(2, [`電話: ${order.receiver_phone}`]); const typeStr = order.pickup_type === 'self' ? '自取' : '外送'; sheet.insertRow(3, [`方式: ${typeStr}`, `日期: ${order.pickup_date}`, `時段: ${order.pickup_time || '無'}`]); if (order.pickup_type === 'delivery') { sheet.insertRow(4, [`地址: ${order.address}`]); } sheet.insertRow(5, [`顧客整單備註: ${order.order_note || '無'}`]); sheet.insertRow(6, ['']); sheet.getRow(7).values = ['商品名稱', '數量', '單價', '商品備註', '小計']; sheet.getRow(7).font = { bold: true }; const products = order.items || []; let totalAmount = 0; products.forEach(p => { const sub = Number(p.price) * Number(p.qty); totalAmount += sub; sheet.addRow([p.name, p.qty, p.price, p.note, sub]); }); sheet.addRow(['', '', '', '總金額', totalAmount]); res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'); res.setHeader('Content-Disposition', `attachment; filename=order-${id}.xlsx`); await workbook.xlsx.write(res); res.end(); } catch (err) { res.status(500).send("列印失敗"); }
});

app.delete("/history/:id", async (req, res) => {
    try { await pool.query('DELETE FROM orders WHERE order_id = $1', [req.params.id]); res.json({ message: "已刪除" }); } catch (err) { res.status(500).json({ message: "刪除失敗" }); }
});

app.get("/api/my-history", requireAuth, async (req, res) => {
    const user = req.user;
    try {
        const result = await pool.query('SELECT * FROM orders WHERE user_uuid = $1 ORDER BY created_at DESC', [user.uuid]);
        const formatted = result.rows.map(row => ({
            id: row.order_id,
            時間: moment(row.created_at).format('YYYY-MM-DD HH:mm'),
            pickupDate: row.pickup_date,
            pickupTime: row.pickup_time,
            storeName: row.receiver_name,
            total: row.total_amount,
            products: row.items,
            isPrinted: row.is_printed || false
        }));
        res.json(formatted);
    } catch (err) { res.status(500).json([]); }
});

app.post("/api/admin/login", (req, res) => {
    try {
        const { username, password } = req.body;
        // ⭐ 這裡會讀取最上方已定義的 ADMIN_USERNAME
        if (username === ADMIN_USERNAME && password === ADMIN_PASSWORD) {
            const payload = { role: 'admin', username: 'admin' };
            const dataBase64 = Buffer.from(JSON.stringify(payload)).toString('base64');
            const signature = crypto.createHmac('sha256', SECRET_KEY).update(dataBase64).digest('hex');
            const token = `${dataBase64}.${signature}`;
            res.cookie("auth_token", token, { httpOnly: true, maxAge: 86400000 * 30, path: "/", secure: isProduction, sameSite: isProduction ? "None" : "Lax" });
            return res.json({ message: "管理員登入成功", success: true });
        }
        return res.status(401).json({ message: "帳號或密碼錯誤", success: false });
    } catch (err) { 
        console.error("Admin Login Error:", err);
        res.status(500).json({ message: "伺服器錯誤", error: err.message }); 
    }
});

app.use((req, res, next) => {
    if (req.path.startsWith("/api")) return next();
    res.sendFile(path.join(distPath, "index.html"));
});

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});