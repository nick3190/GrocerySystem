import { useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

// ⭐ 設定區：是否開啟網址亂碼功能 (true = 開啟, false = 關閉)
// 想要關閉時，改成 false 即可
const ENABLE_MASKING = true;

const UrlObfuscator = () => {
    const location = useLocation();
    const navigate = useNavigate();
    
    // 用來記錄上一次的真實路徑，避免重複執行
    const lastRealLocation = useRef(location.pathname);

    // 產生隨機亂碼 (例如: "x9s8d7")
    const generateRandomString = () => {
        return Math.random().toString(36).substring(2, 8) + 
               Math.random().toString(36).substring(2, 8);
    };

    useEffect(() => {
        if (!ENABLE_MASKING) return;

        // 1. 如果是根目錄或登入頁，通常不建議亂碼 (可選，這裡我先不排除)
        // if (location.pathname === '/' || location.pathname === '/loginEntry') return;

        // 2. 檢查是否需要處理 (如果是剛重整完，或是路由真的變了)
        // 這裡我們每次路由變動都生成新亂碼
        
        const currentPath = location.pathname;
        
        // 如果現在網址列已經是亂碼(或者是我們剛改過的)，且 React 內部的 location 沒變，就跳過
        // 我們主要偵測 React Router 內部的 location 變化
        
        const randomCode = generateRandomString();
        
        // 3. 將 "亂碼 -> 真實路徑" 存入 Session，以便重新整理時找回
        // 我們存一個 Map: { "x9s8d7": "/productList" }
        const key = `mask_${randomCode}`;
        sessionStorage.setItem(key, currentPath);
        
        // 記錄當前使用的亂碼 key，方便 Reload 時查詢 (簡單版)
        sessionStorage.setItem('current_mask_key', key);

        // 4. 修改網址列 (只改視覺，不跳轉)
        // 使用 replaceState 替換當前歷史紀錄
        window.history.replaceState(
            window.history.state, 
            "", 
            "/" + randomCode
        );

    }, [location]); // 當 location 改變時觸發

    return null; // 這個組件不渲染任何畫面
};

// --- 處理重新整理的組件 ---
// 當使用者在 "/x9s8d7" 按 F5，React Router 會找不到這個路徑
// 這時這個組件會介入，把亂碼轉回真實路徑
export const PathResolver = () => {
    const navigate = useNavigate();
    const location = useLocation();

    useEffect(() => {
        // 取得網址上的亂碼 (移除開頭的 /)
        const pathCode = location.pathname.replace('/', '');
        const storageKey = `mask_${pathCode}`;
        
        // 去 Session 找真實路徑
        const realPath = sessionStorage.getItem(storageKey);

        if (realPath) {
            // 找到了！無痕導回真實路徑 (replace: true 代表不留歷史紀錄)
            navigate(realPath, { replace: true });
        } else {
            // 找不到 (可能是無效亂碼，或是過期的 session)，導回首頁或登入頁
            console.warn("無效的亂碼連結，導回首頁");
            navigate('/', { replace: true });
        }
    }, [navigate, location]);

    return (
        <div style={{
            height: '100vh', 
            display: 'flex', 
            justifyContent: 'center', 
            alignItems: 'center',
            background: '#f4f7f6'
        }}>
            {/* 這裡顯示一個簡單的載入畫面，避免跳轉時白屏 */}
            <h3>載入中...</h3>
        </div>
    );
};

export default UrlObfuscator;