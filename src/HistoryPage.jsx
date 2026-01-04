import { useEffect, useState } from "react";
import axios from "axios";
import "./HistoryPage.css";

function HistoryPage() {
    const [list, setList] = useState([]);
    const [loading, setLoading] = useState(true);
    const [expandedOrderId, setExpandedOrderId] = useState(null);

    const fetchHistoryList = async () => {
        try {
            const response = await axios.get('/history'); // 假設您的 API 路徑
            setList(response.data);
        } catch (err) {
            console.error("讀取訂單失敗:", err);
        } finally {
            setLoading(false);
        }
    }

    const toggleOrderDetails = (orderId) => {
        if (expandedOrderId === orderId) {
            setExpandedOrderId(null);
        } else {
            setExpandedOrderId(orderId);
        }
    }

    // --- 新增功能：將整筆訂單加入購物車 ---
    const addHistoryToCart = async (products) => {
        if (!products || products.length === 0) {
            alert("此訂單沒有商品可以加入");
            return;
        }

        const confirmAdd = window.confirm(`確定要將這 ${products.length} 項商品加入購物車嗎？`);
        if (!confirmAdd) return;

        try {
            // 由於 json-server 通常不支援一次 POST 陣列，這裡使用 Promise.all 逐筆加入
            // 如果您的後端支援批次加入 (Batch Insert)，請改成一次 API 呼叫
            const promises = products.map(product => {
                return axios.post('/cart', {
                    ...product,
                    quantity: product['商品數量'] || 1 // 確保有數量
                });
            });

            await Promise.all(promises);
            alert("商品已成功加入購物車！");
        } catch (error) {
            console.error("加入購物車失敗:", error);
            alert("加入失敗，可能是部分商品重複或網路問題");
        }
    };

    useEffect(() => {
        fetchHistoryList();
    }, []);

    return (
        <div className="history-page">
            <h1>歷史訂單</h1>
            {loading ? (
                <p>載入商品中...</p>
            ) : list.length === 0 ? (
                <p>沒有歷史訂單</p>
            ) : (
                <div className="history-list-container">
                    {list.map((item, index) => (
                        <div key={item.id || index} className="history-list-item">
                            <h3>{`${item['時間']} 的訂單`}</h3>
                            
                            <div className="history-actions">
                                <button 
                                    className="btn-view-history-list" 
                                    onClick={() => toggleOrderDetails(item.id || index)}
                                > 
                                    {expandedOrderId === (item.id || index) ? "隱藏詳情" : "查看明細"}
                                </button>
                                
                                {/* 新增 onClick 事件 */}
                                <button 
                                    className="btn-add-history-to-cart" 
                                    onClick={() => addHistoryToCart(item.products)}
                                >
                                    加入當前購物車
                                </button>
                            </div>

                            {expandedOrderId === (item.id || index) && (
                                <div className="order-details">
                                    {item.products && item.products.length > 0 ? (
                                        item.products.map((prod, pIndex) => (
                                            <div key={pIndex} className="detail-row">
                                                <span>{prod['商品名稱']}</span>
                                                <span>${prod['商品價格']}</span>
                                                <span>x{prod['商品數量']}</span>
                                            </div>
                                        ))
                                    ) : (
                                        <p>無商品資料</p>
                                    )}
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};

export default HistoryPage;