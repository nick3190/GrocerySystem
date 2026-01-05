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

    // 資料狀態
    const [orders, setOrders] = useState([]);
    const [users, setUsers] = useState([]);
    const [rawProducts, setRawProducts] = useState([]);

    // 訂單篩選
    const [orderSubTab, setOrderSubTab] = useState("today"); // 'today', 'future', 'all'
    const [filterType, setFilterType] = useState("all"); // 'all', 'self', 'delivery'
    const [expandedOrderId, setExpandedOrderId] = useState(null);

    // 商品管理
    const [categoriesMap, setCategoriesMap] = useState({});
    const [brands, setBrands] = useState([]);
    const [searchText, setSearchText] = useState('');
    const [selectedParent, setSelectedParent] = useState('全部');
    const [selectedChild, setSelectedChild] = useState('全部');
    const [selectedBrand, setSelectedBrand] = useState('全部');
    const [sortBy, setSortBy] = useState('default');
    const [prodPage, setProdPage] = useState(1);
    const prodPageSize = 12;

    // 商品修改
    const [isEditModalOpen, setIsEditModalOpen] = useState(false);
    const [editingGroup, setEditingGroup] = useState([]);
    const [editingVariant, setEditingVariant] = useState(null);

    const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042'];

    // --- 核心：資料讀取 ---
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
            console.error(err);
            alert("登入失敗");
        }
    };

    // --- 訂單操作：完成訂單 ---
    const completeOrder = async (id) => {
        if (!window.confirm("確定標記為已完成？")) return;
        try {
            await api.put(`/api/orders/${id}/complete`);
            // 更新本地狀態，讓 UI 即時反應
            setOrders(prev => prev.map(o => o.id === id ? { ...o, status: 'completed' } : o));
        } catch (e) {
            alert("更新失敗");
        }
    };

    // --- 訂單篩選邏輯 ---
    const filteredOrders = useMemo(() => {
        const todayStr = moment().format('YYYY-MM-DD');
        let res = orders;

        if (orderSubTab === 'today') {
            res = res.filter(o => o.pickupDate === todayStr);
        } else if (orderSubTab === 'future') {
            res = res.filter(o => o.pickupDate > todayStr);
        }

        if (filterType === 'self') {
            res = res.filter(o => o.pickupType === 'self');
        } else if (filterType === 'delivery') {
            res = res.filter(o => o.pickupType === 'delivery');
        }

        return res;
    }, [orders, orderSubTab, filterType]);

    // --- ⭐ 數據統計修正 ---
    const { stats, chartData } = useMemo(() => {
        const todayStr = moment().format('YYYY-MM-DD');
        const currentMonth = moment().format('YYYY-MM');
        
        let pendingCount = 0;        // 待處理 (所有未完成的)
        let todayCompleted = 0;      // 本日完成
        let monthCompleted = 0;      // 本月完成 (筆數或金額，這裡示範筆數)

        const last7DaysMap = {};
        for(let i=6; i>=0; i--) last7DaysMap[moment().subtract(i, 'days').format('MM/DD')] = 0;
        const productSalesMap = {};
        let selfCount = 0, deliveryCount = 0;

        orders.forEach(o => {
            const isCompleted = o.status === 'completed';
            const orderDateFull = moment(o.rawTime).format('YYYY-MM-DD');
            const orderMonth = moment(o.rawTime).format('YYYY-MM');
            const amount = Number(o.total || 0);

            // 1. 待處理訂單 (狀態不是 completed)
            if (!isCompleted) {
                pendingCount++;
            }

            // 2. 本日完成 (狀態是 completed 且 訂單日期是今天) 
            // *註：若定義為「今天按下完成按鈕」，則後端需多存 completed_at，這裡暫以訂單日期為主
            if (isCompleted && orderDateFull === todayStr) {
                todayCompleted++; 
            }

            // 3. 本月完成
            if (isCompleted && orderMonth === currentMonth) {
                monthCompleted++;
            }

            // 圖表數據 (依舊統計所有訂單，或依需求只統計已完成)
            const orderDateKey = moment(o.rawTime).format('MM/DD');
            if (last7DaysMap[orderDateKey] !== undefined) last7DaysMap[orderDateKey] += amount;

            if (o.products && Array.isArray(o.products)) {
                o.products.forEach(p => {
                    const pname = p.name;
                    if (!productSalesMap[pname]) productSalesMap[pname] = 0;
                    productSalesMap[pname] += Number(p.qty || 0);
                });
            }
            if (o.pickupTime) selfCount++; else deliveryCount++;
        });

        const lineChartData = Object.keys(last7DaysMap).map(date => ({ date, revenue: last7DaysMap[date] }));
        const barChartData = Object.entries(productSalesMap).map(([name, qty]) => ({ name, qty })).sort((a, b) => b.qty - a.qty).slice(0, 5);
        const pieChartData = [{ name: '自取', value: selfCount }, { name: '外送', value: deliveryCount }].filter(d => d.value > 0);

        return { 
            stats: { pendingCount, todayCompleted, monthCompleted }, 
            chartData: { lineChartData, barChartData, pieChartData } 
        };
    }, [orders]);

    // ... (商品分組 useMemo 保持不變) ...
    const processedProductGroups = useMemo(() => {
        let filtered = rawProducts.filter(item => {
            if (searchText && !item.name.includes(searchText)) return false;
            if (selectedParent !== '全部' && item.main_category !== selectedParent) return false;
            if (selectedChild !== '全部' && item.sub_category !== selectedChild) return false;
            if (selectedBrand !== '全部' && item.brand !== selectedBrand) return false;
            return true;
        });
        const groups = {};
        filtered.forEach(item => { if (!groups[item.name]) groups[item.name] = []; groups[item.name].push(item); });
        
        let result = Object.keys(groups).map(name => ({ name, items: groups[name], brand: groups[name][0].brand }));
        if (sortBy === 'price_asc') result.sort((a, b) => (a.items[0].price_A || 0) - (b.items[0].price_A || 0));
        else if (sortBy === 'price_desc') result.sort((a, b) => (b.items[0].price_A || 0) - (a.items[0].price_A || 0));
        
        return result;
    }, [rawProducts, searchText, selectedParent, selectedChild, selectedBrand, sortBy]);

    const totalProdPages = Math.ceil(processedProductGroups.length / prodPageSize);
    const currentProdData = processedProductGroups.slice((prodPage - 1) * prodPageSize, prodPage * prodPageSize);

    // --- 操作函式 ---
    const toggleOrder = (id) => setExpandedOrderId(expandedOrderId === id ? null : id);
    const printOrder = async (id) => {
        const baseUrl = api.defaults.baseURL || 'http://localhost:4000';
        window.open(`${baseUrl}/api/orders/${id}/print`, '_blank');
        setOrders(prev => prev.map(o => o.id === id ? { ...o, isPrinted: true } : o));
    };
    const openEditGroupModal = (group) => { setEditingGroup(group.items); setEditingVariant({ ...group.items[0] }); setIsEditModalOpen(true); };
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
                        
                        {/* ⭐ 修改後的數據卡片 */}
                        <div className="stat-grid">
                            <div className="stat-card"><span>🚨 待處理訂單</span><strong style={{color:'#e53935'}}>{stats.pendingCount} 筆</strong></div>
                            <div className="stat-card"><span>✅ 本日完成訂單</span><strong style={{color:'#43a047'}}>{stats.todayCompleted} 筆</strong></div>
                            <div className="stat-card"><span>📅 本月完成訂單</span><strong>{stats.monthCompleted} 筆</strong></div>
                        </div>

                        <div className="charts-container" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(400px, 1fr))', gap: '20px', marginTop: '30px' }}>
                            <div className="chart-card" style={{ background: 'white', padding: '20px', borderRadius: '15px' }}>
                                <h3 style={{ marginBottom: '20px', color: '#555' }}>📈 近 7 日營收趨勢</h3>
                                <div style={{ width: '100%', height: 300 }}><ResponsiveContainer><LineChart data={chartData.lineChartData}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="date" /><YAxis /><Tooltip /><Line type="monotone" dataKey="revenue" stroke="#8884d8" /></LineChart></ResponsiveContainer></div>
                            </div>
                            <div className="chart-card" style={{ background: 'white', padding: '20px', borderRadius: '15px' }}>
                                <h3 style={{ marginBottom: '20px', color: '#555' }}>🏆 熱銷商品 Top 5</h3>
                                <div style={{ width: '100%', height: 300 }}><ResponsiveContainer><BarChart data={chartData.barChartData} layout="vertical"><CartesianGrid strokeDasharray="3 3" /><XAxis type="number" /><YAxis dataKey="name" type="category" width={100} /><Tooltip /><Bar dataKey="qty" fill="#82ca9d" /></BarChart></ResponsiveContainer></div>
                            </div>
                            <div className="chart-card" style={{ background: 'white', padding: '20px', borderRadius: '15px' }}>
                                <h3 style={{ marginBottom: '20px', color: '#555' }}>🛵 訂單類型分佈</h3>
                                <div style={{ width: '100%', height: 300 }}><ResponsiveContainer><PieChart><Pie data={chartData.pieChartData} cx="50%" cy="50%" innerRadius={60} outerRadius={100} fill="#8884d8" dataKey="value" label>{chartData.pieChartData.map((entry, index) => (<Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />))}</Pie><Tooltip /><Legend /></PieChart></ResponsiveContainer></div>
                            </div>
                        </div>
                    </div>
                )}

                {activeTab === "orders" && (
                    <div className="orders-view">
                        <header className="content-header"><h2>訂單管理</h2></header>
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
                                    {filteredOrders.map(o => {
                                        // ⭐ 判斷是否完成
                                        const isCompleted = o.status === 'completed';
                                        return (
                                            <>
                                                <tr key={o.id} style={{ 
                                                    background: isCompleted ? '#f5f5f5' : (o.isPrinted ? '#f0f0f0' : 'white'), 
                                                    opacity: isCompleted ? 0.6 : 1 // 完成後變淡
                                                }}>
                                                    <td>{o.時間}</td>
                                                    <td>{o.pickupDate}<br /><span style={{ fontSize: '0.8em', color: '#666' }}>{o.pickupTime || '外送'}</span></td>
                                                    <td>{o.storeName}</td>
                                                    <td className="text-price">${o.total}</td>
                                                    <td>
                                                        {isCompleted ? <span style={{color:'gray', fontWeight:'bold'}}>✅ 已完成</span> : 
                                                            (o.isPrinted ? <span style={{ color: 'green' }}>已列印</span> : <span style={{ color: 'red' }}>未列印</span>)
                                                        }
                                                    </td>
                                                    <td>
                                                        <button className="btn-detail" onClick={() => printOrder(o.id)}>🖨</button>
                                                        <button className="btn-detail" onClick={() => toggleOrder(o.id)}>{expandedOrderId === o.id ? '▲' : '▼'}</button>
                                                        {/* ⭐ 新增完成按鈕 (只有未完成時顯示) */}
                                                        {!isCompleted && (
                                                            <button 
                                                                className="btn-detail" 
                                                                style={{background: '#43a047', color:'white'}} 
                                                                onClick={() => completeOrder(o.id)}
                                                            >
                                                                完成
                                                            </button>
                                                        )}
                                                    </td>
                                                </tr>
                                                {expandedOrderId === o.id && (
                                                    <tr style={{ background: '#fafafa' }}><td colSpan="6" style={{ padding: '10px 20px' }}><div className="order-dropdown"><h4>商品明細：</h4><ul>{o.products && o.products.map((p, idx) => (<li key={idx}><span>{p.name} ({p.note})</span><span>x{p.qty} (${p.price})</span></li>))}</ul><div style={{ marginTop: '10px' }}><p><strong>電話：</strong> {users.find(u => u.uuid === o.user_uuid)?.phone || '未知'}</p><p><strong>備註：</strong> {o.order_note}</p></div></div></td></tr>
                                                )}
                                            </>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}

                {/* ... (商品管理與使用者管理 Tab 保持不變) ... */}
                {activeTab === "products" && (<div className="product-page" style={{ paddingTop: '20px' }}><div className="filter-section"><input placeholder="搜尋..." value={searchText} onChange={e => setSearchText(e.target.value)} style={{marginRight: '10px', padding: '5px'}}/><select onChange={e => {setSelectedParent(e.target.value); setSelectedChild('全部');}}><option value="全部">所有分類</option>{Object.keys(categoriesMap).map(c => <option key={c} value={c}>{c}</option>)}</select><select value={selectedChild} onChange={(e) => setSelectedChild(e.target.value)}><option value="全部">所有子分類</option>{selectedParent !== '全部' && categoriesMap[selectedParent]?.map(sub => (<option key={sub} value={sub}>{sub}</option>))}</select><select value={selectedBrand} onChange={(e) => setSelectedBrand(e.target.value)}><option value="全部">所有品牌</option>{brands.map(b => (<option key={b} value={b}>{b}</option>))}</select><select value={sortBy} onChange={(e) => setSortBy(e.target.value)}><option value="default">預設排序</option><option value="price_asc">價格由低到高</option><option value="price_desc">價格由高到低</option></select></div><div className="product-grid">{currentProdData.map(group => (<div key={group.name} className="product-card"><div className="card-body"><h3>{group.name}</h3><span className="brand-tag">{group.brand}</span><div style={{ marginTop: '10px', fontSize: '0.9rem', color: '#666' }}>{group.items.length} 種規格</div></div><button className="change-btn" onClick={() => openEditGroupModal(group)}>修改商品</button></div>))}</div><div className="pagination"><button onClick={() => setProdPage(p => p - 1)} disabled={prodPage === 1}>上一頁</button><span>{prodPage} / {totalProdPages}</span><button onClick={() => setProdPage(p => p + 1)} disabled={prodPage === totalProdPages}>下一頁</button></div></div>)}
                {activeTab === "users" && (<div className="users-view"><header className="content-header"><h2>使用者管理</h2></header><div className="table-container"><table className="admin-table"><thead><tr><th>店家名稱</th><th>電話</th><th>價格等級</th><th>取貨偏好</th><th>歷史訂單數</th><th>總消費</th></tr></thead><tbody>{users.map(u => (<tr key={u.uuid}><td>{u.store_name}</td><td>{u.phone}</td><td>{u.price_tier}</td><td>{u.delivery_type === 'self' ? '自取' : '外送'}</td><td>{u.order_count}</td><td>${Number(u.total_spent).toLocaleString()}</td></tr>))}</tbody></table></div></div>)}
                {isEditModalOpen && editingVariant && (<div className="modal-overlay"><div className="modal-content"><h3>修改商品</h3><div className="specs-list">{editingGroup.map(item => (<button key={item.id} onClick={() => setEditingVariant({ ...item })}>{item.spec}</button>))}</div><div className="input-group"><label>品名</label><input value={editingVariant.name} onChange={e => setEditingVariant({ ...editingVariant, name: e.target.value })} /></div><div className="input-group"><label>價格 A</label><input value={editingVariant.price_A} onChange={e => setEditingVariant({ ...editingVariant, price_A: e.target.value })} /></div><div className="modal-btns"><button className="cancel-btn" onClick={() => setIsEditModalOpen(false)}>關閉</button><button className="confirm-btn" onClick={saveProductChanges}>儲存</button></div></div></div>)}
            </main>
        </div>
    );
}

export default Owner;