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
import {
    fileURLToPath
} from 'url';

import multer from 'multer';
import fs from 'fs';

const ADMIN_USERNAME = process.env.ADMIN_USERNAME;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const SECRET_KEY = process.env.SECRET_KEY;
const __dirname = path.dirname(fileURLToPath(
    import.meta.url));
const app = express();
const PORT = process.env.PORT || 4000;
app.set('trust proxy', 1);
const distPath = path.join(__dirname, "../dist");
app.use(express.static(path.join(distPath)));
let twilioClient;
if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN) {
    twilioClient = new twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
}
const isProduction = process.env.NODE_ENV === 'production';

//圖片上傳
const uploadDir = path.join(distPath, "images");
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, uploadDir); // 存到靜態目錄
    },
    filename: function (req, file, cb) {
        // 防止檔名重複，加上時間戳記
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        // 保留副檔名
        const ext = path.extname(file.originalname);
        cb(null, 'upload-' + uniqueSuffix + ext);
    }
});

const upload = multer({ storage: storage });

// --- 初始化資料庫 ---
const initDb = async () => {
    try {
        // 1. Bundles 表
        await pool.query(`
            CREATE TABLE IF NOT EXISTS bundles (
                id SERIAL PRIMARY KEY,
                title VARCHAR(100),
                image VARCHAR(255),
                filter_type VARCHAR(50), 
                filter_value VARCHAR(100),
                product_ids TEXT, 
                created_at TIMESTAMP DEFAULT NOW()
            )
        `);
        // 2. Settings 表 (儲存全域設定，如利潤比例)
        await pool.query(`
            CREATE TABLE IF NOT EXISTS settings (
                key VARCHAR(50) PRIMARY KEY,
                value VARCHAR(255)
            )
        `);
        // 3. 補足 products 表格缺少的欄位
        const newColumns = ["flavor VARCHAR(50)", "spec VARCHAR(50)", "unit VARCHAR(20)", "alias VARCHAR(100)", "image VARCHAR(255)", "rec_price NUMERIC", "standard_cost NUMERIC", "brand VARCHAR(50)", "saler VARCHAR(50)", "price_A NUMERIC", "price_B NUMERIC", "main_category VARCHAR(50)", "sub_category VARCHAR(50)"];
        for (const col of newColumns) {
            const colName = col.split(' ')[0];
            await pool.query(`
                DO $$ 
                BEGIN 
                    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='products' AND column_name='${colName}') THEN 
                        ALTER TABLE products ADD COLUMN ${col}; 
                    END IF; 
                END $$;
            `);
        }
        // 初始化預設利潤設定
        await pool.query(`INSERT INTO settings (key, value) VALUES ('profit_ratio', '1.2') ON CONFLICT (key) DO NOTHING`);
        console.log("Database initialized & columns checked");
    } catch (e) {
        console.error("DB Init Error:", e);
    }
};
initDb();
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
    } catch (e) {
        return null;
    }
    return null;
};
const requireAuth = (req, res, next) => {
    const user = verifyToken(req);
    if (!isProduction && !user) {
        req.user = {
            uuid: "DEV-UUID",
            priceTier: "A",
            store_name: "開發測試店",
            phone: "0900000000"
        };
        return next();
    }
    if (!user) return res.status(401).json({
        message: "Token 無效或已過期"
    });
    req.user = user;
    next();
};
app.use(cors({
    origin: isProduction ? ["https://grocerysystem-s04n.onrender.com"] : ["http://localhost:5173", "http://127.0.0.1:5173"],
    methods: ["GET", "POST", "PUT", "DELETE"],
    credentials: true
}));
app.use(express.json());
app.use(cookieParser());
const otpLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 10,
    message: {
        message: "簡訊發送過於頻繁"
    }
});
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 200,
    standardHeaders: true,
    legacyHeaders: false
});
app.use('/api', limiter);
// ================= API 路由 =================
// --- 設定 (Settings) API ---
app.get("/api/settings", async (req, res) => {
    try {
        const result = await pool.query("SELECT * FROM settings");
        const settings = {};
        result.rows.forEach(row => settings[row.key] = row.value);
        res.json(settings);
    } catch (e) {
        res.status(500).json({});
    }
});
app.put("/api/settings", async (req, res) => {
    const {
        key,
        value
    } = req.body;
    try {
        await pool.query("INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = $2", [key, value]);
        res.json({
            message: "設定已更新"
        });
    } catch (e) {
        res.status(500).json({
            message: "更新失敗"
        });
    }
});
// --- 商品相關 ---
app.get("/products", async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM products ORDER BY name, id');
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({
            message: "Error"
        });
    }
});
app.put("/products/:id", async (req, res) => {
    const { id } = req.params;
    const {
        name, price_A, price_B, spec, unit, brand, image, flavor,
        rec_price, standard_cost, profit, saler, alias, main_category, sub_category
    } = req.body;
    try {
        // 確保 profit 有被放入
        await pool.query(`UPDATE products SET 
                name=$1, "price_A"=$2, "price_B"=$3, spec=$4, unit=$5, brand=$6, image=$7,
                flavor=$8, rec_price=$9, standard_cost=$10, profit=$11, saler=$12, alias=$13, main_category=$14, sub_category=$15
             WHERE id=$16`,
            [name, price_A, price_B, spec, unit, brand, image, flavor, rec_price, standard_cost, profit || 0, saler, alias, main_category, sub_category, id]);
        res.json({ message: "更新成功" });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Error" });
    }
});
// ⭐ 批量套用利潤設定
app.post("/api/products/apply-profit", async (req, res) => {
    const {
        ratio
    } = req.body; // 例如 1.2
    if (!ratio || isNaN(ratio)) return res.status(400).json({
        message: "無效的比例"
    });
    try {
        // 將所有商品的 price_A 更新為 standard_cost * ratio (四捨五入)
        // 僅針對 standard_cost 有值的商品
        await pool.query(`
            UPDATE products 
            SET "price_A" = ROUND(standard_cost * $1)
            WHERE standard_cost IS NOT NULL AND standard_cost > 0
        `, [ratio]);
        res.json({
            message: "已套用至所有商品"
        });
    } catch (e) {
        console.error(e);
        res.status(500).json({
            message: "套用失敗"
        });
    }
});

