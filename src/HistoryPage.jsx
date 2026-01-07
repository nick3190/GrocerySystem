import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import "./HistoryPage.css";
import api from "./api"; // 請確保使用你設定好的 api instance

function HistoryPage() {
    const [list, setList] = useState([]);
    const [loading, setLoading] = useState(true);
    const [expandedOrderId, setExpandedOrderId] = useState(null);
    const navigate = useNavigate();

    const fetchHistoryList = async () => {
        try {
            // ⭐ 修正：只抓取自己的訂單
            const response = await api.get('/api/my-history');
            setList(response.data);
        } catch (err) {
            console.error("讀取訂單失敗:", err);
        } finally {
            setLoading(false);
        }
    }

    const toggleOrderDetails = (orderId) => {
        setExpandedOrderId(expandedOrderId === orderId ? null : orderId);
    }

    const addHistoryToCart = async (products) => {
        if (!products || products.length === 0) return alert("無商品可加入");
        if (!window.confirm(`確定要將這 ${products.length} 項商品加入購物車嗎？`)) return;

        try {
            const promises = products.map(product => {
                return api.post('/cart', {
                    productId: product.id, // 注意這裡要對應後端需要的 productId
                    quantity: product.qty || 1,
                    note: product.note || ''
                });
            });
            await Promise.all(promises);
            alert("商品已成功加入購物車！");
            navigate('/shopCart');
        } catch (error) {
            alert("加入失敗，請稍後再試");
        }
    };

    useEffect(() => {
        fetchHistoryList();
    }, []);

    return (
        <div className="history-page" style={{ paddingTop: '80px', maxWidth: '800px', margin: '0 auto' }}>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', padding: '0 10px' }}>
                <h2 style={{ color: '#333', margin: 0 }}>我的歷史訂單</h2>
                <button
                    onClick={() => navigate('/productList')}
                    style={{
                        padding: '8px 15px',
                        background: '#666',
                        color: 'white',
                        border: 'none',
                        borderRadius: '20px',
                        cursor: 'pointer'
                    }}
                >
                    ← 回到商品列表
                </button>
            </div>

            {loading ? (
                <p style={{ textAlign: 'center' }}>載入中...</p>
            ) : list.length === 0 ? (
                <div style={{ textAlign: 'center', color: '#888' }}>尚無訂單紀錄</div>
            ) : (
                <div className="history-list">
                    {list.map((item) => (
                        <div key={item.id} className="history-card" style={{
                            background: 'white',
                            borderRadius: '10px',
                            padding: '15px',
                            marginBottom: '15px',
                            boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
                            border: '1px solid #eee'
                        }}>
                            {/* 訂單頭部資訊 */}
                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '10px', borderBottom: '1px solid #f0f0f0', paddingBottom: '10px' }}>
                                <div>
                                    <div style={{ fontWeight: 'bold', color: '#333' }}>{item.pickupDate}</div>
                                    <div style={{ fontSize: '0.9rem', color: '#666' }}>{item.pickupTime || '外送'}</div>
                                </div>
                                <div style={{ textAlign: 'right' }}>
                                    <div style={{ color: '#e53935', fontWeight: 'bold', fontSize: '1.1rem' }}>${item.total}</div>
                                    <div style={{ fontSize: '0.8rem', color: item.isPrinted ? 'green' : 'orange' }}>
                                        {item.isPrinted ? '店家已接單' : '處理中'}
                                    </div>
                                </div>
                            </div>

                            {/* 操作按鈕 */}
                            <div style={{ display: 'flex', gap: '10px' }}>
                                <button
                                    style={{ flex: 1, padding: '8px', background: '#f0f0f0', border: 'none', borderRadius: '5px' }}
                                    onClick={() => toggleOrderDetails(item.id)}
                                >
                                    {expandedOrderId === item.id ? "收起明細" : "查看明細"}
                                </button>
                                <button
                                    style={{ flex: 1, padding: '8px', background: '#e53935', color: 'white', border: 'none', borderRadius: '5px' }}
                                    onClick={() => addHistoryToCart(item.products)}
                                >
                                    再買一次
                                </button>
                            </div>

                            {/* 展開明細 */}
                            {expandedOrderId === item.id && (
                                <div style={{ marginTop: '15px', background: '#fafafa', padding: '10px', borderRadius: '5px' }}>
                                    {item.products.map((p, idx) => (
                                        <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', borderBottom: '1px dashed #ddd' }}>
                                            <span style={{ flex: 2 }}>{p.name} {p.note && <span style={{ fontSize: '0.8em', color: '#888' }}>({p.note})</span>}</span>
                                            <span style={{ flex: 1, textAlign: 'right' }}>x{p.qty}</span>
                                            <span style={{ flex: 1, textAlign: 'right' }}>${p.price}</span>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}

export default HistoryPage;