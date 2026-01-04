import 'dotenv/config';
import express from "express";
import cors from "cors";
import crypto from 'crypto';
import cookieParser from 'cookie-parser';
import pool from './db.js';
import ExcelJS from 'exceljs';
import moment from 'moment';
import twilio from 'twilio';

import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 4000;
const SECRET_KEY = process.env.SECRET_KEY || "YOUR_FALLBACK_SECRET_KEY"; 
const distPath = path.join(__dirname, "../dist");

app.use(express.static(path.join(distPath)));

let twilioClient;
if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN) {
    twilioClient = new twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
} else {
    console.warn("⚠️ 未偵測到 Twilio 環境變數，簡訊功能可能無法使用");
}

const isProduction = process.env.NODE_ENV === 'production';

// --- 工具函式 ---

// 1. 標準化手機號碼 (修復 09 開頭問題)
const formatPhone = (rawPhone) => {
    if (!rawPhone) return null;
    let p = rawPhone.toString().replace(/\s+/g, '').replace(/-/g, '');
    
    // 處理 +886 開頭
    if (p.startsWith('+886')) {
        // 如果是 +88609... 轉為 +8869...
        if (p.startsWith('+88609')) return '+886' + p.substring(5);
        return p;
    }
    // 處理 886 開頭
    if (p.startsWith('886')) {
        if (p.startsWith('88609')) return '+886' + p.substring(4);
        return '+' + p;
    }
    // 處理 09 開頭
    if (p.startsWith('09')) {
        return '+886' + p.substring(1);
    }
    return p;
};

// 2. 產生訂單編號
const generateOrderId = () => {
    const now = new Date();
    const dateStr = now.toISOString().replace(/[-T:.Z]/g, "").slice(0, 12);
    const random = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
    return `${dateStr}${random}`;
};

// 3. JWT 驗證
const verifyToken = (req) => {
    const token = req.cookies.auth_token;
    if (!token) return null;
    try {
        const [dataBase64, signature] = token.split('.');
        const newSignature = crypto.createHmac('sha256', SECRET_KEY).update(dataBase64).digest('hex');
        if (newSignature === signature) {
            return JSON.parse(Buffer.from(dataBase64, 'base64').toString());
        }
    } catch (e) { return null; }
    return null;
};

// Middleware
const requireAuth = (req, res, next) => {
    const user = verifyToken(req);
    if (!isProduction && !user) {
        console.log("⚠️ 開發模式：使用模擬使用者身份");
        req.user = {
            uuid: "DEV-UUID",
            priceTier: "A",
            store_name: "開發測試店",
            phone: "0900000000"
        };
        return next();
    }
    if (!user) return res.status(401).json({ message: "請先登入" });
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


// ================= API 路由 =================

// --- 1. 登入與驗證 ---

app.post("/api/send-otp", async (req, res) => {
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
                body: `【元榮批發】您的驗證碼是：${code}，請於 5 分鐘內輸入。`,
                from: process.env.TWILIO_PHONE_NUMBER,
                to: formattedPhone
            });
            console.log(`✅ Twilio 簡訊已發送至 ${formattedPhone}`);
            res.json({ message: "驗證碼已發送" });
        } else {
            console.log(`=== 【開發模式】 手機: ${formattedPhone}, 驗證碼: ${code} ===`);
            res.json({ message: "驗證碼已發送 (開發模式)" });
        }
    } catch (err) {
        console.error("簡訊發送錯誤:", err);
        if (err.code) return res.status(500).json({ message: `簡訊發送失敗: ${err.message}` });
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

        // 處理日期：如果前端傳來 'today'，轉為實際日期 YYYY-MM-DD，確保資料庫存的是日期
        let finalDate = pickupDate;
        if (pickupDate === 'today') {
            finalDate = moment().format('YYYY-MM-DD');
        }

        let userResult = await pool.query('SELECT * FROM users WHERE phone = $1', [formattedPhone]);

        // 確保 deliveryType 是 'self' 或 'delivery'
        // 如果是 delivery，清空自取時間
        const finalTime = deliveryType === 'delivery' ? '' : pickupTime;

        const sqlParams = [storeName, formattedPhone, deliveryType, address, finalDate, finalTime];

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
            httpOnly: true,
            maxAge: 86400000,
            path: "/",
            secure: isProduction,
            sameSite: isProduction ? "None" : "Lax"
        });

        res.json({ message: "登入成功", user: payload });

    } catch (err) {
        console.error(err);
        res.status(500).json({ message: "登入失敗" });
    }
});

app.get("/api/me", async (req, res) => {
    const tokenPayload = verifyToken(req);
    if (!tokenPayload) return res.status(401).json({ isAuthenticated: false });
    try {
        const userRes = await pool.query('SELECT * FROM users WHERE uuid = $1', [tokenPayload.uuid]);
        if (userRes.rows.length > 0) {
            res.json({ isAuthenticated: true, user: userRes.rows[0] });
        } else {
            res.json({ isAuthenticated: true, user: tokenPayload });
        }
    } catch (e) {
        res.json({ isAuthenticated: true, user: tokenPayload });
    }
});

