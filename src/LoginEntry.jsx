import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import api from './api';
import './LoginEntry.css';

function LoginEntry() {
    const navigate = useNavigate();
    const [step, setStep] = useState(1);
    const [activeTab, setActiveTab] = useState('self'); // 'self' | 'delivery'
    const [isLoading, setIsLoading] = useState(false);

    const [isCheckingAuth, setIsCheckingAuth] = useState(true);
    const [redirectMsg, setRedirectMsg] = useState(null);

    // 表單狀態
    const [formData, setFormData] = useState({
        storeName: '',
        phone: '',
        address: '',
        otp: ''
    });

    // 自取專用狀態
    const [pickupDateType, setPickupDateType] = useState('today'); // 'today' | 'custom'
    const [customDate, setCustomDate] = useState('');
    const [pickupTime, setPickupTime] = useState('');

    const handleInputChange = (e) => {
        setFormData({ ...formData, [e.target.name]: e.target.value });
    };

    const handleSendOTP = async () => {
        if (!formData.storeName || !formData.phone) return alert("請填寫店家名稱與手機");

        // 驗證邏輯
        if (activeTab === 'delivery') {
            if (!formData.address) return alert("外送請填寫地址");
        } else {
            // 自取驗證
            if (pickupDateType === 'custom' && !customDate) return alert("請選擇取貨日期");
            if (!pickupTime) return alert("請選擇取貨時段");
        }

        setIsLoading(true);
        try {
            await api.post('/api/send-otp', { phone: formData.phone });
            alert("驗證碼已發送");
            setStep(2);
        } catch (error) {
            alert(error.response?.data?.message || "發送失敗");
        } finally {
            setIsLoading(false);
        }
    };

    const handleLogin = async () => {
        if (!formData.otp) return alert("請輸入驗證碼");
        setIsLoading(true);
        try {
            // 處理日期：如果是 "today"，轉換成 YYYY-MM-DD
            let finalDate = pickupDateType === 'today'
                ? new Date().toISOString().split('T')[0] // 取得今日日期 YYYY-MM-DD
                : customDate;

            const payload = {
                ...formData,
                deliveryType: activeTab,
                pickupDate: finalDate, // 傳送處理過的日期
                pickupTime: activeTab === 'self' ? pickupTime : ''
            };

            const res = await api.post('/api/verify-otp', payload);
            console.log("登入成功:", res.data);
            navigate('/productList'); // 導向商品頁
        } catch (error) {
            alert(error.response?.data?.message || "驗證失敗");
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        const checkLoginStatus = async () => {
            try {
                // 這裡會呼叫後端 (現在後端有 requireAuth，無效會直接拋出 401)
                const res = await api.get('/api/me');

                if (res.data && res.data.isAuthenticated) {
                    // 顯示跳轉訊息，給使用者 1.5 秒的反應時間 (避免瞬間跳轉卡死)
                    setRedirectMsg(`歡迎回來 ${res.data.user.store_name}，正在進入賣場...`);
                    setTimeout(() => {
                        navigate('/productList');
                    }, 3500);
                } else {
                    // 有回應但 isAuthenticated 為 false (理論上不會發生，因為會 401)
                    setIsCheckingAuth(false);
                }
            } catch (err) {
                // 收到 401 或其他錯誤 -> 停留在登入頁
                console.log("尚未登入或 Token 已失效");
                setIsCheckingAuth(false);
            }
        };
        checkLoginStatus();
    }, [navigate]);

    const forceLogout = async () => {
        try {
            await api.post('/logout'); // 呼叫後端清除 Cookie
        } catch (e) { console.error(e); }
        // 前端強制重整頁面，確保狀態清空
        window.location.reload();
    };

    if (isCheckingAuth || redirectMsg) {
        return (
            <div className="page-wrapper">
                <div className="centered-box" style={{ padding: '40px' }}>
                    {redirectMsg ? (
                        <>
                            <h3 style={{ color: '#2ecc71', marginBottom: '20px' }}>✅ {redirectMsg}</h3>
                            <p>如果沒有自動跳轉...</p>
                        </>
                    ) : (
                        <h3>⏳ 正在確認登入狀態...</h3>
                    )}

                    {/* 這就是逃生門按鈕 */}
                    <button
                        onClick={forceLogout}
                        style={{
                            marginTop: '20px',
                            padding: '10px 20px',
                            background: '#95a5a6',
                            color: 'white',
                            border: 'none',
                            borderRadius: '5px',
                            cursor: 'pointer'
                        }}
                    >
                        並非此帳號 / 強制登出
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className="page-wrapper">
            <div className="centered-box">
                <h2>{step === 1 ? "店家登入" : "輸入驗證碼"}</h2>

                {step === 1 && (
                    <div className="tabs">
                        <button className={activeTab === 'self' ? 'active' : ''} onClick={() => setActiveTab('self')}>自取</button>
                        <button className={activeTab === 'delivery' ? 'active' : ''} onClick={() => setActiveTab('delivery')}>外送</button>
                    </div>
                )}

                <div className="form-content">
                    {step === 1 ? (
                        <>
                            <input name="storeName" placeholder="店家名稱" value={formData.storeName} onChange={handleInputChange} className="main-input" />
                            <input name="phone" placeholder="手機號碼" value={formData.phone} onChange={handleInputChange} className="main-input" />

                            {/* 外送介面 */}
                            {activeTab === 'delivery' && (
                                <input name="address" placeholder="送貨地址" value={formData.address} onChange={handleInputChange} className="main-input" />
                            )}

                            {/* 自取介面 */}
                            {activeTab === 'self' && (
                                <div className="self-pickup-options" style={{ textAlign: 'left' }}>
                                    <p>選擇日期：</p>
                                    <div style={{ display: 'flex', gap: '10px', marginBottom: '10px' }}>
                                        <label>
                                            <input type="radio" name="dateType" checked={pickupDateType === 'today'} onChange={() => setPickupDateType('today')} /> 今日取貨
                                        </label>
                                        <label>
                                            <input type="radio" name="dateType" checked={pickupDateType === 'custom'} onChange={() => setPickupDateType('custom')} /> 指定日期
                                        </label>
                                    </div>
                                    {pickupDateType === 'custom' && (
                                        <input type="date" className="main-input" value={customDate} onChange={(e) => setCustomDate(e.target.value)} />
                                    )}

                                    <p style={{ marginTop: '10px' }}>選擇時段：</p>
                                    <select className="main-input" value={pickupTime} onChange={(e) => setPickupTime(e.target.value)}>
                                        <option value="">請選擇時段</option>
                                        <option value="08:00-11:00">早 08:00 - 11:00</option>
                                        <option value="11:00-13:00">中 11:00 - 13:00</option>
                                        <option value="13:00-16:00">午 13:00 - 16:00</option>
                                        <option value="16:00-18:00">晚 16:00 - 18:00</option>
                                    </select>
                                </div>
                            )}

                            <button onClick={handleSendOTP} disabled={isLoading} className="action-btn">
                                {isLoading ? "發送中..." : "發送驗證碼"}
                            </button>
                        </>
                    ) : (
                        <>
                            <p>已發送至: {formData.phone}</p>
                            <input name="otp" placeholder="4位數驗證碼" value={formData.otp} onChange={handleInputChange} className="main-input" />
                            <button className="action-btn" onClick={handleLogin} disabled={isLoading}>驗證並登入</button>
                            <button className="secondary-btn" onClick={() => setStep(1)}>返回修改</button>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}

export default LoginEntry;