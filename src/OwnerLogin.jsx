import { useState, useEffect, useMemo, useCallback } from "react";
import api from "./api";
import "./OwnerLogin.css";
import "./ProductList.css";
import moment from 'moment';
import {
    LineChart, Line, BarChart, Bar, PieChart, Pie, Cell,
    XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer
} from 'recharts';

function Owner() {
    const [isLoggedIn, setIsLoggedIn] = useState(false);
    const [activeTab, setActiveTab] = useState("dashboard");
    const [isMenuOpen, setIsMenuOpen] = useState(false);
    const [username, setUsername] = useState("");
    const [password, setPassword] = useState("");

    // --- 資料狀態 ---
    const [orders, setOrders] = useState([]);
    const [users, setUsers] = useState([]);
    const [rawProducts, setRawProducts] = useState([]);

    // --- 訂單管理狀態 ---
    const [orderSubTab, setOrderSubTab] = useState("today"); // 'today', 'future', 'all'
    const [filterType, setFilterType] = useState("all"); // 'all', 'self', 'delivery'
    const [expandedOrderId, setExpandedOrderId] = useState(null);
    // 暫存外送訂單的日期輸入 { orderId: '2023-10-20' }
    const [pendingDates, setPendingDates] = useState({});

    // --- 商品管理狀態 ---
    const [categoriesMap, setCategoriesMap] = useState({});
    const [brands, setBrands] = useState([]);
    const [searchText, setSearchText] = useState('');
    const [selectedParent, setSelectedParent] = useState('全部');
    const [selectedChild, setSelectedChild] = useState('全部');
    const [selectedBrand, setSelectedBrand] = useState('全部');
    const [sortBy, setSortBy] = useState('default');
    const [prodPage, setProdPage] = useState(1);
    const prodPageSize = 12;

    // --- 商品修改 Modal 狀態 ---
    const [isEditModalOpen, setIsEditModalOpen] = useState(false);
    const [editingGroup, setEditingGroup] = useState([]);
    const [editingVariant, setEditingVariant] = useState(null);

    const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042'];

    // --- 核心：資料讀取 (包含自動更新) ---
    const fetchData = useCallback(async () => {
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
    }, []);

    useEffect(() => {
        if (isLoggedIn) {
            fetchData();
            // 每 30 秒自動更新一次
            const interval = setInterval(fetchData, 30000);
            return () => clearInterval(interval);
        }
    }, [isLoggedIn, fetchData]);

    // --- 登入處理 ---
    const handleLogin = async (e) => {
        e.preventDefault();
        try {
            const res = await api.post('/api/admin/login', { username, password });
            if (res.data.success) {
                setIsLoggedIn(true);
            } else {
                alert("帳號或密碼錯誤");
            }
        } catch (err) {
            console.error(err);
            alert("登入失敗 (請檢查後端連線)");
        }
    };

    // --- 訂單操作邏輯 ---

    // 1. 確認待審訂單 (Pending Review -> Pending)
    const confirmPendingOrder = async (order) => {
        const isDelivery = order.pickupType === 'delivery';
        let payload = {};

        if (isDelivery) {
            const date = pendingDates[order.id];
            if (!date) return alert("請為送貨訂單設定出貨日期");
            payload.pickupDate = date;
        }

        if (!window.confirm(`確定接收此訂單？${isDelivery ? `(出貨日: ${payload.pickupDate})` : ''}`)) return;

        try {
            await api.put(`/api/orders/${order.id}/confirm`, payload);
            alert("訂單已確認，已移至下方列表");

            // 更新本地狀態
            setOrders(prev => prev.map(o =>
                o.id === order.id
                    ? {
                        ...o,
                        status: 'pending',
                        // 如果有更新日期，也要同步更新本地資料
                        ...(payload.pickupDate && { pickupDate: payload.pickupDate })
                    }
                    : o
            ));

            // 清除暫存日期
            const newPendingDates = { ...pendingDates };
            delete newPendingDates[order.id];
            setPendingDates(newPendingDates);

        } catch (e) {
            alert("確認失敗，請稍後再試");
        }
    };

    // 2. 完成訂單 (Pending -> Completed)
    const completeOrder = async (id) => {
        if (!window.confirm("確定標記為已完成？")) return;
        try {
            await api.put(`/api/orders/${id}/complete`);
            setOrders(prev => prev.map(o => o.id === id ? { ...o, status: 'completed' } : o));
        } catch (e) {
            alert("更新失敗");
        }
    };

    // 3. 切換明細顯示
    const toggleOrder = (id) => setExpandedOrderId(expandedOrderId === id ? null : id);

    // 4. 列印訂單
    const printOrder = async (id) => {
        const baseUrl = api.defaults.baseURL || 'http://localhost:4000';
        window.open(`${baseUrl}/api/orders/${id}/print`, '_blank');
        setOrders(prev => prev.map(o => o.id === id ? { ...o, isPrinted: true } : o));
    };

    // --- 資料分流 (待審 vs 正式列表) ---
    const pendingReviewOrders = useMemo(() => {
        return orders.filter(o => o.status === 'pending_review');
    }, [orders]);

    const mainListOrders = useMemo(() => {
        // 只顯示 'pending' (處理中) 和 'completed' (已完成)
        return orders.filter(o => o.status === 'pending' || o.status === 'completed');
    }, [orders]);

    // --- 正式列表篩選邏輯 ---
    const filteredMainOrders = useMemo(() => {
        const todayStr = moment().format('YYYY-MM-DD');
        let res = mainListOrders;

        // 日期篩選
        if (orderSubTab === 'today') {
            res = res.filter(o => o.pickupDate === todayStr);
        } else if (orderSubTab === 'future') {
            res = res.filter(o => o.pickupDate > todayStr);
        }

        // 類型篩選
        if (filterType === 'self') {
            res = res.filter(o => o.pickupType === 'self');
        } else if (filterType === 'delivery') {
            res = res.filter(o => o.pickupType === 'delivery');
        }

        return res;
    }, [mainListOrders, orderSubTab, filterType]);

    // --- 數據統計邏輯 ---
    const { stats, chartData } = useMemo(() => {
        const todayStr = moment().format('YYYY-MM-DD');
        const currentMonth = moment().format('YYYY-MM');

        let pendingCount = 0;   // 待處理 (含待審與處理中)
        let todayCompleted = 0; // 本日完成
        let monthCompleted = 0; // 本月完成

        const last7DaysMap = {};
        for (let i = 6; i >= 0; i--) last7DaysMap[moment().subtract(i, 'days').format('MM/DD')] = 0;
        const productSalesMap = {};
        let selfCount = 0, deliveryCount = 0;

        orders.forEach(o => {
            const isCompleted = o.status === 'completed';
            const orderDateFull = moment(o.rawTime).format('YYYY-MM-DD');
            const orderMonth = moment(o.rawTime).format('YYYY-MM');
            const amount = Number(o.total || 0);

            // 統計指標
            if (!isCompleted) pendingCount++;
            if (isCompleted && orderDateFull === todayStr) todayCompleted++;
            if (isCompleted && orderMonth === currentMonth) monthCompleted++;

            // 圖表數據 (統計所有有效訂單)
            const orderDateKey = moment(o.rawTime).format('MM/DD');
            if (last7DaysMap[orderDateKey] !== undefined) last7DaysMap[orderDateKey] += amount;

            if (o.products && Array.isArray(o.products)) {
                o.products.forEach(p => {
                    const pname = p.name;
                    if (!productSalesMap[pname]) productSalesMap[pname] = 0;
                    productSalesMap[pname] += Number(p.qty || 0);
                });
            }
            if (o.pickupType === 'self') selfCount++; else deliveryCount++;
        });

        const lineChartData = Object.keys(last7DaysMap).map(date => ({ date, revenue: last7DaysMap[date] }));
        const barChartData = Object.entries(productSalesMap).map(([name, qty]) => ({ name, qty })).sort((a, b) => b.qty - a.qty).slice(0, 5);
        const pieChartData = [{ name: '自取', value: selfCount }, { name: '外送', value: deliveryCount }].filter(d => d.value > 0);

        return {
            stats: { pendingCount, todayCompleted, monthCompleted },
            chartData: { lineChartData, barChartData, pieChartData }
        };
    }, [orders]);

    // --- 商品篩選與分組 ---
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

        let result = Object.keys(groups).map(name => ({
            name,
            items: groups[name],
            brand: groups[name][0].brand
        }));

        if (sortBy === 'price_asc') result.sort((a, b) => (a.items[0].price_A || 0) - (b.items[0].price_A || 0));
        else if (sortBy === 'price_desc') result.sort((a, b) => (b.items[0].price_A || 0) - (a.items[0].price_A || 0));

        return result;
    }, [rawProducts, searchText, selectedParent, selectedChild, selectedBrand, sortBy]);

    const totalProdPages = Math.ceil(processedProductGroups.length / prodPageSize);
    const currentProdData = processedProductGroups.slice((prodPage - 1) * prodPageSize, prodPage * prodPageSize);

    // --- 商品修改函式 ---
    const openEditGroupModal = (group) => {
        setEditingGroup(group.items);
        setEditingVariant({ ...group.items[0] });
        setIsEditModalOpen(true);
    };

    const saveProductChanges = async () => {
        if (!editingVariant) return;
        try {
            await api.put(`/products/${editingVariant.id}`, editingVariant);
            alert("修改成功");
            // 更新本地資料
            setRawProducts(prev => prev.map(p => p.id === editingVariant.id ? editingVariant : p));
            setEditingGroup(prev => prev.map(p => p.id === editingVariant.id ? editingVariant : p));
        } catch (e) { alert("修改失敗"); }
    };

    if (!isLoggedIn) {
        return (
            <div className="admin-login-wrapper">
                <div className="login-card">
                    <form onSubmit={handleLogin}>
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
                <div className="sidebar-brand"><h3>管理後台</h3><button className="close-sidebar" onClick={() => setIsMenuOpen(false)}>×</button></div>
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
                            <div className="stat-card"><span>🚨 待處理訂單</span><strong style={{ color: '#e53935' }}>{stats.pendingCount} 筆</strong></div>
                            <div className="stat-card"><span>✅ 本日完成訂單</span><strong style={{ color: '#43a047' }}>{stats.todayCompleted} 筆</strong></div>
                            <div className="stat-card"><span>📅 本月完成訂單</span><strong>{stats.monthCompleted} 筆</strong></div>
                        </div>
                        <div className="charts-container" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(400px, 1fr))', gap: '20px', marginTop: '30px' }}>
                            <div className="chart-card" style={{ background: 'white', padding: '20px', borderRadius: '15px' }}>
                                <h3 style={{ marginBottom: '20px', color: '#555' }}>📈 近 7 日營收趨勢</h3>
                                <div style={{ width: '100%', height: 300 }}>
                                    <ResponsiveContainer><LineChart data={chartData.lineChartData}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="date" /><YAxis /><Tooltip /><Line type="monotone" dataKey="revenue" stroke="#8884d8" /></LineChart></ResponsiveContainer>
                                </div>
                            </div>
                            <div className="chart-card" style={{ background: 'white', padding: '20px', borderRadius: '15px' }}>
                                <h3 style={{ marginBottom: '20px', color: '#555' }}>🏆 熱銷商品 Top 5</h3>
                                <div style={{ width: '100%', height: 300 }}>
                                    <ResponsiveContainer><BarChart data={chartData.barChartData} layout="vertical"><CartesianGrid strokeDasharray="3 3" /><XAxis type="number" /><YAxis dataKey="name" type="category" width={100} /><Tooltip /><Bar dataKey="qty" fill="#82ca9d" /></BarChart></ResponsiveContainer>
                                </div>
                            </div>
                            <div className="chart-card" style={{ background: 'white', padding: '20px', borderRadius: '15px' }}>
                                <h3 style={{ marginBottom: '20px', color: '#555' }}>🛵 訂單類型分佈</h3>
                                <div style={{ width: '100%', height: 300 }}>
                                    <ResponsiveContainer><PieChart><Pie data={chartData.pieChartData} cx="50%" cy="50%" innerRadius={60} outerRadius={100} fill="#8884d8" dataKey="value" label>{chartData.pieChartData.map((entry, index) => (<Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />))}</Pie><Tooltip /><Legend /></PieChart></ResponsiveContainer>
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {activeTab === "orders" && (
                    <div className="orders-view">
                        <header className="content-header"><h2>訂單管理</h2></header>

                        {/* ⭐ 新增區塊：待審訂單 (Pending Review) */}
                        <div className="pending-section" style={{ marginBottom: '40px', background: '#fff3e0', padding: '20px', borderRadius: '10px', border: '1px solid #ffe0b2' }}>
                            <h3 style={{ color: '#e65100', marginBottom: '15px' }}>🔔 待審訂單 ({pendingReviewOrders.length})</h3>
                            {pendingReviewOrders.length === 0 ? (
                                <p style={{ color: '#888' }}>目前沒有新進訂單。</p>
                            ) : (
                                <table className="admin-table" style={{ background: 'white' }}>
                                    <thead><tr><th>下單時間</th><th>類型</th><th>店家名稱</th><th>操作 / 設定</th></tr></thead>
                                    <tbody>
                                        {pendingReviewOrders.map(o => (
                                            <tr key={o.id}>
                                                <td>{o.時間}</td>
                                                <td>{o.pickupType === 'self' ? '🏠 自取' : '🚚 送貨'}</td>
                                                <td>{o.storeName}</td>
                                                <td>
                                                    {o.pickupType === 'delivery' ? (
                                                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                                            <span style={{ fontSize: '0.9em' }}>出貨日期:</span>
                                                            <input
                                                                type="date"
                                                                style={{ padding: '5px', borderRadius: '5px', border: '1px solid #ccc' }}
                                                                value={pendingDates[o.id] || ''}
                                                                onChange={(e) => setPendingDates({ ...pendingDates, [o.id]: e.target.value })}
                                                            />
                                                            <button className="btn-detail" style={{ background: '#e65100', color: 'white' }} onClick={() => confirmPendingOrder(o)}>確認訂單</button>
                                                        </div>
                                                    ) : (
                                                        <button className="btn-detail" style={{ background: '#e65100', color: 'white' }} onClick={() => confirmPendingOrder(o)}>確認訂單</button>
                                                    )}
                                                    <button className="btn-detail" onClick={() => toggleOrder(o.id)}>▼ 明細</button>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            )}
                        </div>

                        {/* 下方正式列表 */}
                        <div className="tabs" style={{ marginBottom: '10px' }}>
                            <button className={orderSubTab === 'today' ? 'active' : ''} onClick={() => setOrderSubTab('today')}>今日出單</button>
                            <button className={orderSubTab === 'future' ? 'active' : ''} onClick={() => setOrderSubTab('future')}>非今日出單</button>
                            <button className={orderSubTab === 'all' ? 'active' : ''} onClick={() => setOrderSubTab('all')}>訂單總覽</button>
                        </div>
                        <div className="sub-tabs" style={{ marginBottom: '20px', display: 'flex', gap: '10px' }}>
                            <button className={`filter-btn ${filterType === 'all' ? 'active-filter' : ''}`} onClick={() => setFilterType('all')}>全部類型</button>
                            <button className={`filter-btn ${filterType === 'self' ? 'active-filter' : ''}`} onClick={() => setFilterType('self')}>🏠 自取</button>
                            <button className={`filter-btn ${filterType === 'delivery' ? 'active-filter' : ''}`} onClick={() => setFilterType('delivery')}>🚚 送貨</button>
                        </div>
                        <div className="table-container">
                            <table className="admin-table">
                                <thead><tr><th>下單時間</th><th>取貨日期/時段</th><th>店家名稱</th><th>金額</th><th>狀態</th><th>操作</th></tr></thead>
                                <tbody>
                                    {filteredMainOrders.map(o => {
                                        const isCompleted = o.status === 'completed';
                                        return (
                                            <>
                                                <tr key={o.id} style={{
                                                    background: isCompleted ? '#f5f5f5' : (o.isPrinted ? '#f0f0f0' : 'white'),
                                                    opacity: isCompleted ? 0.6 : 1,
                                                    color: isCompleted ? '#888' : 'inherit'
                                                }}>
                                                    <td>{o.時間}</td>
                                                    <td>{o.pickupDate}<br /><span style={{ fontSize: '0.8em', color: isCompleted ? '#999' : '#666' }}>{o.pickupTime || '外送'}</span></td>
                                                    <td>{o.storeName}</td>
                                                    <td className="text-price" style={{ color: isCompleted ? '#999' : '#e53935' }}>${o.total}</td>
                                                    <td>
                                                        {isCompleted ? <span style={{ color: 'gray', fontWeight: 'bold' }}>✅ 已完成</span> :
                                                            (o.isPrinted ? <span style={{ color: 'green' }}>已列印</span> : <span style={{ color: 'red' }}>未列印</span>)
                                                        }
                                                    </td>
                                                    <td>
                                                        <button className="btn-detail" onClick={() => printOrder(o.id)}>🖨</button>
                                                        <button className="btn-detail" onClick={() => toggleOrder(o.id)}>{expandedOrderId === o.id ? '▲' : '▼'}</button>
                                                        {!isCompleted && (
                                                            <button
                                                                className="btn-detail"
                                                                style={{ background: '#43a047', color: 'white' }}
                                                                onClick={() => completeOrder(o.id)}
                                                            >
                                                                完成
                                                            </button>
                                                        )}
                                                    </td>
                                                </tr>
                                                {expandedOrderId === o.id && (
                                                    <tr style={{ background: '#fafafa' }}>
                                                        <td colSpan="6" style={{ padding: '10px 20px' }}>
                                                            <div className="order-dropdown">
                                                                <h4>商品明細：</h4>
                                                                <ul>
                                                                    {o.products && o.products.map((p, idx) => (
                                                                        <li key={idx}><span>{p.name} ({p.note})</span><span>x{p.qty} (${p.price})</span></li>
                                                                    ))}
                                                                </ul>
                                                                <div style={{ marginTop: '10px' }}>
                                                                    <p><strong>電話：</strong> {users.find(u => u.uuid === o.user_uuid)?.phone || '未知'}</p>
                                                                    <p><strong>備註：</strong> {o.order_note}</p>
                                                                </div>
                                                            </div>
                                                        </td>
                                                    </tr>
                                                )}
                                            </>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}

                {activeTab === "products" && (
                    <div className="product-page" style={{ paddingTop: '20px' }}>
                        <div className="filter-section">
                            <input placeholder="搜尋..." value={searchText} onChange={e => setSearchText(e.target.value)} style={{ marginRight: '10px', padding: '5px' }} />
                            <select onChange={e => { setSelectedParent(e.target.value); setSelectedChild('全部'); }}>
                                <option value="全部">所有分類</option>
                                {Object.keys(categoriesMap).map(c => <option key={c} value={c}>{c}</option>)}
                            </select>
                            <select value={selectedChild} onChange={(e) => setSelectedChild(e.target.value)}>
                                <option value="全部">所有子分類</option>
                                {selectedParent !== '全部' && categoriesMap[selectedParent]?.map(sub => (<option key={sub} value={sub}>{sub}</option>))}
                            </select>
                            <select value={selectedBrand} onChange={(e) => setSelectedBrand(e.target.value)}>
                                <option value="全部">所有品牌</option>
                                {brands.map(b => (<option key={b} value={b}>{b}</option>))}
                            </select>
                            <select value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
                                <option value="default">預設排序</option>
                                <option value="price_asc">價格由低到高</option>
                                <option value="price_desc">價格由高到低</option>
                            </select>
                        </div>
                        <div className="product-grid">
                            {currentProdData.map(group => (
                                <div key={group.name} className="product-card">
                                    <div className="card-body">
                                        <h3>{group.name}</h3>
                                        <span className="brand-tag">{group.brand}</span>
                                        <div style={{ marginTop: '10px', fontSize: '0.9rem', color: '#666' }}>{group.items.length} 種規格</div>
                                    </div>
                                    <button className="change-btn" onClick={() => openEditGroupModal(group)}>修改商品</button>
                                </div>
                            ))}
                        </div>
                        <div className="pagination">
                            <button onClick={() => setProdPage(p => p - 1)} disabled={prodPage === 1}>上一頁</button>
                            <span>{prodPage} / {totalProdPages}</span>
                            <button onClick={() => setProdPage(p => p + 1)} disabled={prodPage === totalProdPages}>下一頁</button>
                        </div>
                    </div>
                )}

                {activeTab === "users" && (
                    <div className="users-view">
                        <header className="content-header"><h2>使用者管理</h2></header>
                        <div className="table-container">
                            <table className="admin-table">
                                <thead><tr><th>店家名稱</th><th>電話</th><th>價格等級</th><th>取貨偏好</th><th>歷史訂單數</th><th>總消費</th></tr></thead>
                                <tbody>
                                    {users.map(u => (
                                        <tr key={u.uuid}>
                                            <td>{u.store_name}</td>
                                            <td>{u.phone}</td>
                                            <td>{u.price_tier}</td>
                                            <td>{u.delivery_type === 'self' ? '自取' : '外送'}</td>
                                            <td>{u.order_count}</td>
                                            <td>${Number(u.total_spent).toLocaleString()}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}

                {isEditModalOpen && editingVariant && (
                    <div className="modal-overlay">
                        <div className="modal-content">
                            <h3>修改商品</h3>
                            <div className="specs-list">
                                {editingGroup.map(item => (
                                    <button
                                        className={`filter-btn ${editingVariant && editingVariant.id === item.id ? 'active-filter' : ''}`}
                                        key={item.id}
                                        onClick={() => setEditingVariant({ ...item })}
                                    >
                                        {item.spec}
                                    </button>
                                ))}
                            </div>
                            <div className="input-group">
                                <label>品名</label>
                                <input value={editingVariant.name} onChange={e => setEditingVariant({ ...editingVariant, name: e.target.value })} />
                            </div>
                            <div className="input-group">
                                <label>價格 A</label>
                                <input value={editingVariant.price_A} onChange={e => setEditingVariant({ ...editingVariant, price_A: e.target.value })} />
                            </div>
                            <div className="modal-btns">
                                <button className="cancel-btn" onClick={() => setIsEditModalOpen(false)}>關閉</button>
                                <button className="confirm-btn" onClick={saveProductChanges}>儲存</button>
                            </div>
                        </div>
                    </div>
                )}
            </main>
        </div>
    );
}

export default Owner;