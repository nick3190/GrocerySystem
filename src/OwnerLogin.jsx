import { useState, useEffect, useMemo } from "react";
import api from "./api";
import "./OwnerLogin.css";
import "./ProductList.css"; 
import moment from 'moment';

function Owner() {
    const [isLoggedIn, setIsLoggedIn] = useState(false);
    const [activeTab, setActiveTab] = useState("dashboard"); // dashboard, orders, products, users
    const [isMenuOpen, setIsMenuOpen] = useState(false);
    const [username, setUsername] = useState("");
    const [password, setPassword] = useState("");

    // --- 資料狀態 ---
    const [orders, setOrders] = useState([]);
    const [users, setUsers] = useState([]); // 新增使用者資料
    const [rawProducts, setRawProducts] = useState([]);
    
    // --- 訂單管理狀態 ---
    const [orderSubTab, setOrderSubTab] = useState("today");
    const [expandedOrderId, setExpandedOrderId] = useState(null); // 展開訂單明細用

    // --- 商品管理狀態 ---
    const [categoriesMap, setCategoriesMap] = useState({});
    const [brands, setBrands] = useState([]);
    const [searchText, setSearchText] = useState('');
    const [selectedParent, setSelectedParent] = useState('全部');
    const [selectedChild, setSelectedChild] = useState('全部');
    const [selectedBrand, setSelectedBrand] = useState('全部');
    
    // 商品分頁
    const [prodPage, setProdPage] = useState(1);
    const prodPageSize = 12;

    // --- 修改商品 Modal 狀態 ---
    const [isEditModalOpen, setIsEditModalOpen] = useState(false);
    const [editingGroup, setEditingGroup] = useState([]); // 當前編輯的商品群組(多規格)
    const [editingVariant, setEditingVariant] = useState(null); // 當前正在編輯的那個規格

    // 初始載入
    useEffect(() => {
        if (isLoggedIn) fetchData();
    }, [isLoggedIn]);

    const fetchData = async () => {
        try {
            const [ordRes, prodRes, catRes, brandRes, userRes] = await Promise.all([
                api.get("/history"),
                api.get("/products"),
                api.get("/api/categories"),
                api.get("/api/brands"),
                api.get("/api/users")
            ]);
            setOrders(ordRes.data || []);
            setRawProducts(prodRes.data || []);
            setCategoriesMap(catRes.data || {});
            setBrands(brandRes.data || []);
            setUsers(userRes.data || []);
        } catch (err) {
            console.error("資料載入失敗", err);
        }
    };

    // --- 邏輯：數據統計 (修正) ---
    const stats = useMemo(() => {
        const todayStr = moment().format('YYYY-MM-DD');
        const currentMonth = moment().format('YYYY-MM');

        let todayCount = 0;
        let todayRevenue = 0;
        let monthRevenue = 0;

        orders.forEach(o => {
            // 判斷是否為今日出單 (比對 pickupDate)
            if (o.pickupDate === todayStr) {
                todayCount++;
            }
            // 計算本日收益 (比對 pickupDate 或 建立時間，這邊以建立時間為主通常較準確，或依需求改成 pickupDate)
            if (moment(o.rawTime).format('YYYY-MM-DD') === todayStr) {
                todayRevenue += Number(o.total || 0);
            }
            // 計算本月收益
            if (moment(o.rawTime).format('YYYY-MM') === currentMonth) {
                monthRevenue += Number(o.total || 0);
            }
        });

        return { todayCount, todayRevenue, monthRevenue };
    }, [orders]);

    // --- 邏輯：訂單篩選 (修正) ---
    const filteredOrders = useMemo(() => {
        const todayStr = moment().format('YYYY-MM-DD');
        
        if (orderSubTab === 'all') {
            return orders; 
        } else if (orderSubTab === 'today') {
            return orders.filter(o => o.pickupDate === todayStr);
        } else if (orderSubTab === 'future') {
            return orders.filter(o => o.pickupDate > todayStr);
        }
        return orders;
    }, [orders, orderSubTab]);

    // --- 邏輯：商品篩選與分組 ---
    const processedProductGroups = useMemo(() => {
        let filtered = rawProducts.filter(item => {
            if (searchText && !item.name.includes(searchText)) return false;
            if (selectedParent !== '全部' && item.main_category !== selectedParent) return false;
            if (selectedChild !== '全部' && item.sub_category !== selectedChild) return false;
            if (selectedBrand !== '全部' && item.brand !== selectedBrand) return false;
            return true;
        });

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

    // 商品分頁計算
    const totalProdPages = Math.ceil(processedProductGroups.length / prodPageSize);
    const currentProdData = processedProductGroups.slice(
        (prodPage - 1) * prodPageSize,
        prodPage * prodPageSize
    );

    // --- 功能：訂單明細 toggle ---
    const toggleOrder = (id) => {
        setExpandedOrderId(expandedOrderId === id ? null : id);
    };

    // --- 功能：列印訂單 ---
    const printOrder = async (id) => {
        const baseUrl = api.defaults.baseURL || 'http://localhost:4000';
        window.open(`${baseUrl}/api/orders/${id}/print`, '_blank');
        setOrders(prev => prev.map(o => o.id === id ? { ...o, isPrinted: true } : o));
    };

    // --- 功能：開啟商品編輯 Modal ---
    const openEditGroupModal = (group) => {
        setEditingGroup(group.items);
        setEditingVariant({ ...group.items[0] }); // 預設選第一個規格來編輯
        setIsEditModalOpen(true);
    };

    // --- 功能：儲存單一規格修改 ---
    const saveProductChanges = async () => {
        if (!editingVariant) return;
        try {
            await api.put(`/products/${editingVariant.id}`, editingVariant);
            alert("修改成功");
            
            // 更新本地資料
            setRawProducts(prev => prev.map(p => p.id === editingVariant.id ? editingVariant : p));
            
            // 更新 Modal 內的列表顯示 (可選)
            setEditingGroup(prev => prev.map(p => p.id === editingVariant.id ? editingVariant : p));
            
        } catch (e) { alert("修改失敗"); }
    };

    if (!isLoggedIn) {
        return (
            <div className="admin-login-wrapper">
                <div className="login-card">
                    <form onSubmit={(e) => { e.preventDefault(); if (username === "admin") setIsLoggedIn(true); }}>
                        <h2>後台登入</h2>
                        <div className="input-group"><label>帳號</label><input type="text" onChange={e => setUsername(e.target.value)} /></div>
                        <div className="input-group"><label>密碼</label><input type="password" onChange={e => setPassword(e.target.value)} /></div>
                        <button type="submit" className="login-btn">登入</button>
                    </form>
                </div>
            </div>
        );
    }

    return (
        <div className="admin-container">
            <nav className={`admin-sidebar ${isMenuOpen ? "open" : ""}`}>
                <div className="sidebar-brand">
                    <h3>管理後台</h3>
                    <button className="close-sidebar" onClick={() => setIsMenuOpen(false)}>×</button>
                </div>
                <div className="nav-menu">
                    <button className={activeTab === "dashboard" ? "active" : ""} onClick={() => setActiveTab("dashboard")}>📊 數據看板</button>
                    <button className={activeTab === "orders" ? "active" : ""} onClick={() => setActiveTab("orders")}>📦 訂單管理</button>
                    <button className={activeTab === "products" ? "active" : ""} onClick={() => setActiveTab("products")}>🍎 商品管理</button>
                    <button className={activeTab === "users" ? "active" : ""} onClick={() => setActiveTab("users")}>👥 使用者管理</button>
                </div>
            </nav>

            <main className="admin-content">
                {activeTab === "dashboard" && (
                    <div className="dashboard-view">
                        <header className="content-header"><h2>數據分析</h2></header>
                        <div className="stat-grid">
                            <div className="stat-card"><span>今日訂單數 (依取貨日)</span><strong>{stats.todayCount} 筆</strong></div>
                            <div className="stat-card"><span>本日收益 (依下單日)</span><strong>${stats.todayRevenue.toLocaleString()}</strong></div>
                            <div className="stat-card"><span>本月收益</span><strong>${stats.monthRevenue.toLocaleString()}</strong></div>
                        </div>
                    </div>
                )}

                {activeTab === "orders" && (
                    <div className="orders-view">
                        <header className="content-header"><h2>訂單管理</h2></header>
                        <div className="tabs" style={{marginBottom: '20px'}}>
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
                                        <>
                                            <tr key={o.id} style={{background: o.isPrinted ? '#f0f0f0' : 'white', borderBottom: 'none'}}>
                                                <td>{o.時間}</td>
                                                <td>{o.pickupDate}<br/><span style={{fontSize:'0.8em', color:'#666'}}>{o.pickupTime || '外送'}</span></td>
                                                <td>{o.storeName}</td>
                                                <td className="text-price">${o.total}</td>
                                                <td>{o.isPrinted ? <span style={{color:'green'}}>已列印</span> : <span style={{color:'red'}}>未列印</span>}</td>
                                                <td>
                                                    <button className="btn-detail" onClick={() => printOrder(o.id)}>🖨</button>
                                                    <button className="btn-detail" onClick={() => toggleOrder(o.id)}>
                                                        {expandedOrderId === o.id ? '▲' : '▼'}
                                                    </button>
                                                </td>
                                            </tr>
                                            {expandedOrderId === o.id && (
                                                <tr style={{background:'#fafafa'}}>
                                                    <td colSpan="6" style={{padding:'10px 20px'}}>
                                                        <div className="order-dropdown">
                                                            <h4>商品明細：</h4>
                                                            <ul>
                                                                {o.products && o.products.map((p, idx) => (
                                                                    <li key={idx} style={{display:'flex', justifyContent:'space-between', borderBottom:'1px solid #eee', padding:'5px 0'}}>
                                                                        <span>{p.name} ({p.note})</span>
                                                                        <span>x{p.qty} (${p.price})</span>
                                                                    </li>
                                                                ))}
                                                            </ul>
                                                            <div style={{marginTop:'10px'}}>
                                                                <p><strong>電話：</strong> {users.find(u => u.uuid === o.user_uuid)?.phone || '未知'}</p>
                                                                <p><strong>備註：</strong> {o.order_note}</p>
                                                            </div>
                                                        </div>
                                                    </td>
                                                </tr>
                                            )}
                                        </>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}

                {activeTab === "products" && (
                    <div className="product-page" style={{paddingTop: '20px'}}> 
                        <div className="filter-section" style={{marginBottom:'20px'}}>
                            <input placeholder="搜尋..." value={searchText} onChange={e => setSearchText(e.target.value)} className="search-input" style={{width:'200px'}} />
                            <select onChange={e => {setSelectedParent(e.target.value); setProdPage(1);}}>
                                <option value="全部">所有分類</option>
                                {Object.keys(categoriesMap).map(c => <option key={c} value={c}>{c}</option>)}
                            </select>
                        </div>

                        <div className="product-grid">
                            {currentProdData.map(group => (
                                <div key={group.name} className="product-card">
                                    <div className="card-body">
                                        <h3>{group.name}</h3>
                                        <span className="brand-tag">{group.brand}</span>
                                        <div style={{marginTop:'10px', fontSize:'0.9rem', color:'#666'}}>
                                            {group.items.length} 種規格
                                        </div>
                                    </div>
                                    <button className="change-btn" onClick={() => openEditGroupModal(group)}>修改商品</button>
                                </div>
                            ))}
                        </div>

                        {/* 分頁 */}
                        {totalProdPages > 1 && (
                            <div className="pagination">
                                <button onClick={() => setProdPage(p => Math.max(1, p - 1))} disabled={prodPage === 1}>上一頁</button>
                                <span>{prodPage} / {totalProdPages}</span>
                                <button onClick={() => setProdPage(p => Math.min(totalProdPages, p + 1))} disabled={prodPage === totalProdPages}>下一頁</button>
                            </div>
                        )}
                    </div>
                )}

                {activeTab === "users" && (
                    <div className="users-view">
                        <header className="content-header"><h2>使用者管理</h2></header>
                        <div className="table-container">
                            <table className="admin-table">
                                <thead>
                                    <tr>
                                        <th>店家名稱</th>
                                        <th>電話</th>
                                        <th>價格等級</th>
                                        <th>取貨偏好</th>
                                        <th>歷史訂單數</th>
                                        <th>總消費</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {users.map(u => (
                                        <tr key={u.id}>
                                            <td>{u.store_name}</td>
                                            <td>{u.phone}</td>
                                            <td>{u.price_tier}</td>
                                            <td>
                                                {u.delivery_type === 'self' ? '自取' : '外送'}<br/>
                                                <span style={{fontSize:'0.8em', color:'#666'}}>{u.pickup_time || u.address}</span>
                                            </td>
                                            <td>{u.order_count}</td>
                                            <td className="text-price">${Number(u.total_spent).toLocaleString()}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}

                {/* 修改商品 Modal */}
                {isEditModalOpen && editingVariant && (
                    <div className="modal-overlay">
                        <div className="modal-content">
                            <h3>修改商品: {editingVariant.name}</h3>
                            
                            {/* 規格切換按鈕 */}
                            <div className="specs-list" style={{flexDirection:'row', flexWrap:'wrap', marginBottom:'15px'}}>
                                {editingGroup.map(item => (
                                    <button 
                                        key={item.id} 
                                        className={`spec-btn ${editingVariant.id === item.id ? 'active' : ''}`}
                                        style={{padding:'5px 10px', width:'auto', minWidth:'80px'}}
                                        onClick={() => setEditingVariant({...item})} // 切換時複製資料
                                    >
                                        {item.spec}
                                    </button>
                                ))}
                            </div>

                            <div className="input-group">
                                <label>品名 (所有規格連動)</label>
                                <input value={editingVariant.name} onChange={e => setEditingVariant({...editingVariant, name: e.target.value})} />
                            </div>
                            <div className="input-group">
                                <label>規格名稱</label>
                                <input value={editingVariant.spec} onChange={e => setEditingVariant({...editingVariant, spec: e.target.value})} />
                            </div>
                            <div style={{display:'flex', gap:'10px'}}>
                                <div className="input-group">
                                    <label>價格 A</label>
                                    <input type="number" value={editingVariant.price_A} onChange={e => setEditingVariant({...editingVariant, price_A: e.target.value})} />
                                </div>
                                <div className="input-group">
                                    <label>價格 B</label>
                                    <input type="number" value={editingVariant.price_B} onChange={e => setEditingVariant({...editingVariant, price_B: e.target.value})} />
                                </div>
                            </div>
                            
                            <div className="modal-btns">
                                <button className="cancel-btn" onClick={() => setIsEditModalOpen(false)}>關閉</button>
                                <button className="confirm-btn" onClick={saveProductChanges}>儲存目前規格</button>
                            </div>
                        </div>
                    </div>
                )}
            </main>
        </div>
    );
}

export default Owner;