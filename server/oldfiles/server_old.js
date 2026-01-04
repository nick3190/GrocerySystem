import express from "express";
import cors from "cors";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import * as XLSX from 'xlsx'; // 來自舊版，用於讀取 Excel
import crypto from 'crypto';  // 來自新版，用於加密
import cookieParser from 'cookie-parser'; // 來自新版，用於解析 Cookie

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 4000;
const SECRET_KEY = "YOUR_SUPER_SECRET_KEY_PLEASE_CHANGE"; // HMAC 密鑰

// Middleware
app.use(cors({
    origin: ["http://localhost:5173", "http://127.0.0.1:5173"],
    methods: ["GET", "POST", "PUT", "DELETE"],
    credentials: true // 允許攜帶 Cookie
}));
app.use(express.json());
app.use(cookieParser());

// --- 檔案路徑設定 ---
const FILES = {
    users: path.join(__dirname, "users.json"),
    history: path.join(__dirname, "history.json"),
    products: path.join(__dirname, "products.json"),
    cart: path.join(__dirname, "cart.json")
};

// --- 初始化 Helper ---
const initFile = (filePath, defaultContent = []) => {
    if (!fs.existsSync(filePath)) {
        fs.writeFileSync(filePath, JSON.stringify(defaultContent, null, 2), 'utf-8');
    }
};

initFile(FILES.users);
initFile(FILES.history);
initFile(FILES.cart);

// --- [來自舊版] Excel 讀取邏輯 ---
// 如果 products.json 不存在，嘗試從 Excel 讀取並建立
if (!fs.existsSync(FILES.products)) {
    try {
        const excelPath = path.join(__dirname, "products_1202.xlsx"); // 請確認您的 Excel 檔名
        if (fs.existsSync(excelPath)) {
            const workbook = XLSX.readFile(excelPath);
            const sheetName = workbook.SheetNames[0];
            const data = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName]);
            fs.writeFileSync(FILES.products, JSON.stringify(data, null, 2));
            console.log("已從 Excel 載入商品至 products.json");
        } else {
            initFile(FILES.products, []);
        }
    } catch (e) {
        console.error("Excel 讀取失敗，建立空商品檔", e);
        initFile(FILES.products, []);
    }
}

// --- 通用讀寫 Helper ---
const readJson = (filePath) => {
    if (!fs.existsSync(filePath)) return [];
    try { return JSON.parse(fs.readFileSync(filePath, 'utf-8')); }
    catch (e) { return []; }
};
const writeJson = (filePath, data) => fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');

// ================= [來自新版] 安全性功能 Helper =================

// 1. HMAC 簽名產生
const signData = (data) => {
    const jsonStr = JSON.stringify(data);
    const hmac = crypto.createHmac('sha256', SECRET_KEY);
    hmac.update(jsonStr);
    const signature = hmac.digest('hex');
    return `${Buffer.from(jsonStr).toString('base64')}.${signature}`;
};

// 2. HMAC 驗證與解析
const verifyAndParseData = (signedCookie) => {
    if (!signedCookie) return null;
    const [b64Data, signature] = signedCookie.split('.');
    if (!b64Data || !signature) return null;

    const jsonStr = Buffer.from(b64Data, 'base64').toString('utf-8');
    const hmac = crypto.createHmac('sha256', SECRET_KEY);
    hmac.update(jsonStr);
    const expectedSignature = hmac.digest('hex');

    if (signature === expectedSignature) {
        return JSON.parse(jsonStr);
    }
    return null; // 簽名不符，視為竄改
};

// 3. Rate Limiting & OTP Memory
const otpStore = {}; 
const rateLimitStore = {};

// ================= API 路由 =================

