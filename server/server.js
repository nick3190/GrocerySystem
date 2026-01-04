import 'dotenv/config';
import express from "express";
import cors from "cors";
import crypto from 'crypto';
import cookieParser from 'cookie-parser';
import pool from './db.js'; // 確保 db.js 已設定好
import ExcelJS from 'exceljs'; // 新增
import moment from 'moment';   // 新增
import twilio from 'twilio';

import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 4000;
const SECRET_KEY = "YOUR_SECRET_KEY_FOR_JWT"; // 請務必更換為安全密鑰
const distPath = path.join(__dirname, "../dist");

app.use(express.static(path.join(distPath)));

let twilioClient;
if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN) {
    twilioClient = new twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
} else {
    console.warn("⚠️ 未偵測到 Twilio 環境變數，簡訊功能可能無法使用");
}

const isProduction = process.env.NODE_ENV === 'production';
const requireAuth = (req, res, next) => {
    const user = verifyToken(req);

    // ⭐ 本機開發方便測試用
    if (!isProduction && !user) {
        console.log("⚠️ 開發模式：使用模擬使用者身份");
        req.user = {
            uuid: "DEV-UUID",
            priceTier: "A",
            // 建議補上這兩行，避免某些 API 因為讀不到欄位報錯
            store_name: "開發測試店",
            phone: "0900000000"
        };
        return next();
    }

    // ⭐ 上線：一定要登入
    if (!user) return res.status(401).json({ message: "請先登入" });

    req.user = user;
    next();
};

// Middleware
app.use(cors({
    origin: isProduction
        ? ["https://grocerysystem-s04n.onrender.com"] // 上線後的網址
        : ["http://localhost:5173", "http://127.0.0.1:5173"], // 本地開發網址
    methods: ["GET", "POST", "PUT", "DELETE"],
    credentials: true // 允許攜帶 Cookie
}));

app.use(express.json());
app.use(cookieParser());

// --- Helper: JWT/Cookie 驗證 ---
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

// ================= API 路由 =================

// --- 1. 身份驗證 (無密碼/OTP) ---

// 發送驗證碼
app.post("/api/send-otp", async (req, res) => {
    // 前端傳來的 phone，Twilio 需要 E.164 格式 (+8869xxxxxxxx)
    // 這裡做個簡單處理：如果輸入 09 開頭，轉成 +8869...
    let { phone } = req.body;

    if (!phone) return res.status(400).json({ message: "請輸入手機號碼" });

    // 格式化台灣手機號碼 (將 09xx 轉為 +8869xx)
    if (phone.startsWith('09')) {
        phone = '+886' + phone.substring(1);
    }

    // 產生 4 位數驗證碼
    const code = Math.floor(1000 + Math.random() * 9000).toString();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5分鐘後過期

    try {
        // 先存入資料庫
        await pool.query(
            `INSERT INTO otps (phone, code, expires_at) VALUES ($1, $2, $3)
             ON CONFLICT (phone) DO UPDATE SET code = $2, expires_at = $3`,
            [phone, code, expiresAt]
        );

        // 3. 修改：判斷並發送簡訊
        if (twilioClient && process.env.TWILIO_PHONE_NUMBER) {
            await twilioClient.messages.create({
                body: `【元榮批發】您的驗證碼是：${code}，請於 5 分鐘內輸入。`,
                from: process.env.TWILIO_PHONE_NUMBER,
                to: phone
            });
            console.log(`✅ Twilio 簡訊已發送至 ${phone}`);
            res.json({ message: "驗證碼已發送" });
        } else {
            // 如果沒有設定 Twilio (例如本地開發)，還是印在 Console
            console.log(`=== 【開發模式/未設定Twilio】 手機: ${phone}, 驗證碼: ${code} ===`);
            res.json({ message: "驗證碼已發送 (開發模式: 請看 Console)" });
        }

    } catch (err) {
        console.error("簡訊發送錯誤:", err);
        // 如果是 Twilio 錯誤 (例如號碼未驗證)，回傳具體一點的訊息方便除錯
        if (err.code) {
            return res.status(500).json({ message: `簡訊發送失敗: ${err.message}` });
        }
        res.status(500).json({ message: "系統錯誤" });
    }
});

