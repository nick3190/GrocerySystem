import React, { useState, useEffect } from 'react';
import api from './api';
import { useNavigate } from 'react-router-dom';
import './ProductList.css'; // 共用樣式

const ShopCart = () => {
    const navigate = useNavigate();
    const [cartItems, setCartItems] = useState([]);
    const [loading, setLoading] = useState(true);
    const [orderNote, setOrderNote] = useState('');

    // 結帳資訊
    const [deliveryType, setDeliveryType] = useState('self');
    const [address, setAddress] = useState('');
    const [pickupDate, setPickupDate] = useState('');
    const [pickupTime, setPickupTime] = useState('');

    useEffect(() => {
        fetchCart();
        fetchUserInfo();
    }, []);

    const fetchUserInfo = async () => {
        try {
            const res = await api.get('/api/me');
            if (res.data.isAuthenticated) {
                const u = res.data.user;
                setDeliveryType(u.deliveryType || 'self');
                setAddress(u.address || '');
                setPickupDate(u.pickupDate || '');
                setPickupTime(u.pickupTime || '');
            }
        } catch (e) { }
    };

    const fetchCart = async () => {
        try {
            const res = await api.get('/cart');
            setCartItems(res.data);
            setLoading(false);
        } catch (err) {
            if (err.response?.status === 401) navigate('/loginEntry');
        }
    };

    // ⭐ 修改數量功能
    const handleUpdateQty = async (id, newQty) => {
        try {
            await api.put(`/cart/${id}`, { quantity: newQty });
            // 更新本地狀態
            if (newQty <= 0) {
                setCartItems(prev => prev.filter(item => item.id !== id));
            } else {
                setCartItems(prev => prev.map(item => item.id === id ? { ...item, quantity: newQty } : item));
            }
        } catch (e) {
            alert("更新失敗");
        }
    };

    const handleDelete = async (id) => {
        if (!confirm("確定移除？")) return;
        handleUpdateQty(id, 0); // 0 會觸發後端刪除
    };

    const handleCheckout = async () => {
        if (cartItems.length === 0) return alert("購物車是空的");
        if (deliveryType === 'delivery' && !address) return alert("請填寫送貨地址");
        if (!pickupDate) return alert("請選擇日期");
        if (!confirm("確定送出訂單？")) return;

        try {
            await api.post('/api/checkout', {
                orderNote, deliveryType, address, pickupDate, pickupTime
            });
            alert("訂單已送出！");
            navigate('/historyPage');
        } catch (e) {
            alert("送出失敗");
        }
    };

    const handleImageError = (e) => {
        e.target.onerror = null;
        e.target.src = '/images/default.png';
    };

    const totalAmount = cartItems.reduce((sum, item) => sum + (Number(item.price) * item.quantity), 0);

    if (loading) return <div style={{ padding: '20px' }}>載入中...</div>;

    return (
        <div className="cart-page" style={{ maxWidth: '800px', margin: '0 auto', padding: '20px' }}>
            <header style={{ display: 'flex', alignItems: 'center', marginBottom: '20px' }}>
                <button onClick={() => navigate('/productList')} style={{ marginRight: '15px', padding: '5px 10px', background: '#ddd', border: 'none', borderRadius: '5px', cursor: 'pointer' }}>⬅ 繼續購物</button>
                <h2>🛒 購物車</h2>
            </header>

            {cartItems.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '50px', color: '#888' }}>購物車目前沒有商品</div>
            ) : (
                <>
                    <div className="cart-list" style={{ marginBottom: '30px' }}>
                        {cartItems.map(item => (
                            <div key={item.id} className="cart-item" style={{ display: 'flex', alignItems: 'center', background: 'white', padding: '15px', marginBottom: '10px', borderRadius: '10px', boxShadow: '0 2px 5px rgba(0,0,0,0.05)' }}>
                                <img src={item.image ? `/images/${item.image}` : '/images/default.png'} style={{ width: '60px', height: '60px', objectFit: 'cover', borderRadius: '5px', marginRight: '15px' }} />
                                <div style={{ flex: 1 }}>
                                    <h4 style={{ margin: '0 0 5px 0' }}>{item.name} <small style={{ color: '#666', fontWeight: 'normal' }}>{item.spec}</small></h4>
                                    <div style={{ color: '#888', fontSize: '0.9rem' }}>{item.flavor ? `口味: ${item.flavor}` : ''}</div>
                                    <div style={{ color: '#e53935', fontWeight: 'bold' }}>${item.price}</div>
                                </div>

                                {/* ⭐ 數量編輯區 */}
                                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginRight: '15px' }}>
                                    <button onClick={() => handleUpdateQty(item.id, item.quantity - 1)} style={{ width: '30px', height: '30px', background: '#eee', border: 'none', borderRadius: '50%', cursor: 'pointer' }}>-</button>
                                    <span style={{ minWidth: '20px', textAlign: 'center' }}>{item.quantity}</span>
                                    <button onClick={() => handleUpdateQty(item.id, item.quantity + 1)} style={{ width: '30px', height: '30px', background: '#eee', border: 'none', borderRadius: '50%', cursor: 'pointer' }}>+</button>
                                </div>
                                <div style={{ fontWeight: 'bold', minWidth: '60px', textAlign: 'right', marginRight: '15px' }}>${item.price * item.quantity}</div>
                                <button onClick={() => handleDelete(item.id)} style={{ color: 'red', background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.2rem' }}>×</button>
                            </div>
                        ))}
                    </div>

                    <div className="checkout-form" style={{ background: 'white', padding: '20px', borderRadius: '15px', boxShadow: '0 2px 10px rgba(0,0,0,0.1)' }}>
                        <h3 style={{ borderBottom: '1px solid #eee', paddingBottom: '10px', marginBottom: '15px' }}>結帳資訊</h3>

                        <div style={{ marginBottom: '15px' }}>
                            <label style={{ marginRight: '15px' }}><input type="radio" checked={deliveryType === 'self'} onChange={() => setDeliveryType('self')} /> 自取</label>
                            <label><input type="radio" checked={deliveryType === 'delivery'} onChange={() => setDeliveryType('delivery')} /> 送貨</label>
                        </div>

                        {deliveryType === 'delivery' && (
                            <div style={{ marginBottom: '15px' }}>
                                <label style={{ display: 'block', marginBottom: '5px' }}>送貨地址</label>
                                <input value={address} onChange={e => setAddress(e.target.value)} style={{ width: '100%', padding: '10px', border: '1px solid #ddd', borderRadius: '5px' }} />
                            </div>
                        )}

                        <div style={{ display: 'flex', gap: '10px', marginBottom: '15px' }}>
                            <div style={{ flex: 1 }}>
                                <label style={{ display: 'block', marginBottom: '5px' }}>取貨日期</label>
                                <input type="date" value={pickupDate} onChange={e => setPickupDate(e.target.value)} style={{ width: '100%', padding: '10px', border: '1px solid #ddd', borderRadius: '5px' }} />
                            </div>
                            <div style={{ flex: 1 }}>
                                <label style={{ display: 'block', marginBottom: '5px' }}>時段 (選填)</label>
                                <input type="time" value={pickupTime} onChange={e => setPickupTime(e.target.value)} style={{ width: '100%', padding: '10px', border: '1px solid #ddd', borderRadius: '5px' }} />
                            </div>
                        </div>

                        <div style={{ marginBottom: '20px' }}>
                            <label style={{ display: 'block', marginBottom: '5px' }}>整單備註</label>
                            <textarea value={orderNote} onChange={e => setOrderNote(e.target.value)} placeholder="給店家的話..." style={{ width: '100%', height: '80px', padding: '10px', border: '1px solid #ddd', borderRadius: '5px' }} />
                        </div>

                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '20px', borderTop: '2px solid #eee', paddingTop: '15px' }}>
                            <div style={{ fontSize: '1.2rem', fontWeight: 'bold' }}>總金額: <span style={{ color: '#e53935' }}>${totalAmount}</span></div>
                            <button onClick={handleCheckout} style={{ padding: '12px 30px', background: '#4caf50', color: 'white', border: 'none', borderRadius: '8px', fontSize: '1.1rem', cursor: 'pointer' }}>確認送出</button>
                        </div>
                    </div>
                </>
            )}
        </div>
    );
};

export default ShopCart;