// --- 1. [來自新版] 簡訊驗證碼 (OTP) ---
app.post("/api/send-otp", (req, res) => {
    const rawPhone = req.body.phone;
    const phone = rawPhone ? String(rawPhone).replace(/\D/g, '') : ''; // 格式化電話

    if (!phone) return res.status(400).json({ message: "需要電話號碼" });

    // Rate Limiting
    const now = Date.now();
    if (rateLimitStore[phone] && now - rateLimitStore[phone] < 10000) {
        return res.status(429).json({ message: "請稍後再試" });
    }

    const code = Math.floor(1000 + Math.random() * 9000).toString();
    console.log(`[SMS MOCK] 給 ${phone} 的驗證碼是: ${code}`); 

    otpStore[phone] = { code, expires: now + 300000 }; 
    rateLimitStore[phone] = now;

    res.json({ success: true, message: "驗證碼已發送" });
});

// --- 2. [來自新版] 登入並設定加密 Cookie (包含 Debug Log) ---
app.post("/api/login", (req, res) => {
    const { otp, storeName, type, address } = req.body;
    const rawPhone = req.body.phone;
    const phone = rawPhone ? String(rawPhone).replace(/\D/g, '') : '';

    console.log(`[Login Debug] 嘗試登入 - 電話: ${phone}, 輸入碼: ${otp}`);

    const storedOtp = otpStore[phone];

    if (!storedOtp) {
        console.log("[Login Debug] 失敗：無 OTP 紀錄");
        return res.status(401).json({ message: "驗證碼已過期或伺服器已重啟" });
    }

    if (String(storedOtp.code) !== String(otp)) {
        console.log(`[Login Debug] 失敗：碼不符。系統:${storedOtp.code} vs 輸入:${otp}`);
        return res.status(401).json({ message: "驗證碼錯誤" });
    }

    if (Date.now() > storedOtp.expires) {
        return res.status(401).json({ message: "驗證碼已過期" });
    }

    delete otpStore[phone]; // 清除 OTP

    // 建立使用者 Session 資料
    const userData = {
        uuid: crypto.randomUUID(),
        phone,
        storeName: storeName || "",
        type, 
        address: address || "",
        loginTime: Date.now()
    };

    // 寫入 Users 紀錄
    const users = readJson(FILES.users);
    users.push(userData);
    writeJson(FILES.users, users);

    // 設定 HttpOnly Cookie
    const signedCookieValue = signData(userData);
    res.cookie('auth_token', signedCookieValue, {
        httpOnly: true,
        secure: false, // Localhost=false, HTTPS=true
        maxAge: 24 * 60 * 60 * 1000,
        sameSite: 'lax'
    });

    res.json({ success: true, user: userData });
});

// 檢查狀態
app.get("/api/me", (req, res) => {
    const userData = verifyAndParseData(req.cookies.auth_token);
    if (userData) {
        res.json({ loggedIn: true, user: userData });
    } else {
        res.status(401).json({ loggedIn: false });
    }
});

// --- 3. [合併] 商品 API (使用舊版的強大篩選邏輯) ---
app.get("/products", (req, res) => {
    let products = readJson(FILES.products);

    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const search = req.query.search || "";
    const parent = req.query.parent || "";
    const child = req.query.child || "";
    const brand = req.query.brand || "";

    // 搜尋過濾
    if (search) {
        products = products.filter(p => 
            (p['品名'] && p['品名'].includes(search)) ||
            (p['產品編號'] && String(p['產品編號']).includes(search))
        );
    }

    // 分類與品牌過濾
    if (parent && parent !== "全部") products = products.filter(p => p['母篩選'] === parent);
    if (child && child !== "全部") products = products.filter(p => p['子篩選'] === child);
    if (brand && brand !== "全部") products = products.filter(p => p['品牌'] === brand);

    // 分頁計算
    const totalItems = products.length;
    const totalPages = Math.ceil(totalItems / limit);
    const startIndex = (page - 1) * limit;
    
    // 取出當頁資料 (注意：若需隱藏進貨成本，可在此處 map 新物件)
    const paginatedProducts = products.slice(startIndex, startIndex + limit);

    res.json({
        products: paginatedProducts,
        currentPage: page,
        totalPages: totalPages || 1,
        totalItems: totalItems
    });
});