// 驗證 OTP 並登入
app.post("/api/verify-otp", async (req, res) => {
    const { phone, otp, storeName, deliveryType, address, pickupDate, pickupTime } = req.body;

    let formattedPhone = phone;
    if (formattedPhone.startsWith('09')) {
        formattedPhone = '+886' + formattedPhone.substring(1);
    }

    try {
        const otpResult = await pool.query('SELECT * FROM otps WHERE phone = $1', [formattedPhone]);
        if (otpResult.rows.length === 0) return res.status(400).json({ message: "驗證碼無效" });

        const record = otpResult.rows[0];
        if (new Date() > new Date(record.expires_at)) return res.status(400).json({ message: "驗證碼已過期" });
        if (record.code !== otp) return res.status(400).json({ message: "驗證碼錯誤" });

        // 更新或建立使用者
        let userResult = await pool.query('SELECT * FROM users WHERE phone = $1', [phone]);

        const sqlParams = [storeName, phone, deliveryType, address, pickupDate, pickupTime];

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

        const signature = crypto.createHmac('sha256', SECRET_KEY)
            .update(dataBase64)
            .digest('hex');

        const token = `${dataBase64}.${signature}`;

        await pool.query('DELETE FROM otps WHERE phone = $1', [phone]);
        res.cookie("auth_token", token, {
            httpOnly: true,
            maxAge: 86400000,
            path: "/",
            secure: isProduction ? true : false,          // localhost 必須 false
            sameSite: isProduction ? "None" : "Lax"      // <-- 改成 None（不是 Lax）
        });

        console.log("Cookie 設定完成，Token:", token.substring(0, 10) + "...");
        res.json({ message: "登入成功", user: payload });

    } catch (err) {
        console.error(err);
        res.status(500).json({ message: "登入失敗" });
    }
});

// 檢查登入狀態
app.get("/api/me", async (req, res) => {
    const tokenPayload = verifyToken(req);
    if (!tokenPayload) return res.status(401).json({ isAuthenticated: false });

    // 重新從資料庫撈取最新 User 資料 (確保取貨資訊是最新的)
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

// --- 2. 商品資料 API (包含篩選用的列表) ---

app.get("/products", async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM products ORDER BY name, id');
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ message: "無法讀取商品" });
    }
});

app.put("/products/:id", async (req, res) => {
    // 這裡不做 Admin 權限驗證 (簡化)，實際專案請加上
    const { id } = req.params;
    const { name, price_A, price_B, spec, unit, brand } = req.body;
    try {
        await pool.query(
            `UPDATE products SET name=$1, price_A=$2, price_B=$3, spec=$4, unit=$5, brand=$6 WHERE id=$7`,
            [name, price_A, price_B, spec, unit, brand, id]
        );
        res.json({ message: "更新成功" });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: "更新失敗" });
    }
});

// 新增：取得分類列表 (供前端篩選)
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

// 新增：取得品牌列表 (供前端篩選)
app.get("/api/brands", async (req, res) => {
    try {
        const result = await pool.query("SELECT DISTINCT brand FROM products WHERE brand IS NOT NULL AND brand != ''");
        res.json(result.rows.map(r => r.brand));
    } catch (err) { res.json([]); }
});

// --- 3. 購物車 API (需驗證) ---
app.get("/cart", requireAuth, async (req, res) => {
    const user = req.user;
    //const user = verifyToken(req);
    //if (!user) return res.status(401).json({ message: "請先登入" });
    try {
        // 根據等級決定價格
        // 注意：這裡假設 user 物件有 price_tier。若無，預設 A
        const tier = user.priceTier || user.price_tier || 'A';
        const priceColumn = tier === 'B' ? 'price_B' : 'price_A';

        const sql = `
            SELECT c.id, c.product_id, c.quantity, c.note, 
                   p.name, p.spec, p.unit, p.flavor, p.brand,
                   p.${priceColumn} as price
            FROM cart_items c
            JOIN products p ON c.product_id = CAST(p.id AS VARCHAR)
            WHERE c.user_uuid = $1
            ORDER BY c.created_at DESC
        `;
        const result = await pool.query(sql, [user.uuid]);
        res.json(result.rows);
    } catch (err) { 
        console.error("讀取購物車失敗:", err);
        res.status(500).json([]); }
});

app.post("/cart", requireAuth, async (req, res) => {
    const user = req.user;
    //const user = verifyToken(req);
    //if (!user) return res.status(401).send();
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
        res.status(500).json({ message: "加入失敗" });
    }
});

app.delete("/cart/:id", requireAuth, async (req, res) => {
    const user = req.user;
    //const user = verifyToken(req);
    //if (!user) return res.status(401).send();
    try {
        await pool.query('DELETE FROM cart_items WHERE id = $1 AND user_uuid = $2', [req.params.id, user.uuid]);
        res.json({ message: "已刪除" });
    } catch (err) {
        res.status(500).json({ message: "刪除失敗" });
    }
});

app.post("/api/checkout", requireAuth, async (req, res) => {
    const user = req.user;
    //const userToken = verifyToken(req);
    //if (!userToken) return res.status(401).json({ message: "請先登入" });

    const { orderNote } = req.body;

    try {
        // 1. 抓取完整使用者資料 (包含地址、時段等)
        const userRes = await pool.query("SELECT * FROM users WHERE uuid = $1", [user.uuid]);
        const dbUser = userRes.rows[0];

        // 2. 抓取購物車內容
        const cartRes = await pool.query(`
            SELECT c.*, p.name, p.price_A, p.price_B 
            FROM cart_items c JOIN products p ON c.product_id = CAST(p.id AS VARCHAR) 
            WHERE c.user_uuid = $1`, [user.uuid]);

        if (cartRes.rows.length === 0) return res.status(400).json({ message: "購物車是空的" });

        // 3. 計算總金額
        const isB = user.price_tier === 'B';
        const total = cartRes.rows.reduce((sum, item) => {
            const price = isB ? item.price_B : item.price_A;
            return sum + (Number(price) * item.quantity);
        }, 0);

        const productDetails = cartRes.rows.map(item => ({
            id: item.product_id,
            name: item.name,
            qty: item.quantity,
            note: item.note,
            price: isB ? item.price_B : item.price_A
        }));

        // 4. 寫入 orders (history) 表
        // 請確保您的 orders 表結構符合 INSERT
        const insertSql = `
            INSERT INTO orders 
            (user_uuid, receiver_name, receiver_phone, address, 
             pickup_type, pickup_date, pickup_time, 
             products, "總金額", order_note, created_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
        `;

        await pool.query(insertSql, [
            user.uuid, user.store_name, user.phone, user.address,
            user.delivery_type, user.pickup_date, user.pickup_time,
            JSON.stringify(productDetails), total, orderNote
        ]);

        // 5. 清空購物車
        await pool.query("DELETE FROM cart_items WHERE user_uuid = $1", [user.uuid]);

        res.json({ message: "訂單已送出" });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: "結帳失敗" });
    }
});

