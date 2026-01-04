// src/api.js
import axios from 'axios';

// 判斷後端網址 (本地開發 vs 線上環境)
/*const BASE_URL = import.meta.env.MODE === 'production'
    ? 'https://grocerysystem-s04n.onrender.com' // 線上後端網址
    : 'http://localhost:4000';           // 本地後端網址*/

const BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:10000';

const api = axios.create({
    baseURL: BASE_URL,
    withCredentials: true // ★ 唯一關鍵：告訴瀏覽器「這請求要帶上 Cookie」
});

// 您原本的 Response 攔截器可以保留 (用來處理 401 自動登出)
api.interceptors.response.use((response) => {
    return response;
}, (error) => {
    // 如果收到 401，代表 Cookie 過期或被竄改
    if (error.response && error.response.status === 401) {
        // 這裡不需要 removeItem，因為 Cookie 是 HttpOnly 的，JS 刪不掉
        // 只能導向首頁，讓使用者重新登入 (重新登入會覆蓋舊 Cookie)
        // window.location.href = '/'; 
    }
    return Promise.reject(error);
});

export default api;