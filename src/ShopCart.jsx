import { useEffect, useState } from "react";
import api from "./api";
import "./ShopCart.css";
import { useNavigate } from "react-router-dom";

function ShopCart() {
    const navigate = useNavigate();
    const [cart, setCart] = useState([]);
    const [total, setTotal] = useState(0);
    
    // 使用者基本資料 (顯示店名、電話用)
    const [userInfo, setUserInfo] = useState(null);

    // ⭐ 新增：可編輯的配送狀態
    const [deliveryType, setDeliveryType] = useState('self'); // 'self' | 'delivery'
    const [address, setAddress] = useState('');
    const [pickupDate, setPickupDate] = useState('');
    const [pickupTime, setPickupTime] = useState('');
    const [orderNote, setOrderNote] = useState('');

    useEffect(() => {
        fetchData();
    }, []);

    useEffect(() => {
        const sum = cart.reduce((acc, item) => {
            return acc + (Number(item.price) * Number(item.quantity));
        }, 0);
        setTotal(sum);
    }, [cart]);

    const fetchData = async () => {
        try {
            // 平行讀取購物車與使用者資料
            const [cartRes, userRes] = await Promise.all([
                api.get("/cart"),
                api.get("/api/me")
            ]);

            setCart(cartRes.data);

            if (userRes.data.isAuthenticated) {
                const u = userRes.data.user;
                setUserInfo(u);
                
                // ⭐ 初始化配送狀態 (使用使用者預設值)
                setDeliveryType(u.deliveryType || 'self');
                setAddress(u.address || '');
                // 如果沒有預設日期，預設為今天 YYYY-MM-DD
                setPickupDate(u.pickupDate === 'today' || !u.pickupDate 
                    ? new Date().toISOString().split('T')[0] 
                    : u.pickupDate
                );
                setPickupTime(u.pickupTime || '');
            }
        } catch (err) {
            console.error(err);
        }
    };

    const removeItem = (id) => {
        if(!window.confirm("確定刪除?")) return;
        api.delete(`/cart/${id}`)
            .then(() => {
                setCart(prev => prev.filter(item => item.id !== id));
            })
            .catch(err => alert("刪除失敗"));
    };

    const handleCheckout = async () => {
        if(cart.length === 0) return alert("購物車是空的");

        // ⭐ 前端驗證
        if (deliveryType === 'delivery' && !address) return alert("請填寫外送地址");
        if (deliveryType === 'self' && !pickupTime) return alert("請選擇自取時段");

        if(!window.confirm(`總金額 $${total}，確定送出訂單？`)) return;

        try {
            // ⭐ 構建完整 Payload
            const payload = {
                orderNote,
                deliveryType,
                address: deliveryType === 'delivery' ? address : '',
                pickupDate,
                pickupTime: deliveryType === 'self' ? pickupTime : ''
            };

            await api.post("/api/checkout", payload);
            alert("訂單已送出！");
            navigate('/historyPage'); 
        } catch (err) {
            alert("送出失敗");
            console.error(err);
        }
    };

    return (
        <div className="shopcart-page">
            <h2>我的購物車</h2>
            
            {/* ⭐ 訂單資訊概覽 (整合了切換功能) */}
            {userInfo && (
                <div className="user-summary">
                    <h3>訂單資訊</h3>
                    
                    {/* 靜態資訊 */}
                    <div className="static-info">
                        <p><strong>店家名稱：</strong>{userInfo.store_name}</p>
                        <p><strong>聯絡電話：</strong>{userInfo.phone}</p>
                    </div>

                    <hr className="divider"/>

                    {/* ⭐ 動態切換區塊 */}
                    <div className="delivery-controls">
                        <div className="tabs">
                            <button 
                                className={deliveryType === 'self' ? 'active' : ''} 
                                onClick={() => setDeliveryType('self')}
                            >
                                🏠 店內自取
                            </button>
                            <button 
                                className={deliveryType === 'delivery' ? 'active' : ''} 
                                onClick={() => setDeliveryType('delivery')}
                            >
                                🚚 專人外送
                            </button>
                        </div>

                        <div className="inputs-area">
                            {deliveryType === 'self' ? (
                                <div className="flex-row">
                                    <div className="input-group">
                                        <label>取貨日期</label>
                                        <input 
                                            type="date" 
                                            className="cart-input"
                                            value={pickupDate} 
                                            onChange={e => setPickupDate(e.target.value)} 
                                        />
                                    </div>
                                    <div className="input-group">
                                        <label>取貨時段</label>
                                        <select 
                                            className="cart-input"
                                            value={pickupTime} 
                                            onChange={e => setPickupTime(e.target.value)}
                                        >
                                            <option value="">請選擇時段</option>
                                            <option value="08:00-11:00">早 08:00 - 11:00</option>
                                            <option value="11:00-13:00">中 11:00 - 13:00</option>
                                            <option value="13:00-16:00">午 13:00 - 16:00</option>
                                            <option value="16:00-18:00">晚 16:00 - 18:00</option>
                                        </select>
                                    </div>
                                </div>
                            ) : (
                                <div className="input-group full-width">
                                    <label>外送地址</label>
                                    <input 
                                        type="text" 
                                        className="cart-input"
                                        placeholder="請輸入完整地址" 
                                        value={address} 
                                        onChange={e => setAddress(e.target.value)} 
                                    />
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {cart.length === 0 ? (
                <div style={{textAlign:'center', padding:'40px', color:'#888'}}>購物車是空的</div>
            ) : (
                <div className="cart-list">
                    {cart.map((item) => (
                        <div key={item.id} className="cart-item">
                            <div className="item-info">
                                <div>
                                    <h3 style={{margin:'0 0 5px 0'}}>{item.name}</h3>
                                    <p style={{margin:0, color:'#666', fontSize:'0.9em'}}>{item.spec} / {item.unit}</p>
                                    {item.note && <span className="note" style={{fontSize:'0.85em', color:'#888', display:'block', marginTop:'5px'}}>備註: {item.note}</span>}
                                </div>
                            </div>
                            <div className="item-action-group">
                                <div className="item-price">
                                    <p style={{margin:0}}>${item.price} x {item.quantity}</p>
                                    <p className="subtotal" style={{margin:'5px 0 0 0'}}>小計: ${item.price * item.quantity}</p>
                                </div>
                                <button className="del-btn" onClick={() => removeItem(item.id)}>刪除</button>
                            </div>
                        </div>
                    ))}
                    
                    {/* 新增整單備註 */}
                    <div style={{marginTop: '20px'}}>
                        <label style={{fontWeight: 'bold', display:'block', marginBottom:'8px'}}>訂單備註 (選填)：</label>
                        <textarea 
                            style={{width: '100%', padding: '12px', borderRadius: '8px', border:'1px solid #ddd', fontSize:'16px'}}
                            rows="3"
                            placeholder="有什麼想特別交代的嗎？"
                            value={orderNote}
                            onChange={(e) => setOrderNote(e.target.value)}
                        />
                    </div>

                    <div className="cart-footer">
                        <h3>總金額：${total.toLocaleString()}</h3>
                        <button className="checkout-btn" onClick={handleCheckout}>送出訂單</button>
                    </div>
                </div>
            )}
        </div>
    );
}

export default ShopCart;