// --- 後台管理相關 ---

// 取得所有訂單 (需包含詳細欄位)
app.get("/history", async (req, res) => {
    try {
        // 這裡回傳全部，前端再做篩選，或在此做篩選皆可
        const result = await pool.query('SELECT * FROM orders ORDER BY created_at DESC');
        // 轉換欄位名稱以符合前端需求
        const formatted = result.rows.map(row => ({
            id: row.id,
            時間: moment(row.created_at).format('YYYY-MM-DD HH:mm'),
            rawTime: row.created_at, // 用於排序
            pickupDate: row.pickup_date,
            pickupTime: row.pickup_time,
            storeName: row.receiver_name,
            total: row.總金額,
            products: row.products,
            isPrinted: row.is_printed || false
        }));
        res.json(formatted);
    } catch (err) { res.status(500).json([]); }
});

// 下載 Excel 並標記為已列印
app.get("/api/orders/:id/print", async (req, res) => {
    const { id } = req.params;
    try {
        // 1. 撈訂單
        const orderRes = await pool.query("SELECT * FROM orders WHERE id = $1", [id]);
        if (orderRes.rows.length === 0) return res.status(404).send("無此訂單");
        const order = orderRes.rows[0];

        // 2. 更新列印狀態
        await pool.query("UPDATE orders SET is_printed = TRUE WHERE id = $1", [id]);

        // 3. 產生 Excel
        const workbook = new ExcelJS.Workbook();
        const sheet = workbook.addWorksheet('訂單明細');

        // 設定欄寬
        sheet.columns = [
            { header: '商品名稱', key: 'name', width: 30 },
            { header: '數量', key: 'qty', width: 10 },
            { header: '單價', key: 'price', width: 15 },
            { header: '備註', key: 'note', width: 20 },
            { header: '小計', key: 'subtotal', width: 15 },
        ];

        // 標頭資訊
        sheet.insertRow(1, [`訂單編號: ${order.id}`, `店家: ${order.receiver_name}`]);
        sheet.insertRow(2, [`電話: ${order.receiver_phone}`]);
        const typeStr = order.pickup_type === 'self' ? '自取' : '外送';
        const dateStr = order.pickup_date === 'today' ? '今日' : order.pickup_date;
        sheet.insertRow(3, [`方式: ${typeStr}`, `日期: ${dateStr}`, `時段: ${order.pickup_time || '無'}`]);
        if (order.pickup_type === 'delivery') {
            sheet.insertRow(4, [`地址: ${order.address}`]);
        }
        sheet.insertRow(5, [`顧客整單備註: ${order.order_note || '無'}`]);
        sheet.insertRow(6, ['']); // 空行

        // 插入表頭 (因為前面 insertRow，原本的 header row 會被推下去，需重新處理或直接手動加)
        sheet.getRow(7).values = ['商品名稱', '數量', '單價', '商品備註', '小計'];
        sheet.getRow(7).font = { bold: true };

        // 商品內容
        const products = order.products || []; // 假設資料庫存的是 JSON
        let totalAmount = 0;
        products.forEach(p => {
            const sub = Number(p.price) * Number(p.qty);
            totalAmount += sub;
            sheet.addRow([p.name, p.qty, p.price, p.note, sub]);
        });

        sheet.addRow(['', '', '', '總金額', totalAmount]);

        // 設定 Response Header 讓瀏覽器下載
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename=order-${id}.xlsx`);

        await workbook.xlsx.write(res);
        res.end();

    } catch (err) {
        console.error(err);
        res.status(500).send("列印失敗");
    }
});

// 刪除訂單 (維持原樣)
app.delete("/history/:id", async (req, res) => { /* ...略... */
    try {
        await pool.query('DELETE FROM orders WHERE id = $1', [req.params.id]);
        res.json({ message: "已刪除" });
    } catch (err) { res.status(500).json({ message: "刪除失敗" }); }
});


// 其他 api 路由都設定完後：
app.use((req, res, next) => {
    if (req.path.startsWith("/api")) return next();
    res.sendFile(path.join(distPath, "index.html"));
});


app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});