app.post("/logout", (req, res) => {
    res.clearCookie('auth_token');
    res.json({ message: "已登出" });
});

// --- 2. 商品 API ---

app.get("/products", async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM products ORDER BY name, id');
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ message: "無法讀取商品" });
    }
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
    } catch (err) {
        console.error("更新商品失敗:", err);
        res.status(500).json({ message: "更新失敗" });
    }
});

app.get("/api/categories", async (req, res) => {
    try {
        const result = await pool.query('SELECT DISTINCT main_category, sub_category FROM products');
        const map = {};
        result.rows.forEach(row => {
            const main = row.main_category || '其他';
            const sub = row.sub_category || '其他';
            if (!map[main]) map[main] = [];
            if (!map[main].includes(sub)) map[main].push(sub);
        });
        res.json(map);
    } catch (err) { res.status(500).json({}); }
});

app.get("/api/brands", async (req, res) => {
    try {
        const result = await pool.query("SELECT DISTINCT brand FROM products WHERE brand IS NOT NULL AND brand != ''");
        res.json(result.rows.map(r => r.brand));
    } catch (err) { res.json([]); }
});

// --- 3. 購物車 API ---

app.get("/cart", requireAuth, async (req, res) => {
    const user = req.user;
    try {
        if (!user || !user.uuid) return res.status(401).json({ message: "使用者未授權" });
        const tier = user.priceTier || user.price_tier || 'A';
        const priceColumn = tier === 'B' ? 'price_B' : 'price_A';

        const sql = `
            SELECT c.id, c.product_id, c.quantity, c.note, 
                   p.name, p.spec, p.unit, p.brand,
                   p."${priceColumn}" as price
            FROM cart_items c
            JOIN products p ON CAST(c.product_id AS INTEGER) = p.id
            WHERE c.user_uuid = $1
            ORDER BY c.created_at DESC
        `;
        const result = await pool.query(sql, [user.uuid]);
        res.json(result.rows);
    } catch (err) {
        console.error("❌ 讀取購物車失敗:", err.message);
        res.status(500).json({ message: "伺服器內部錯誤", error: err.message });
    }
});

app.post("/cart", requireAuth, async (req, res) => {
    const user = req.user;
    const { productId, quantity, note } = req.body;
    try {
        await pool.query(
            `INSERT INTO cart_items (user_uuid, product_id, quantity, note)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (user_uuid, product_id) 
             DO UPDATE SET quantity = cart_items.quantity + $3, note = $4`,
            [user.uuid, productId, quantity, note]
        );
        res.json({ message: "已加入購物車" });
    } catch (err) {
        console.error("加入購物車失敗:", err);
        res.status(500).json({ message: "加入失敗" });
    }
});

app.delete("/cart/:id", requireAuth, async (req, res) => {
    const user = req.user;
    try {
        await pool.query('DELETE FROM cart_items WHERE id = $1 AND user_uuid = $2', [req.params.id, user.uuid]);
        res.json({ message: "已刪除" });
    } catch (err) { res.status(500).json({ message: "刪除失敗" }); }
});

// --- 4. 結帳與訂單 ---

app.post("/api/checkout", requireAuth, async (req, res) => {
    const user = req.user;
    const { orderNote } = req.body;

    try {
        const userRes = await pool.query("SELECT * FROM users WHERE uuid = $1", [user.uuid]);
        const dbUser = userRes.rows[0];

        const cartRes = await pool.query(`
            SELECT c.*, p.name, p."price_A", p."price_B" 
            FROM cart_items c 
            JOIN products p ON CAST(c.product_id AS INTEGER) = p.id 
            WHERE c.user_uuid = $1`, [user.uuid]);

        if (cartRes.rows.length === 0) return res.status(400).json({ message: "購物車是空的" });

        const isB = dbUser.price_tier === 'B';
        const total = cartRes.rows.reduce((sum, item) => {
            const price = isB ? item.price_B : item.price_A;
            return sum + (Number(price) * item.quantity);
        }, 0);

        const itemsJson = cartRes.rows.map(item => ({
            id: item.product_id,
            name: item.name,
            qty: item.quantity,
            note: item.note,
            price: isB ? item.price_B : item.price_A
        }));

        const newOrderId = generateOrderId();

        // 確保使用 DB 中最新的 pickup_date (這在 verify-otp 時已經確保不是 'today' 而是日期)
        const insertSql = `
            INSERT INTO orders 
            (order_id, user_uuid, receiver_name, receiver_phone, address, 
             pickup_type, pickup_date, pickup_time, 
             items, total_amount, order_note, created_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW())
        `;

        await pool.query(insertSql, [
            newOrderId, 
            user.uuid, 
            dbUser.store_name, 
            dbUser.phone,      
            dbUser.address, 
            dbUser.delivery_type, 
            dbUser.pickup_date, 
            dbUser.pickup_time,
            JSON.stringify(itemsJson), 
            total,           
            orderNote
        ]);

        await pool.query("DELETE FROM cart_items WHERE user_uuid = $1", [user.uuid]);

        res.json({ message: "訂單已送出", orderId: newOrderId });
    } catch (err) {
        console.error("結帳失敗:", err);
        res.status(500).json({ message: "結帳失敗", error: err.message });
    }
});

