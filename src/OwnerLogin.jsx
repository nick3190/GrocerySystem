import { useState, useEffect, useMemo } from "react";
import axios from "axios";
import "./OwnerLogin.css";
import "./ProductList.css"; // 引入商品列表樣式以便共用

function Owner() {
    const [isLoggedIn, setIsLoggedIn] = useState(false);
    const [activeTab, setActiveTab] = useState("dashboard"); // dashboard, orders, products
    const [isMenuOpen, setIsMenuOpen] = useState(false);
    const [username, setUsername] = useState("");
    const [password, setPassword] = useState("");

    // --- 資料狀態 ---
    const [orders, setOrders] = useState([]);
    const [rawProducts, setRawProducts] = useState([]);

    // --- 訂單管理子分頁狀態 ---
    const [orderSubTab, setOrderSubTab] = useState("today"); // 'today', 'future', 'all'

    // --- 商品管理狀態 (複製自 ProductList) ---
    const [categoriesMap, setCategoriesMap] = useState({});
    const [brands, setBrands] = useState([]);
    const [searchText, setSearchText] = useState('');
    const [selectedParent, setSelectedParent] = useState('全部');
    const [selectedChild, setSelectedChild] = useState('全部');
    const [selectedBrand, setSelectedBrand] = useState('全部');

    // --- 修改商品 Modal 狀態 ---
    const [isEditModalOpen, setIsEditModalOpen] = useState(false);
    const [editingProduct, setEditingProduct] = useState(null);

    // 初始載入
    useEffect(() => {
        if (isLoggedIn) fetchData();
    }, [isLoggedIn]);

    const fetchData = async () => {
        try {
            const [ordRes, prodRes, catRes, brandRes] = await Promise.all([
                axios.get("http://localhost:4000/history"),
                axios.get("http://localhost:4000/products"),
                axios.get("http://localhost:4000/api/categories"),
                axios.get("http://localhost:4000/api/brands")
            ]);
            setOrders(ordRes.data || []);
            setRawProducts(prodRes.data || []);
            setCategoriesMap(catRes.data || {});
            setBrands(brandRes.data || []);
        } catch (err) {
            console.error("資料載入失敗", err);
        }
    };

    // --- 邏輯：訂單篩選 ---
    const filteredOrders = useMemo(() => {
        const todayStr = new Date().toISOString().split('T')[0]; // YYYY-MM-DD

        // 輔助函式：判斷訂單日期
        const getOrderDateStr = (o) => {
            // 如果是 'today'，直接視為今天
            if (o.pickupDate === 'today') return todayStr;
            return o.pickupDate;
        };

        if (orderSubTab === 'all') {
            return orders; // 這裡可以照時間排序
        } else if (orderSubTab === 'today') {
            return orders.filter(o => getOrderDateStr(o) === todayStr);
        } else if (orderSubTab === 'future') {
            return orders.filter(o => {
                const d = getOrderDateStr(o);
                return d > todayStr; // 簡單字串比對 YYYY-MM-DD
            });
        }
        return orders;
    }, [orders, orderSubTab]);

    // --- 邏輯：商品篩選與分組 (複製自 ProductList 並簡化) ---
    const processedProductGroups = useMemo(() => {
        let filtered = rawProducts.filter(item => {
            if (searchText && !item.name.includes(searchText)) return false;
            if (selectedParent !== '全部' && item.main_category !== selectedParent) return false;
            if (selectedChild !== '全部' && item.sub_category !== selectedChild) return false;
            if (selectedBrand !== '全部' && item.brand !== selectedBrand) return false;
            return true;
        });

        // 這裡為了管理方便，我們不一定要群組化 (Group)，但為了排版一致，我們先維持卡片式
        // 但因為要「修改特定商品」，我們在卡片中列出該群組的所有規格，點擊特定規格來修改
        const groups = {};
        filtered.forEach(item => {
            if (!groups[item.name]) groups[item.name] = [];
            groups[item.name].push(item);
        });

        return Object.keys(groups).map(name => ({
            name,
            items: groups[name],
            brand: groups[name][0].brand
        }));

    }, [rawProducts, searchText, selectedParent, selectedChild, selectedBrand]);

    // --- 功能：列印訂單 ---
    const printOrder = async (id) => {
        try {
            // 開新視窗下載 Excel
            window.open(`http://localhost:4000/api/orders/${id}/print`, '_blank');
            // 更新前端狀態 (標記為已列印)
            setOrders(prev => prev.map(o => o.id === id ? { ...o, isPrinted: true } : o));
        } catch (e) { alert("列印失敗"); }
    };

    // --- 功能：開啟編輯 Modal ---
    const openEditModal = (product) => {
        setEditingProduct({ ...product }); // 複製一份
        setIsEditModalOpen(true);
    };

    // --- 功能：儲存商品修改 ---
    const saveProductChanges = async () => {
        try {
            await axios.put(`http://localhost:4000/products/${editingProduct.id}`, editingProduct);
            alert("修改成功");
            setIsEditModalOpen(false);
            fetchData(); // 重抓資料
        } catch (e) { alert("修改失敗"); }
    };

    // --- 登入畫面 ---
    if (!isLoggedIn) {
        return (
            <div className="admin-login-wrapper">
                <div className="login-card">
                    <form onSubmit={(e) => { e.preventDefault(); if (username === "admin") setIsLoggedIn(true); }}>
                        <h2>後台登入</h2>
                        <div className="input-group">
                            <label>帳號</label>
                            <input type="text" onChange={e => setUsername(e.target.value)} />
                        </div>
                        <div className="input-group">
                            <label>密碼</label>
                            <input type="password" onChange={e => setPassword(e.target.value)} />
                        </div>
                        <button type="submit" className="login-btn">登入</button>
                    </form>
                </div>
            </div>
        );
    }

    return (
        <div className="admin-container">
            {/* 側邊導覽 */}
            <nav className={`admin-sidebar ${isMenuOpen ? "open" : ""}`}>
                <div className="sidebar-brand">
                    <h3>管理後台</h3>
                    <button className="close-sidebar" onClick={() => setIsMenuOpen(false)}>×</button>
                </div>
                <div className="nav-menu">
                    <button className={activeTab === "dashboard" ? "active" : ""} onClick={() => setActiveTab("dashboard")}>📊 數據看板</button>
                    <button className={activeTab === "orders" ? "active" : ""} onClick={() => setActiveTab("orders")}>📦 訂單管理</button>
                    <button className={activeTab === "products" ? "active" : ""} onClick={() => setActiveTab("products")}>🍎 商品管理</button>
                </div>
            </nav>

            <main className="admin-content">

                {/* 1. 數據看板 (簡化) */}
                {activeTab === "dashboard" && (
                    <div className="dashboard-view">
                        <header className="content-header"><h2>數據分析</h2></header>
                        <div className="stat-grid">
                            <div className="stat-card">
                                <span>今日訂單</span>
                                <strong>{orders.filter(o => o.pickupDate === 'today').length} 筆</strong>
                            </div>
                        </div>
                    </div>
                )}

                {/* 2. 訂單管理 */}
                {activeTab === "orders" && (
                    <div className="orders-view">
                        <header className="content-header"><h2>訂單管理</h2></header>

                        {/* 訂單分類 Tabs */}
                        <div className="tabs" style={{ marginBottom: '20px' }}>
                            <button className={orderSubTab === 'today' ? 'active' : ''} onClick={() => setOrderSubTab('today')}>今日出單</button>
                            <button className={orderSubTab === 'future' ? 'active' : ''} onClick={() => setOrderSubTab('future')}>非今日出單</button>
                            <button className={orderSubTab === 'all' ? 'active' : ''} onClick={() => setOrderSubTab('all')}>訂單概覽</button>
                        </div>

                        <div className="table-container">
                            <table className="admin-table">
                                <thead>
                                    <tr>
                                        <th>下單時間</th>
                                        <th>取貨日期/時段</th>
                                        <th>店家名稱</th>
                                        <th>金額</th>
                                        <th>狀態</th>
                                        <th>操作</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {filteredOrders.map(o => (
                                        <tr key={o.id} style={{ background: o.isPrinted ? '#f0f0f0' : 'white' }}>
                                            <td>{o.時間}</td>
                                            <td>
                                                {o.pickupDate === 'today' ? '今日' : o.pickupDate} <br />
                                                <span style={{ fontSize: '0.8em', color: '#666' }}>{o.pickupTime || '外送'}</span>
                                            </td>
                                            <td>{o.storeName}</td>
                                            <td className="text-price">${o.total}</td>
                                            <td>
                                                {o.isPrinted ? <span style={{ color: 'green' }}>已列印</span> : <span style={{ color: 'red' }}>未列印</span>}
                                            </td>
                                            <td>
                                                <button className="btn-detail" onClick={() => printOrder(o.id)}>🖨 列印</button>
                                                <button className="btn-detail" onClick={() => alert(JSON.stringify(o.products, null, 2))}>明細</button>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}

                {/* 3. 商品管理 (仿 ProductList 排版) */}
                {activeTab === "products" && (
                    <div className="product-page" style={{ paddingTop: '20px' }}>
                        {/* 內嵌 Filter Bar */}
                        <div className="filter-section" style={{ marginBottom: '20px' }}>
                            <input
                                placeholder="搜尋..."
                                value={searchText}
                                onChange={e => setSearchText(e.target.value)}
                                style={{ padding: '8px', border: '1px solid #ddd', borderRadius: '5px' }}
                            />
                            <select onChange={e => setSelectedParent(e.target.value)}>
                                <option value="全部">所有分類</option>
                                {Object.keys(categoriesMap).map(c => <option key={c} value={c}>{c}</option>)}
                            </select>
                            <select onChange={e => setSelectedBrand(e.target.value)}>
                                <option value="全部">所有品牌</option>
                                {brands.map(b => <option key={b} value={b}>{b}</option>)}
                            </select>
                        </div>

                        {/* 商品 Grid */}
                        <div className="product-grid">
                            {processedProductGroups.map(group => (
                                <div key={group.name} className="product-card">
                                    <div className="card-body">
                                        <h3>{group.name}</h3>
                                        <span className="brand-tag">{group.brand}</span>
                                        <div style={{ marginTop: '10px', maxHeight: '150px', overflowY: 'auto' }}>
                                            {group.items.map(item => (
                                                <div key={item.id} style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid #eee', padding: '5px 0' }}>
                                                    <span style={{ fontSize: '0.9em' }}>{item.spec}</span>
                                                    <div>
                                                        <b style={{ color: 'red' }}>${item.price_A}</b>
                                                        <button
                                                            className="change-btn"
                                                            style={{ marginLeft: '5px', fontSize: '0.8em', cursor: 'pointer' }}
                                                            onClick={() => openEditModal(item)}
                                                        >修改</button>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {/* 修改商品 Modal */}
                {isEditModalOpen && editingProduct && (
                    <div className="modal-overlay">
                        <div className="modal-content">
                            <h3>修改商品資訊</h3>
                            <div className="input-group">
                                <label>品名</label>
                                <input value={editingProduct.name} onChange={e => setEditingProduct({ ...editingProduct, name: e.target.value })} />
                            </div>
                            <div className="input-group">
                                <label>規格</label>
                                <input value={editingProduct.spec} onChange={e => setEditingProduct({ ...editingProduct, spec: e.target.value })} />
                            </div>
                            <div style={{ display: 'flex', gap: '10px' }}>
                                <div className="input-group">
                                    <label>價格 A</label>
                                    <input type="number" value={editingProduct.price_A} onChange={e => setEditingProduct({ ...editingProduct, price_A: e.target.value })} />
                                </div>
                                <div className="input-group">
                                    <label>價格 B</label>
                                    <input type="number" value={editingProduct.price_B} onChange={e => setEditingProduct({ ...editingProduct, price_B: e.target.value })} />
                                </div>
                            </div>

                            <div className="modal-btns">
                                <button className="cancel-btn" onClick={() => setIsEditModalOpen(false)}>取消</button>
                                <button className="confirm-btn" onClick={saveProductChanges}>確定儲存</button>
                            </div>
                        </div>
                    </div>
                )}

            </main>
        </div>
    );
}

export default Owner;