// --- [來自舊版] 補回品牌與分類 API ---
app.get("/api/brands", (req, res) => {
    const products = readJson(FILES.products);
    const brandSet = new Set(products.map(p => p['品牌']).filter(b => b && b.trim() !== ""));
    res.json(Array.from(brandSet));
});

app.get("/api/categories", (req, res) => {
    const products = readJson(FILES.products);
    const categoryMap = {};

    products.forEach(p => {
        const parent = p['母篩選'] || '其他';
        const child = p['子篩選'] || '其他';

        if (!categoryMap[parent]) categoryMap[parent] = new Set();
        if (child) categoryMap[parent].add(child);
    });

    const result = {};
    for (const key in categoryMap) {
        result[key] = Array.from(categoryMap[key]);
    }
    res.json(result);
});

// --- 4. [來自新版] 購物車 API (安全版：後端權威 + 隔離使用者) ---
let cartMemory = {}; // Key: UUID, Value: Array

app.get("/cart", (req, res) => {
    const user = verifyAndParseData(req.cookies.auth_token);
    if (!user) return res.status(401).json({ message: "未授權" });

    const userCart = cartMemory[user.uuid] || [];
    res.json(userCart);
});

app.post("/cart", (req, res) => {
    const user = verifyAndParseData(req.cookies.auth_token);
    if (!user) return res.status(401).json({ message: "未授權" });

    const { productId, quantity, note } = req.body;

    // 後端查價
    const allProducts = readJson(FILES.products);
    const product = allProducts.find(p => p.id == productId || p['產品編號'] == productId);

    if (!product) return res.status(404).json({ message: "找不到商品" });

    if (!cartMemory[user.uuid]) cartMemory[user.uuid] = [];
    const userCart = cartMemory[user.uuid];

    const existItem = userCart.find(c => c.id === product.id);
    if (existItem) {
        existItem.quantity += quantity;
        if (note) existItem.note = note;
    } else {
        userCart.push({
            id: product.id,
            name: product['品名'],
            price: product['售價A'], // 安全：後端寫入價格
            unit: product['計量單位'],
            quantity: quantity,
            note: note || ""
        });
    }

    res.json(userCart);
});

app.delete("/cart/:id", (req, res) => {
    const user = verifyAndParseData(req.cookies.auth_token);
    if (!user) return res.status(401).send();

    if (cartMemory[user.uuid]) {
        cartMemory[user.uuid] = cartMemory[user.uuid].filter(c => c.id != req.params.id);
    }
    res.json(cartMemory[user.uuid]);
});

// --- 5. [來自新版] 訂單送出 (History) ---
app.post("/history", (req, res) => {
    const user = verifyAndParseData(req.cookies.auth_token);
    if (!user) return res.status(401).json({ message: "身份驗證失敗" });

    const userCart = cartMemory[user.uuid];
    if (!userCart || userCart.length === 0) return res.status(400).json({ message: "購物車是空的" });

    // 再次確認總金額
    const total = userCart.reduce((acc, item) => acc + (item.price * item.quantity), 0);

    const newOrder = {
        orderId: `ORD-${Date.now()}`,
        userInfo: {
            uuid: user.uuid,
            name: user.name, // 若前端登入沒傳 Name，這裡可能要調整
            storeName: user.storeName,
            phone: user.phone,
            type: user.type,
            address: user.address
        },
        items: userCart,
        totalAmount: total,
        timestamp: new Date().toLocaleString()
    };

    const history = readJson(FILES.history);
    history.push(newOrder);
    writeJson(FILES.history, history);

    delete cartMemory[user.uuid]; // 清空購物車

    res.json({ success: true, message: "訂單建立成功" });
});

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});