// --- 後台管理 API ---

// 1. 取得所有訂單 (給 Admin)
app.get("/history", async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM orders ORDER BY created_at DESC');
        const formatted = result.rows.map(row => ({
            id: row.order_id,
            時間: moment(row.created_at).format('YYYY-MM-DD HH:mm'),
            rawTime: row.created_at,
            pickupDate: row.pickup_date, // 這裡會是 YYYY-MM-DD
            pickupTime: row.pickup_time,
            storeName: row.receiver_name,
            total: row.total_amount,
            products: row.items,
            isPrinted: row.is_printed || false,
            // 補上使用者資訊以便關聯
            user_uuid: row.user_uuid 
        }));
        res.json(formatted);
    } catch (err) { 
        console.error("讀取歷史訂單失敗:", err);
        res.status(500).json([]); 
    }
});

// 2. 取得使用者列表 (給 Admin)
app.get("/api/users", async (req, res) => {
    try {
        const sql = `
            SELECT u.*, 
                   COUNT(o.order_id) as order_count,
                   SUM(o.total_amount) as total_spent
            FROM users u
            LEFT JOIN orders o ON u.uuid = o.user_uuid
            GROUP BY u.uuid
            ORDER BY order_count DESC  -- 改成依訂單數排序
        `;
        const result = await pool.query(sql);
        res.json(result.rows);
    } catch (err) {
        console.error("讀取使用者失敗:", err);
        res.status(500).json([]);
    }
});

// 3. 列印功能 (修正 items 和 total_amount)
app.get("/api/orders/:id/print", async (req, res) => {
    const { id } = req.params;
    try {
        const orderRes = await pool.query("SELECT * FROM orders WHERE order_id = $1", [id]);
        if (orderRes.rows.length === 0) return res.status(404).send("無此訂單");
        const order = orderRes.rows[0];

        await pool.query("UPDATE orders SET is_printed = TRUE WHERE order_id = $1", [id]);

        const workbook = new ExcelJS.Workbook();
        const sheet = workbook.addWorksheet('訂單明細');

        sheet.columns = [
            { header: '商品名稱', key: 'name', width: 30 },
            { header: '數量', key: 'qty', width: 10 },
            { header: '單價', key: 'price', width: 15 },
            { header: '備註', key: 'note', width: 20 },
            { header: '小計', key: 'subtotal', width: 15 },
        ];

        sheet.insertRow(1, [`訂單編號: ${order.order_id}`, `店家: ${order.receiver_name}`]);
        sheet.insertRow(2, [`電話: ${order.receiver_phone}`]);
        const typeStr = order.pickup_type === 'self' ? '自取' : '外送';
        sheet.insertRow(3, [`方式: ${typeStr}`, `日期: ${order.pickup_date}`, `時段: ${order.pickup_time || '無'}`]);
        if (order.pickup_type === 'delivery') {
            sheet.insertRow(4, [`地址: ${order.address}`]);
        }
        sheet.insertRow(5, [`顧客整單備註: ${order.order_note || '無'}`]);
        sheet.insertRow(6, ['']); 

        sheet.getRow(7).values = ['商品名稱', '數量', '單價', '商品備註', '小計'];
        sheet.getRow(7).font = { bold: true };

        const products = order.items || []; 
        let totalAmount = 0;
        products.forEach(p => {
            const sub = Number(p.price) * Number(p.qty);
            totalAmount += sub;
            sheet.addRow([p.name, p.qty, p.price, p.note, sub]);
        });

        sheet.addRow(['', '', '', '總金額', totalAmount]);

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename=order-${id}.xlsx`);

        await workbook.xlsx.write(res);
        res.end();

    } catch (err) {
        console.error(err);
        res.status(500).send("列印失敗");
    }
});

app.delete("/history/:id", async (req, res) => {
    try {
        await pool.query('DELETE FROM orders WHERE order_id = $1', [req.params.id]);
        res.json({ message: "已刪除" });
    } catch (err) { res.status(500).json({ message: "刪除失敗" }); }
});

// --- User 端歷史訂單 API (專屬該 User) ---
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
    } catch (err) {
        console.error("讀取個人訂單失敗:", err);
        res.status(500).json([]);
    }
});


app.use((req, res, next) => {
    if (req.path.startsWith("/api")) return next();
    res.sendFile(path.join(distPath, "index.html"));
});

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});