// 匯出所有商品為 Excel
app.get("/api/products/export", async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM products ORDER BY id');
        const workbook = new ExcelJS.Workbook();
        const sheet = workbook.addWorksheet('商品列表');

        // 設定表頭
        sheet.columns = [
            { header: 'ID', key: 'id', width: 10 },
            { header: '品名', key: 'name', width: 30 },
            { header: '規格', key: 'spec', width: 15 },
            { header: '口味', key: 'flavor', width: 15 },
            { header: '品牌', key: 'brand', width: 15 },
            { header: '分類', key: 'main_category', width: 15 },
            { header: '子分類', key: 'sub_category', width: 15 },
            { header: '供應商', key: 'saler', width: 20 },
            { header: '成本', key: 'standard_cost', width: 10 },
            { header: '售價A', key: 'price_A', width: 10 },
            { header: '售價B', key: 'price_B', width: 10 },
            { header: '建議售價', key: 'rec_price', width: 10 },
            { header: '單位', key: 'unit', width: 10 },
            { header: '別名', key: 'alias', width: 20 },
        ];

        // 填入資料
        result.rows.forEach(p => {
            sheet.addRow(p);
        });

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename=all_products_${Date.now()}.xlsx`);
        await workbook.xlsx.write(res);
        res.end();
    } catch (err) {
        console.error(err);
        res.status(500).send("匯出失敗");
    }
});

// --- 套組 (Bundles) API ---
app.get("/api/bundles", async (req, res) => {
    try {
        const result = await pool.query("SELECT * FROM bundles ORDER BY id DESC");
        res.json(result.rows);
    } catch (e) {
        res.status(500).json([]);
    }
});
app.post("/api/bundles", async (req, res) => {
    const {
        title,
        image,
        filterType,
        filterValue,
        productIds
    } = req.body;
    try {
        const idsString = (productIds && Array.isArray(productIds)) ? productIds.join(',') : '';
        await pool.query("INSERT INTO bundles (title, image, filter_type, filter_value, product_ids) VALUES ($1, $2, $3, $4, $5)", [title, image, filterType, filterValue, idsString]);
        res.json({
            message: "套組已建立"
        });
    } catch (e) {
        console.error(e);
        res.status(500).json({
            message: "建立失敗"
        });
    }
});
app.put("/api/bundles/:id", async (req, res) => {
    const {
        id
    } = req.params;
    const {
        title,
        image,
        filterType,
        filterValue,
        productIds
    } = req.body;
    try {
        const idsString = (productIds && Array.isArray(productIds)) ? productIds.join(',') : '';
        await pool.query("UPDATE bundles SET title=$1, image=$2, filter_type=$3, filter_value=$4, product_ids=$5 WHERE id=$6", [title, image, filterType, filterValue, idsString, id]);
        res.json({
            message: "套組已更新"
        });
    } catch (e) {
        console.error(e);
        res.status(500).json({
            message: "更新失敗"
        });
    }
});
app.delete("/api/bundles/:id", async (req, res) => {
    try {
        await pool.query("DELETE FROM bundles WHERE id = $1", [req.params.id]);
        res.json({
            message: "已刪除"
        });
    } catch (e) {
        res.status(500).json({
            message: "刪除失敗"
        });
    }
});
// --- 使用者管理 API ---
app.get("/api/users", async (req, res) => {
    try {
        const result = await pool.query(`SELECT u.*, COUNT(o.order_id) as order_count, SUM(o.total_amount) as total_spent FROM users u LEFT JOIN orders o ON u.uuid = o.user_uuid GROUP BY u.uuid ORDER BY order_count DESC`);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json([]);
    }
});
app.put("/api/users/:uuid", async (req, res) => {
    const {
        uuid
    } = req.params;
    const {
        store_name,
        phone,
        price_tier
    } = req.body;
    try {
        await pool.query("UPDATE users SET store_name=$1, phone=$2, price_tier=$3 WHERE uuid=$4", [store_name, phone, price_tier, uuid]);
        res.json({
            message: "使用者已更新"
        });
    } catch (e) {
        console.error(e);
        res.status(500).json({
            message: "更新失敗"
        });
    }
});
// --- 其他標準 API ---
app.get("/api/lookup-user", async (req, res) => {
    const {
        phone
    } = req.query;
    const formatted = formatPhone(phone);
    if (!formatted) return res.json({
        found: false
    });
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
            res.json({
                found: false
            });
        }
    } catch (e) {
        res.status(500).json({
            found: false
        });
    }
});
app.post("/api/send-otp", otpLimiter, async (req, res) => {
    let {
        phone
    } = req.body;
    const formattedPhone = formatPhone(phone);
    if (!formattedPhone) return res.status(400).json({
        message: "手機號碼格式錯誤"
    });
    const code = Math.floor(1000 + Math.random() * 9000).toString();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);
    try {
        await pool.query(`INSERT INTO otps (phone, code, expires_at) VALUES ($1, $2, $3) ON CONFLICT (phone) DO UPDATE SET code = $2, expires_at = $3`, [formattedPhone, code, expiresAt]);
        if (twilioClient && process.env.TWILIO_PHONE_NUMBER) {
            await twilioClient.messages.create({
                body: `【元榮批發】驗證碼：${code}`,
                from: process.env.TWILIO_PHONE_NUMBER,
                to: formattedPhone
            });
            res.json({
                message: "已發送"
            });
        } else {
            console.log(`=== OTP: ${code} ===`);
            res.json({
                message: "驗證碼已發送 (開發模式)"
            });
        }
    } catch (err) {
        res.status(500).json({
            message: "系統錯誤"
        });
    }
});
app.post("/api/verify-otp", async (req, res) => {
    const {
        phone,
        otp,
        storeName,
        deliveryType,
        address,
        pickupDate,
        pickupTime
    } = req.body;
    const formattedPhone = formatPhone(phone);
    try {
        const otpResult = await pool.query('SELECT * FROM otps WHERE phone = $1', [formattedPhone]);
        if (otpResult.rows.length === 0) return res.status(400).json({
            message: "驗證碼無效"
        });
        const record = otpResult.rows[0];
        if (new Date() > new Date(record.expires_at)) return res.status(400).json({
            message: "已過期"
        });
        if (record.code !== otp) return res.status(400).json({
            message: "錯誤"
        });
        let finalDate = pickupDate === 'today' ? moment().format('YYYY-MM-DD') : pickupDate;
        if (!finalDate) finalDate = null;
        const finalTime = (deliveryType === 'delivery' || !pickupTime) ? null : pickupTime;
        const safeAddress = address || '';
        let userResult = await pool.query('SELECT * FROM users WHERE phone = $1', [formattedPhone]);
        if (userResult.rows.length === 0) {
            userResult = await pool.query(`INSERT INTO users (store_name, phone, delivery_type, address, pickup_date, pickup_time, price_tier) VALUES ($1, $2, $3, $4, $5, $6, 'A') RETURNING *`, [storeName, formattedPhone, deliveryType, safeAddress, finalDate, finalTime]);
        } else {
            userResult = await pool.query(`UPDATE users SET store_name = $1, delivery_type = $3, address = $4, pickup_date = $5, pickup_time = $6 WHERE phone = $2 RETURNING *`, [storeName, formattedPhone, deliveryType, safeAddress, finalDate, finalTime]);
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
        const token = `${Buffer.from(JSON.stringify(payload)).toString('base64')}.${crypto.createHmac('sha256', SECRET_KEY).update(Buffer.from(JSON.stringify(payload)).toString('base64')).digest('hex')}`;
        await pool.query('DELETE FROM otps WHERE phone = $1', [formattedPhone]);
        res.cookie("auth_token", token, {
            httpOnly: true,
            maxAge: 86400000 * 30,
            path: "/",
            secure: isProduction,
            sameSite: isProduction ? "None" : "Lax"
        });
        res.json({
            message: "登入成功",
            user: payload
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({
            message: "Login Error"
        });
    }
});
app.get("/api/me", requireAuth, async (req, res) => {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    try {
        const userRes = await pool.query('SELECT * FROM users WHERE uuid = $1', [req.user.uuid]);
        if (userRes.rows.length > 0) {
            const u = userRes.rows[0];
            res.json({
                isAuthenticated: true,
                user: {
                    ...u,
                    deliveryType: u.delivery_type,
                    pickupDate: u.pickup_date,
                    pickupTime: u.pickup_time,
                    storeName: u.store_name
                }
            });
        } else {
            res.json({
                isAuthenticated: true,
                user: req.user
            });
        }
    } catch (e) {
        res.json({
            isAuthenticated: true,
            user: req.user
        });
    }
});
app.post("/logout", (req, res) => {
    res.clearCookie('auth_token');
    res.json({
        message: "已登出"
    });
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
    } catch (err) {
        res.status(500).json({});
    }
});
app.get("/api/brands", async (req, res) => {
    try {
        const result = await pool.query("SELECT DISTINCT brand FROM products WHERE brand IS NOT NULL AND brand != ''");
        res.json(result.rows.map(r => r.brand));
    } catch (err) {
        res.json([]);
    }
});
app.get("/cart", requireAuth, async (req, res) => {
    try {
        const tier = req.user.priceTier || 'A';
        const priceCol = tier === 'B' ? 'price_B' : 'price_A';
        // ⭐ 修改：多抓 image 和 standard_cost
        const sql = `SELECT c.id, c.product_id, c.quantity, c.note, p.name, p.spec, p.flavor, p.unit, p.brand, p.image, p."${priceCol}" as price, p.standard_cost 
                     FROM cart_items c JOIN products p ON CAST(c.product_id AS INTEGER) = p.id 
                     WHERE c.user_uuid = $1 ORDER BY c.created_at DESC`;
        const result = await pool.query(sql, [req.user.uuid]);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ message: "Error" });
    }
});

app.put("/cart/:id", requireAuth, async (req, res) => {
    const { quantity } = req.body;
    try {
        if (quantity <= 0) {
            await pool.query('DELETE FROM cart_items WHERE id = $1 AND user_uuid = $2', [req.params.id, req.user.uuid]);
        } else {
            await pool.query('UPDATE cart_items SET quantity = $1 WHERE id = $2 AND user_uuid = $3', [quantity, req.params.id, req.user.uuid]);
        }
        res.json({ message: "Updated" });
    } catch (err) {
        res.status(500).json({ message: "Error" });
    }
});

app.post("/cart", requireAuth, async (req, res) => {
    const {
        productId,
        quantity,
        note
    } = req.body;
    try {
        await pool.query(`INSERT INTO cart_items (user_uuid, product_id, quantity, note) VALUES ($1, $2, $3, $4) ON CONFLICT (user_uuid, product_id) DO UPDATE SET quantity = cart_items.quantity + $3, note = $4`, [req.user.uuid, productId, quantity, note]);
        res.json({
            message: "已加入"
        });
    } catch (err) {
        res.status(500).json({
            message: "Error"
        });
    }
});
app.post("/cart/batch", requireAuth, async (req, res) => {
    const {
        items
    } = req.body;
    if (!items || !Array.isArray(items)) return res.status(400).json({
        message: "格式錯誤"
    });
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const query = `INSERT INTO cart_items (user_uuid, product_id, quantity, note) VALUES ($1, $2, $3, $4) ON CONFLICT (user_uuid, product_id) DO UPDATE SET quantity = cart_items.quantity + $3`;
        for (const item of items) {
            await client.query(query, [req.user.uuid, item.productId, item.quantity, item.note || '']);
        }
        await client.query('COMMIT');
        res.json({
            message: `已加入 ${items.length} 項商品`
        });
    } catch (e) {
        await client.query('ROLLBACK');
        console.error(e);
        res.status(500).json({
            message: "批次加入失敗"
        });
    } finally {
        client.release();
    }
});
app.delete("/cart/:id", requireAuth, async (req, res) => {
    try {
        await pool.query('DELETE FROM cart_items WHERE id = $1 AND user_uuid = $2', [req.params.id, req.user.uuid]);
        res.json({
            message: "已刪除"
        });
    } catch (err) {
        res.status(500).json({});
    }
});
app.post("/api/checkout", requireAuth, async (req, res) => {
    const { orderNote, deliveryType, address, pickupDate, pickupTime } = req.body;
    try {
        const userRes = await pool.query("SELECT * FROM users WHERE uuid = $1", [req.user.uuid]);
        const dbUser = userRes.rows[0];
        const finalDeliveryType = deliveryType || dbUser.delivery_type;
        const finalAddress = address || dbUser.address;
        let finalPickupDate = pickupDate || dbUser.pickup_date;
        if (!finalPickupDate) finalPickupDate = null;
        let finalPickupTime = pickupTime || dbUser.pickup_time;
        if (!finalPickupTime) finalPickupTime = null;

        // ⭐ 這裡多抓 standard_cost
        const cartRes = await pool.query(`SELECT c.*, p.name, p."price_A", p."price_B", p.image, p.flavor, p.standard_cost FROM cart_items c JOIN products p ON CAST(c.product_id AS INTEGER) = p.id WHERE c.user_uuid = $1`, [req.user.uuid]);

        if (cartRes.rows.length === 0) return res.status(400).json({ message: "Empty" });

        const isB = dbUser.price_tier === 'B';
        const total = cartRes.rows.reduce((sum, item) => sum + (Number(isB ? item.price_B : item.price_A) * item.quantity), 0);

        const itemsJson = cartRes.rows.map(item => ({
            id: item.product_id,
            name: item.name,
            qty: item.quantity,
            note: item.note,
            price: isB ? item.price_B : item.price_A,
            cost: item.standard_cost || 0, // ⭐ 紀錄成本到訂單 JSON
            image: item.image,
            flavor: item.flavor
        }));

        const newOrderId = generateOrderId();
        await pool.query(`INSERT INTO orders (order_id, user_uuid, receiver_name, receiver_phone, address, pickup_type, pickup_date, pickup_time, items, total_amount, order_note, status, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'pending_review', NOW())`,
            [newOrderId, req.user.uuid, dbUser.store_name, dbUser.phone, finalAddress, finalDeliveryType, finalPickupDate, finalPickupTime, JSON.stringify(itemsJson), total, orderNote]);

        await pool.query("DELETE FROM cart_items WHERE user_uuid = $1", [req.user.uuid]);
        res.json({ message: "Order Sent", orderId: newOrderId });
    } catch (err) {
        console.error("Checkout Error:", err);
        res.status(500).json({ message: "Error" });
    }
});
app.get("/history", async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM orders ORDER BY created_at DESC');
        res.json(result.rows.map(row => ({
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
        })));
    } catch (err) {
        res.status(500).json([]);
    }
});
app.put("/api/orders/:id", async (req, res) => {
    const {
        items,
        total,
        order_note,
        pickup_date,  // 新增接收
        pickup_type,  // 新增接收
        is_printed    // 新增接收
    } = req.body;

    try {
        await pool.query(
            `UPDATE orders SET 
                items=$1, 
                total_amount=$2, 
                order_note=$3, 
                pickup_date=$4, 
                pickup_type=$5, 
                is_printed=$6 
             WHERE order_id=$7`,
            [
                JSON.stringify(items),
                total,
                order_note,
                pickup_date,
                pickup_type,
                is_printed,
                req.params.id
            ]
        );
        res.json({ message: "訂單已更新" });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: "更新失敗" });
    }
});

app.put("/api/orders/:id/confirm", async (req, res) => {
    const {
        pickupDate
    } = req.body;
    try {
        if (pickupDate) await pool.query("UPDATE orders SET status = 'pending', pickup_date = $1 WHERE order_id = $2", [pickupDate, req.params.id]);
        else await pool.query("UPDATE orders SET status = 'pending' WHERE order_id = $1", [req.params.id]);
        res.json({
            message: "訂單已確認"
        });
    } catch (err) {
        res.status(500).json({
            message: "Error"
        });
    }
});
app.put("/api/orders/:id/complete", async (req, res) => {
    try {
        await pool.query("UPDATE orders SET status = 'completed' WHERE order_id = $1", [req.params.id]);
        res.json({
            message: "Completed"
        });
    } catch (err) {
        res.status(500).json({
            message: "Error"
        });
    }
});
app.get("/api/orders/:id/print", async (req, res) => { /* ...省略... */
    const {
        id
    } = req.params;
    try {
        const orderRes = await pool.query("SELECT * FROM orders WHERE order_id = $1", [id]);
        if (orderRes.rows.length === 0) return res.status(404).send("無此訂單");
        const order = orderRes.rows[0];
        await pool.query("UPDATE orders SET is_printed = TRUE WHERE order_id = $1", [id]);
        const workbook = new ExcelJS.Workbook();
        const sheet = workbook.addWorksheet('訂單明細');
        sheet.columns = [{
            header: '商品名稱',
            key: 'name',
            width: 30
        }, {
            header: '數量',
            key: 'qty',
            width: 10
        }, {
            header: '單價',
            key: 'price',
            width: 15
        }, {
            header: '備註',
            key: 'note',
            width: 20
        }, {
            header: '小計',
            key: 'subtotal',
            width: 15
        }];
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
        sheet.getRow(7).font = {
            bold: true
        };
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
        res.status(500).send("列印失敗");
    }
});
app.delete("/history/:id", async (req, res) => {
    try {
        await pool.query('DELETE FROM orders WHERE order_id = $1', [req.params.id]);
        res.json({
            message: "已刪除"
        });
    } catch (err) {
        res.status(500).json({
            message: "刪除失敗"
        });
    }
});
app.get("/api/my-history", requireAuth, async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM orders WHERE user_uuid = $1 ORDER BY created_at DESC', [req.user.uuid]);
        res.json(result.rows.map(row => ({
            id: row.order_id,
            時間: moment(row.created_at).format('YYYY-MM-DD HH:mm'),
            pickupDate: row.pickup_date,
            pickupTime: row.pickup_time,
            storeName: row.receiver_name,
            total: row.total_amount,
            products: row.items,
            isPrinted: row.is_printed || false
        })));
    } catch (err) {
        res.status(500).json([]);
    }
});
app.post("/api/admin/login", (req, res) => {
    try {
        const {
            username,
            password
        } = req.body;
        if (username === ADMIN_USERNAME && password === ADMIN_PASSWORD) {
            const payload = {
                role: 'admin',
                username: 'admin'
            };
            const dataBase64 = Buffer.from(JSON.stringify(payload)).toString('base64');
            const signature = crypto.createHmac('sha256', SECRET_KEY).update(dataBase64).digest('hex');
            const token = `${dataBase64}.${signature}`;
            res.cookie("auth_token", token, {
                httpOnly: true,
                maxAge: 86400000 * 30,
                path: "/",
                secure: isProduction,
                sameSite: isProduction ? "None" : "Lax"
            });
            return res.json({
                message: "管理員登入成功",
                success: true
            });
        }
        return res.status(401).json({
            message: "帳號或密碼錯誤",
            success: false
        });
    } catch (err) {
        res.status(500).json({
            message: "伺服器錯誤",
            error: err.message
        });
    }
});

app.post("/products", async (req, res) => {
    const { name, price_A, price_B, spec, unit, brand, image, flavor, rec_price, standard_cost, profit, saler, alias, main_category, sub_category } = req.body;
    try {
        await pool.query(
            `INSERT INTO products 
            (name, "price_A", "price_B", spec, unit, brand, image, flavor, rec_price, standard_cost, profit, saler, alias, main_category, sub_category)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
            RETURNING *`,
            [name, price_A || 0, price_B || 0, spec || '', unit || '', brand || '', image || '', flavor || '', rec_price || 0, standard_cost || 0, profit || 0, saler || '', alias || '', main_category || '', sub_category || '']
        );
        res.json({ message: "新增成功" });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: "新增失敗" });
    }
});

app.delete("/products/:id", async (req, res) => {
    const { id } = req.params;
    try {
        // 執行資料庫刪除
        const result = await pool.query("DELETE FROM products WHERE id = $1", [id]);

        if (result.rowCount === 0) {
            return res.status(404).json({ message: "找不到該商品 ID" });
        }

        res.json({ message: "刪除成功" });
    } catch (err) {
        console.error("Delete Product Error:", err);
        // 如果商品已經被放入購物車或訂單，資料庫可能會因為外鍵約束 (Foreign Key) 而報錯
        if (err.code === '23503') {
            return res.status(400).json({ message: "無法刪除：此商品已存在於訂單或購物車中，請先處理相關資料。" });
        }
        res.status(500).json({ message: "刪除失敗", error: err.message });
    }
});

app.post("/api/upload", upload.single('file'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ message: "沒有上傳檔案" });
    }
    // 回傳檔名給前端
    res.json({ filename: req.file.filename });
});

app.put("/api/orders/:id/print-status", async (req, res) => {
    try {
        await pool.query("UPDATE orders SET is_printed = TRUE WHERE order_id = $1", [req.params.id]);
        res.json({ message: "Updated" });
    } catch (e) {
        res.status(500).json({ message: "Error" });
    }
});

app.use((req, res, next) => {
    if (req.path.startsWith("/api")) return next();
    res.sendFile(path.join(distPath, "index.html"));
});
app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});


const deleteOldOrders = async () => {
    try {
        // Postgres 語法:刪除 created_at 早於 3 個月前的資料
        await pool.query("DELETE FROM orders WHERE created_at < NOW() - INTERVAL '3 months'");
        console.log("Old orders cleanup executed.");
    } catch (e) {
        console.error("Cleanup Error:", e);
    }
};
// 啟動時執行一次，並設定每 24 小時執行一次 (86400000 ms)
deleteOldOrders();
setInterval(deleteOldOrders, 86400000);