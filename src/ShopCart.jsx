import { useEffect, useState } from "react";
import api from "./api";
import "./ShopCart.css";
import { useNavigate } from "react-router-dom";

function ShopCart() {
    const navigate = useNavigate();
    const [cart, setCart] = useState([]);
    const [total, setTotal] = useState(0);
    const [userInfo, setUserInfo] = useState(null);
    const [orderNote, setOrderNote] = useState("");

    useEffect(() => {
        fetchCart();
        fetchUser();
    }, []);

    useEffect(() => {
        const sum = cart.reduce((acc, item) => {
            return acc + (Number(item.price) * Number(item.quantity));
        }, 0);
        setTotal(sum);
    }, [cart]);

    const fetchCart = () => {
        api.get("/cart")
            .then(res => setCart(res.data))
            .catch(err => console.error(err));
    };

    const fetchUser = () => {
        api.get("/api/me")
            .then(res => {
                if (res.data.isAuthenticated) setUserInfo(res.data.user);
            })
            .catch(err => console.error(err));
    };

    const removeItem = (id) => {
        if(!window.confirm("確定刪除?")) return;
        api.delete(`/cart/${id}`)
            .then(() => fetchCart())
            .catch(err => alert("刪除失敗"));
    };

    const handleCheckout = async () => {
        if(cart.length === 0) return alert("購物車是空的");
        if(!window.confirm(`總金額 $${total}，確定送出訂單？`)) return;

        try {
            await api.post("/api/checkout", { orderNote });
            alert("訂單已送出！");
            navigate('/historyPage'); // 或回到首頁
        } catch (err) {
            alert("送出失敗");
            console.error(err);
        }
    };

    return (
        <div className="shopcart-page">
            <h2>我的購物車</h2>
            
            {/* 訂單資訊概覽 */}
            {userInfo && (
                <div className="user-summary" style={{background: '#eef', padding: '15px', borderRadius: '10px', marginBottom: '20px'}}>
                    <h3>訂單資訊</h3>
                    <p><strong>店家名稱：</strong>{userInfo.store_name}</p>
                    <p><strong>聯絡電話：</strong>{userInfo.phone}</p>
                    <p><strong>取貨方式：</strong>{userInfo.delivery_type === 'self' ? '自取' : '外送'}</p>
                    {userInfo.delivery_type === 'self' ? (
                        <>
                            <p><strong>取貨日期：</strong>{userInfo.pickup_date === 'today' ? '今日' : userInfo.pickup_date}</p>
                            <p><strong>取貨時段：</strong>{userInfo.pickup_time}</p>
                        </>
                    ) : (
                        <p><strong>外送地址：</strong>{userInfo.address}</p>
                    )}
                </div>
            )}

            {cart.length === 0 ? (
                <p>購物車是空的</p>
            ) : (
                <div className="cart-list">
                    {cart.map((item) => (
                        <div key={item.id} className="cart-item">
                            <div className="item-info">
                                <h3>{item.name}</h3>
                                <p>{item.spec} / {item.unit}</p>
                                {item.note && <span className="note">備註: {item.note}</span>}
                            </div>
                            <div className="item-price">
                                <p>${item.price} x {item.quantity}</p>
                                <p className="subtotal">小計: ${item.price * item.quantity}</p>
                            </div>
                            <button className="del-btn" onClick={() => removeItem(item.id)}>X</button>
                        </div>
                    ))}
                    
                    {/* 新增整單備註 */}
                    <div style={{marginTop: '20px'}}>
                        <label style={{fontWeight: 'bold'}}>訂單備註 (選填)：</label>
                        <textarea 
                            style={{width: '100%', padding: '10px', marginTop: '5px', borderRadius: '5px'}}
                            rows="3"
                            placeholder="有什麼想特別交代的嗎？"
                            value={orderNote}
                            onChange={(e) => setOrderNote(e.target.value)}
                        />
                    </div>

                    <div className="cart-footer">
                        <h3>總金額：${total}</h3>
                        <button className="checkout-btn" onClick={handleCheckout}>送出訂單</button>
                    </div>
                </div>
            )}
        </div>
    );
}

export default ShopCart;