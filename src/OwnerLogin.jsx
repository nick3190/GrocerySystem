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
    const [filterType, setFilterType] = useState("all"); // 'all', 'self', 'delivery' (⭐ 新增)
    const [expandedOrderId, setExpandedOrderId] = useState(null);

    // --- 商品管理狀態 ---
    const [categoriesMap, setCategoriesMap] = useState({});
    const [brands, setBrands] = useState([]);
    const [searchText, setSearchText] = useState('');
    const [selectedParent, setSelectedParent] = useState('全部');
    const [selectedChild, setSelectedChild] = useState('全部');
    const [selectedBrand, setSelectedBrand] = useState('全部');
    const [prodPage, setProdPage] = useState(1);
    const prodPageSize = 12;

    // 商品修改
    const [isEditModalOpen, setIsEditModalOpen] = useState(false);
    const [editingGroup, setEditingGroup] = useState([]);
    const [editingVariant, setEditingVariant] = useState(null);

    const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042'];

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

    // --- 初始化與自動更新 ---
    useEffect(() => {
        if (isLoggedIn) {
            fetchData();
            // ⭐ 每 30 秒自動更新一次
            const interval = setInterval(fetchData, 30000);
            return () => clearInterval(interval);
        }
    }, [isLoggedIn, fetchData]);

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
            alert("登入失敗");
        }
    };

    // --- 訂單篩選邏輯 (整合日期與類型) ---
    const filteredOrders = useMemo(() => {
        const todayStr = moment().format('YYYY-MM-DD');
        let res = orders;

        // 1. 日期篩選
        if (orderSubTab === 'today') {
            res = res.filter(o => o.pickupDate === todayStr);
        } else if (orderSubTab === 'future') {
            res = res.filter(o => o.pickupDate > todayStr);
        }
        // 'all' 不做日期過濾

        // 2. 類型篩選 (⭐ 新增)
        if (filterType === 'self') {
            res = res.filter(o => o.pickupType === 'self');
        } else if (filterType === 'delivery') {
            res = res.filter(o => o.pickupType === 'delivery');
        }

        return res;
    }, [orders, orderSubTab, filterType]);


    // --- 數據統計與圖表資料 ---
    const { stats, chartData } = useMemo(() => {
        const todayStr = moment().format('YYYY-MM-DD');
        const currentMonth = moment().format('YYYY-MM');
        let todayCount = 0, todayRevenue = 0, monthRevenue = 0;

        // 1. 準備折線圖資料 (近7日營收)
        const last7DaysMap = {};
        for (let i = 6; i >= 0; i--) {
            const d = moment().subtract(i, 'days').format('YYYY-MM-DD');
            last7DaysMap[d] = 0;
        }

        // 2. 準備長條圖資料 (商品銷量)
        const productSalesMap = {};

        // 3. 準備圓餅圖資料 (自取 vs 外送)
        let selfCount = 0;
        let deliveryCount = 0;

        orders.forEach(o => {
            // 基礎統計
            if (o.pickupDate === todayStr) todayCount++;

            const orderDate = moment(o.rawTime).format('YYYY-MM-DD');
            const orderMonth = moment(o.rawTime).format('YYYY-MM');
            const amount = Number(o.total || 0);

            if (orderDate === todayStr) todayRevenue += amount;
            if (orderMonth === currentMonth) monthRevenue += amount;

            // 折線圖數據填充
            if (last7DaysMap[orderDate] !== undefined) {
                last7DaysMap[orderDate] += amount;
            }

            // 長條圖數據填充 (解析訂單內的商品)
            if (o.products && Array.isArray(o.products)) {
                o.products.forEach(p => {
                    const pname = p.name;
                    if (!productSalesMap[pname]) productSalesMap[pname] = 0;
                    productSalesMap[pname] += Number(p.qty || 0);
                });
            }

            // 圓餅圖數據填充 (判斷邏輯：有 pickupTime 視為自取，否則外送)
            if (o.pickupTime) selfCount++;
            else deliveryCount++;
        });

        // 格式化折線圖資料
        const lineChartData = Object.keys(last7DaysMap).map(date => ({
            date: moment(date).format('MM/DD'), // 簡化日期顯示
            revenue: last7DaysMap[date]
        }));

        // 格式化長條圖資料 (取 Top 5)
        const barChartData = Object.entries(productSalesMap)
            .map(([name, qty]) => ({ name, qty }))
            .sort((a, b) => b.qty - a.qty)
            .slice(0, 5);

        // 格式化圓餅圖資料
        const pieChartData = [
            { name: '自取', value: selfCount },
            { name: '外送', value: deliveryCount }
        ].filter(d => d.value > 0); // 過濾掉 0 的項目避免顯示難看

        return {
            stats: { todayCount, todayRevenue, monthRevenue },
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
        return Object.keys(groups).map(name => ({
            name,
            items: groups[name],
            brand: groups[name][0].brand
        }));
    }, [rawProducts, searchText, selectedParent, selectedChild, selectedBrand]);

    const totalProdPages = Math.ceil(processedProductGroups.length / prodPageSize);
    const currentProdData = processedProductGroups.slice(
        (prodPage - 1) * prodPageSize,
        prodPage * prodPageSize
    );

    const toggleOrder = (id) => setExpandedOrderId(expandedOrderId === id ? null : id);

    const printOrder = async (id) => {
        const baseUrl = api.defaults.baseURL || 'http://localhost:4000';
        window.open(`${baseUrl}/api/orders/${id}/print`, '_blank');
        setOrders(prev => prev.map(o => o.id === id ? { ...o, isPrinted: true } : o));
    };

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
            setRawProducts(prev => prev.map(p => p.id === editingVariant.id ? editingVariant : p));
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

                        {/* 1. 核心指標卡片 */}
                        <div className="stat-grid">
                            <div className="stat-card"><span>今日訂單數 (依取貨日)</span><strong>{stats.todayCount} 筆</strong></div>
                            <div className="stat-card"><span>本日收益 (依下單日)</span><strong>${stats.todayRevenue.toLocaleString()}</strong></div>
                            <div className="stat-card"><span>本月收益</span><strong>${stats.monthRevenue.toLocaleString()}</strong></div>
                        </div>

                        {/* 2. 圖表區域 */}
                        <div className="charts-container" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(400px, 1fr))', gap: '20px', marginTop: '30px' }}>

                            {/* 近 7 日營收趨勢 (折線圖) */}
                            <div className="chart-card" style={{ background: 'white', padding: '20px', borderRadius: '15px', boxShadow: '0 5px 15px rgba(0,0,0,0.05)' }}>
                                <h3 style={{ marginBottom: '20px', color: '#555' }}>📈 近 7 日營收趨勢</h3>
                                <div style={{ width: '100%', height: 300 }}>
                                    <ResponsiveContainer>
                                        <LineChart data={chartData.lineChartData}>
                                            <CartesianGrid strokeDasharray="3 3" />
                                            <XAxis dataKey="date" />
                                            <YAxis />
                                            <Tooltip formatter={(value) => `$${value}`} />
                                            <Line type="monotone" dataKey="revenue" name="營收" stroke="#8884d8" strokeWidth={3} activeDot={{ r: 8 }} />
                                        </LineChart>
                                    </ResponsiveContainer>
                                </div>
                            </div>

                            {/* 熱銷商品 Top 5 (長條圖) */}
                            <div className="chart-card" style={{ background: 'white', padding: '20px', borderRadius: '15px', boxShadow: '0 5px 15px rgba(0,0,0,0.05)' }}>
                                <h3 style={{ marginBottom: '20px', color: '#555' }}>🏆 熱銷商品 Top 5</h3>
                                <div style={{ width: '100%', height: 300 }}>
                                    <ResponsiveContainer>
                                        <BarChart data={chartData.barChartData} layout="vertical">
                                            <CartesianGrid strokeDasharray="3 3" />
                                            <XAxis type="number" />
                                            <YAxis dataKey="name" type="category" width={100} />
                                            <Tooltip />
                                            <Bar dataKey="qty" name="銷量" fill="#82ca9d" radius={[0, 10, 10, 0]} />
                                        </BarChart>
                                    </ResponsiveContainer>
                                </div>
                            </div>

                            {/* 訂單類型分佈 (圓餅圖) */}
                            <div className="chart-card" style={{ background: 'white', padding: '20px', borderRadius: '15px', boxShadow: '0 5px 15px rgba(0,0,0,0.05)' }}>
                                <h3 style={{ marginBottom: '20px', color: '#555' }}>🛵 訂單類型分佈</h3>
                                <div style={{ width: '100%', height: 300 }}>
                                    <ResponsiveContainer>
                                        <PieChart>
                                            <Pie
                                                data={chartData.pieChartData}
                                                cx="50%"
                                                cy="50%"
                                                innerRadius={60}
                                                outerRadius={100}
                                                fill="#8884d8"
                                                paddingAngle={5}
                                                dataKey="value"
                                                label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                                            >
                                                {chartData.pieChartData.map((entry, index) => (
                                                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                                                ))}
                                            </Pie>
                                            <Tooltip />
                                            <Legend verticalAlign="bottom" height={36} />
                                        </PieChart>
                                    </ResponsiveContainer>
                                </div>
                            </div>

                        </div>
                    </div>
                )}

                {/* --- 訂單管理 Tab --- */}
                {activeTab === "orders" && (
                    <div className="orders-view">
                        <header className="content-header"><h2>訂單管理</h2></header>

                        {/* 第一層：日期篩選 */}
                        <div className="tabs" style={{ marginBottom: '10px' }}>
                            <button className={orderSubTab === 'today' ? 'active' : ''} onClick={() => setOrderSubTab('today')}>今日出單</button>
                            <button className={orderSubTab === 'future' ? 'active' : ''} onClick={() => setOrderSubTab('future')}>非今日出單</button>
                            <button className={orderSubTab === 'all' ? 'active' : ''} onClick={() => setOrderSubTab('all')}>訂單概覽</button>
                        </div>

                        {/* ⭐ 第二層：類型篩選 */}
                        <div className="sub-tabs" style={{ marginBottom: '20px', display: 'flex', gap: '10px' }}>
                            <button className={`filter-btn ${filterType === 'all' ? 'active-filter' : ''}`} onClick={() => setFilterType('all')}>全部類型</button>
                            <button className={`filter-btn ${filterType === 'self' ? 'active-filter' : ''}`} onClick={() => setFilterType('self')}>🏠 自取</button>
                            <button className={`filter-btn ${filterType === 'delivery' ? 'active-filter' : ''}`} onClick={() => setFilterType('delivery')}>🚚 送貨</button>
                        </div>


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
                                        <>
                                            <tr key={o.id} style={{ background: o.isPrinted ? '#f0f0f0' : 'white', borderBottom: 'none' }}>
                                                <td>{o.時間}</td>
                                                <td>{o.pickupDate}<br /><span style={{ fontSize: '0.8em', color: '#666' }}>{o.pickupTime || '外送'}</span></td>
                                                <td>{o.storeName}</td>
                                                <td className="text-price">${o.total}</td>
                                                <td>{o.isPrinted ? <span style={{ color: 'green' }}>已列印</span> : <span style={{ color: 'red' }}>未列印</span>}</td>
                                                <td>
                                                    <button className="btn-detail" onClick={() => printOrder(o.id)}>🖨</button>
                                                    <button className="btn-detail" onClick={() => toggleOrder(o.id)}>
                                                        {expandedOrderId === o.id ? '▲' : '▼'}
                                                    </button>
                                                </td>
                                            </tr>
                                            {expandedOrderId === o.id && (
                                                <tr style={{ background: '#fafafa' }}>
                                                    <td colSpan="6" style={{ padding: '10px 20px' }}>
                                                        <div className="order-dropdown">
                                                            <h4>商品明細：</h4>
                                                            <ul>
                                                                {o.products && o.products.map((p, idx) => (
                                                                    <li key={idx} style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid #eee', padding: '5px 0' }}>
                                                                        <span>{p.name} ({p.note})</span>
                                                                        <span>x{p.qty} (${p.price})</span>
                                                                    </li>
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
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}

                {/* --- 商品管理 Tab --- */}
                {activeTab === "products" && (
                    <div className="product-page" style={{ paddingTop: '20px' }}>
                        <div className="filter-section" style={{ marginBottom: '20px' }}>
                            <input placeholder="搜尋..." value={searchText} onChange={e => setSearchText(e.target.value)} className="search-input" style={{ width: '200px' }} />
                            <select onChange={e => { setSelectedParent(e.target.value); setProdPage(1); }}>
                                <option value="全部">所有分類</option>
                                {Object.keys(categoriesMap).map(c => <option key={c} value={c}>{c}</option>)}
                            </select>

                            <select value={selectedChild} onChange={(e) => setSelectedChild(e.target.value)}>
                                <option value="全部">所有子分類</option>
                                {selectedParent !== '全部' && categoriesMap[selectedParent]?.map(sub => (
                                    <option key={sub} value={sub}>{sub}</option>
                                ))}
                            </select>

                            <select value={selectedBrand} onChange={(e) => setSelectedBrand(e.target.value)}>
                                <option value="全部">所有品牌</option>
                                {brands.map(b => (
                                    <option key={b} value={b}>{b}</option>
                                ))}
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
                                        <div style={{ marginTop: '10px', fontSize: '0.9rem', color: '#666' }}>
                                            {group.items.length} 種規格
                                        </div>
                                    </div>
                                    <button className="change-btn" onClick={() => openEditGroupModal(group)}>修改商品</button>
                                </div>
                            ))}
                        </div>
                        {totalProdPages > 1 && (
                            <div className="pagination">
                                <button onClick={() => setProdPage(p => Math.max(1, p - 1))} disabled={prodPage === 1}>上一頁</button>
                                <span>{prodPage} / {totalProdPages}</span>
                                <button onClick={() => setProdPage(p => Math.min(totalProdPages, p + 1))} disabled={prodPage === totalProdPages}>下一頁</button>
                            </div>
                        )}
                    </div>
                )}

                {/* --- 使用者管理 Tab --- */}
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
                                        <tr key={u.uuid}>
                                            <td>{u.store_name}</td>
                                            <td>{u.phone}</td>
                                            <td>{u.price_tier}</td>
                                            <td>
                                                {u.delivery_type === 'self' ? '自取' : '外送'}<br />
                                                <span style={{ fontSize: '0.8em', color: '#666' }}>{u.pickup_time || u.address}</span>
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

                {/* --- 修改商品 Modal --- */}
                {isEditModalOpen && editingVariant && (
                    <div className="modal-overlay">
                        <div className="modal-content">
                            <h3>修改商品: {editingVariant.name}</h3>
                            <div className="specs-list" style={{ flexDirection: 'row', flexWrap: 'wrap', marginBottom: '15px' }}>
                                {editingGroup.map(item => (
                                    <button
                                        key={item.id}
                                        className={`spec-btn ${editingVariant.id === item.id ? 'active' : ''}`}
                                        style={{ padding: '5px 10px', width: 'auto', minWidth: '80px' }}
                                        onClick={() => setEditingVariant({ ...item })}
                                    >
                                        {item.spec}
                                    </button>
                                ))}
                            </div>
                            <div className="input-group">
                                <label>品名 (所有規格連動)</label>
                                <input value={editingVariant.name} onChange={e => setEditingVariant({ ...editingVariant, name: e.target.value })} />
                            </div>
                            <div className="input-group">
                                <label>規格名稱</label>
                                <input value={editingVariant.spec} onChange={e => setEditingVariant({ ...editingVariant, spec: e.target.value })} />
                            </div>
                            <div style={{ display: 'flex', gap: '10px' }}>
                                <div className="input-group">
                                    <label>價格 A</label>
                                    <input type="number" value={editingVariant.price_A} onChange={e => setEditingVariant({ ...editingVariant, price_A: e.target.value })} />
                                </div>
                                <div className="input-group">
                                    <label>價格 B</label>
                                    <input type="number" value={editingVariant.price_B} onChange={e => setEditingVariant({ ...editingVariant, price_B: e.target.value })} />
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





