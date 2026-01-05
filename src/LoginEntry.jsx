import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import api from './api';
import './LoginEntry.css';

function LoginEntry() {
    const navigate = useNavigate();
    const [step, setStep] = useState(1);
    const [activeTab, setActiveTab] = useState('self');
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
    const [pickupDateType, setPickupDateType] = useState('today');
    const [customDate, setCustomDate] = useState('');
    const [pickupTime, setPickupTime] = useState('');

    const handleInputChange = (e) => {
        setFormData({ ...formData, [e.target.name]: e.target.value });
    };

    const handlePhoneBlur = async () => {
        if (!formData.phone || formData.phone.length < 9) return;
        try {
            const res = await api.get(`/api/lookup-user?phone=${formData.phone}`);
            if (res.data.found) {
                const u = res.data.user;
                setFormData(prev => ({
                    ...prev,
                    storeName: u.storeName || '',
                    address: u.address || ''
                }));
                // ⭐ 修正：不再更動 activeTab
            }
        } catch (e) { console.error("Lookup failed", e); }
    };

    const handleSendOTP = async () => {
        if (!formData.storeName || !formData.phone) return alert("請填寫店家名稱與手機");
        if (activeTab === 'delivery' && !formData.address) return alert("外送請填寫地址");
        if (activeTab === 'self') {
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
            let finalDate = pickupDateType === 'today'
                ? new Date().toISOString().split('T')[0]
                : customDate;

            const payload = {
                ...formData,
                deliveryType: activeTab,
                pickupDate: finalDate,
                pickupTime: activeTab === 'self' ? pickupTime : ''
            };

            const res = await api.post('/api/verify-otp', payload);
            navigate('/productList');
        } catch (error) {
            alert(error.response?.data?.message || "驗證失敗");
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        const checkLoginStatus = async () => {
            try {
                const res = await api.get('/api/me');
                if (res.data && res.data.isAuthenticated) {
                    setRedirectMsg(`歡迎回來 ${res.data.user.store_name}，正在進入賣場...`);
                    setTimeout(() => { navigate('/productList'); }, 3500);
                } else {
                    setIsCheckingAuth(false);
                }
            } catch (err) {
                console.log("尚未登入或 Token 已失效");
                setIsCheckingAuth(false);
            }
        };
        checkLoginStatus();
    }, [navigate]);

    // ⭐ 新增：彩蛋功能 (長按 d i c k 5秒)
    useEffect(() => {
        const targetKeys = new Set(['d', 'i', 'c', 'k']);
        const pressed = new Set();
        let timer = null;

        const onKeyDown = (e) => {
            if (targetKeys.has(e.key.toLowerCase())) {
                pressed.add(e.key.toLowerCase());
            }
            // 檢查是否同時按下了這四個鍵
            const allPressed = [...targetKeys].every(k => pressed.has(k));
            
            if (allPressed && !timer) {
                console.log("Easter egg sequence detected! Hold for 5 seconds...");
                timer = setTimeout(() => {
                    // ⭐ 請將 '/owner' 替換為您真正的後台路徑
                    navigate('/owner'); 
                }, 5000);
            }
        };

        const onKeyUp = (e) => {
            if (targetKeys.has(e.key.toLowerCase())) {
                pressed.delete(e.key.toLowerCase());
                if (timer) {
                    clearTimeout(timer);
                    timer = null;
                    console.log("Sequence broken.");
                }
            }
        };

        window.addEventListener('keydown', onKeyDown);
        window.addEventListener('keyup', onKeyUp);

        return () => {
            window.removeEventListener('keydown', onKeyDown);
            window.removeEventListener('keyup', onKeyUp);
            if (timer) clearTimeout(timer);
        };
    }, [navigate]);

    const forceLogout = async () => {
        try { await api.post('/logout'); } catch (e) { }
        window.location.reload();
    };

    if (isCheckingAuth || redirectMsg) {
        return (
            <div className="page-wrapper">
                <div className="centered-box" style={{ padding: '40px' }}>
                    {redirectMsg ? <h3 style={{ color: '#2ecc71' }}>✅ {redirectMsg}</h3> : <h3>⏳ 正在確認登入狀態...</h3>}
                    <button onClick={forceLogout} style={{ marginTop: '20px', padding: '10px', background: '#95a5a6', color: 'white', border: 'none', borderRadius: '5px' }}>強制登出</button>
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
                            <input
                                name="phone"
                                placeholder="手機號碼 (輸入後自動帶入資料)"
                                value={formData.phone}
                                onChange={handleInputChange}
                                onBlur={handlePhoneBlur}
                                className="main-input"
                            />
                            <input name="storeName" placeholder="店家名稱" value={formData.storeName} onChange={handleInputChange} className="main-input" />

                            {activeTab === 'delivery' && (
                                <input name="address" placeholder="送貨地址" value={formData.address} onChange={handleInputChange} className="main-input" />
                            )}

                            {activeTab === 'self' && (
                                <div className="self-pickup-options" style={{ textAlign: 'left' }}>
                                    <p>選擇日期：</p>
                                    <div style={{ display: 'flex', gap: '10px', marginBottom: '10px' }}>
                                        <label><input type="radio" name="dateType" checked={pickupDateType === 'today'} onChange={() => setPickupDateType('today')} /> 今日取貨</label>
                                        <label><input type="radio" name="dateType" checked={pickupDateType === 'custom'} onChange={() => setPickupDateType('custom')} /> 指定日期</label>
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