import { useState, useEffect, useMemo, useCallback } from "react";
import api from "./api";
import "./OwnerLogin.css";
import "./ProductList.css";
import moment from 'moment';
import {
    LineChart, Line, BarChart, Bar, PieChart, Pie, Cell,
    XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer
} from 'recharts';

import Fuse from 'fuse.js';

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
    const [bundles, setBundles] = useState([]); // 套組資料

    // --- 訂單管理狀態 ---
    const [orderSubTab, setOrderSubTab] = useState("today");
    const [filterType, setFilterType] = useState("all");
    const [expandedOrderId, setExpandedOrderId] = useState(null);
    const [pendingDates, setPendingDates] = useState({});
    const [editingOrder, setEditingOrder] = useState(null);
    const [editingOrderDate, setEditingOrderDate] = useState('');
    const [orderSearchInput, setOrderSearchInput] = useState('');
    const [activeOrderSearch, setActiveOrderSearch] = useState('');
    const [completedSearchInput, setCompletedSearchInput] = useState('');
    const [activeCompletedSearch, setActiveCompletedSearch] = useState('');
    const [completedFilterType, setCompletedFilterType] = useState('all');

    // 分頁 State (不會因切換 Tab 重置)
    const [pendingPage, setPendingPage] = useState(1);
    const [expiredPage, setExpiredPage] = useState(1);
    const [ordersPage, setOrdersPage] = useState(1);
    const orderPageSize = 15;

    // --- 商品管理狀態 ---
    const [categoriesMap, setCategoriesMap] = useState({});
    const [brands, setBrands] = useState([]);
    const [searchInput, setSearchInput] = useState('');
    const [activeSearch, setActiveSearch] = useState('');
    const [selectedParent, setSelectedParent] = useState('全部');
    const [selectedChild, setSelectedChild] = useState('全部');
    const [selectedBrand, setSelectedBrand] = useState('全部');
    const [selectedSaler, setSelectedSaler] = useState('全部');
    const [sortBy, setSortBy] = useState('default');
    const [prodPage, setProdPage] = useState(1);
    const prodPageSize = 17;

    // ⭐ 利潤設定
    const [profitRatio, setProfitRatio] = useState(1.2);
    const [isEditingProfit, setIsEditingProfit] = useState(false);

    const [isEditModalOpen, setIsEditModalOpen] = useState(false);
    const [editingGroup, setEditingGroup] = useState([]);
    const [editingVariant, setEditingVariant] = useState(null);
    const [syncCommonFields, setSyncCommonFields] = useState(false);

    // --- 使用者管理狀態 ---
    const [expandedUserHistory, setExpandedUserHistory] = useState(null);
    const [expandedHistoryOrderId, setExpandedHistoryOrderId] = useState(null);
    const [editingUser, setEditingUser] = useState(null);

    // --- 套組管理狀態 (優化版) ---
    const [isBundleModalOpen, setIsBundleModalOpen] = useState(false);
    const [editingBundleId, setEditingBundleId] = useState(null);
    const [newBundle, setNewBundle] = useState({
        title: '',
        image: '',
        filterType: 'category', // 'category' | 'search' | 'manual'
        filterValue: '',
        productIds: [] // 儲存手動選擇的商品ID
    });
    const [bundleProductSearch, setBundleProductSearch] = useState('');
    const [manualSelectCategory, setManualSelectCategory] = useState('全部'); // 手動選品時的分類篩選
    const [manualSelectSubCategory, setManualSelectSubCategory] = useState('全部');
    const [manualSelectBrand, setManualSelectBrand] = useState('全部');
    const [manualShowSelected, setManualShowSelected] = useState(false);

    const [isVariantModalOpen, setIsVariantModalOpen] = useState(false);
    const [selectingProductGroup, setSelectingProductGroup] = useState(null);

    const [notification, setNotification] = useState(null); // { message: '新訂單 #1234' }
    const [lastOrderId, setLastOrderId] = useState(null);

    const [isPrintPreviewOpen, setIsPrintPreviewOpen] = useState(false);
    const [previewOrder, setPreviewOrder] = useState(null);

    const [completedPage, setCompletedPage] = useState(1);
    const [dashboardRange, setDashboardRange] = useState('7'); // '7', '30', '90'
    const [categoryChartMode, setCategoryChartMode] = useState('main'); // 'main' | 'sub'

    const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042'];

    // --- 初始化資料讀取 ---
    const fetchData = useCallback(async () => {
        try {
            const [ordRes, prodRes, catRes, brandRes, userRes, bundleRes] = await Promise.all([
                api.get("/history"),
                api.get("/products"),
                api.get("/api/categories"),
                api.get("/api/brands"),
                api.get("/api/users"),
                api.get("/api/bundles")
            ]);

            if (ordRes.data.length > 0) {
                const latest = ordRes.data[0].id;
                if (lastOrderId && latest !== lastOrderId) {
                    setNotification(`📦 接到新訂單！編號: ${latest}`);
                }
                setLastOrderId(latest);
            }

            setOrders(ordRes.data || []);
            setRawProducts(prodRes.data || []);
            setCategoriesMap(catRes.data || {});
            setBrands(brandRes.data || []);
            setUsers(userRes.data || []);
            setBundles(bundleRes.data || []);
        } catch (err) { console.error(err); }
    }, [lastOrderId]);

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
            if (res.data.success) setIsLoggedIn(true);
            else alert("帳號或密碼錯誤");
        } catch (err) { alert("登入失敗"); }
    };

    const handleLogout = async () => {
        try { await api.post('/logout'); setIsLoggedIn(false); } catch (e) { }
    };

    // --- 計算唯一供應商列表 ---
    const uniqueSalers = useMemo(() => {
        return [...new Set(rawProducts.map(p => p.saler).filter(Boolean))];
    }, [rawProducts]);

    // --- 訂單篩選 ---
    const todayStr = moment().format('YYYY-MM-DD');
    const expiredOrders = useMemo(() => {
        return orders.filter(o => o.status !== 'completed' && o.status !== 'pending_review' && o.pickupDate < todayStr);
    }, [orders]);

    const pendingReviewOrders = useMemo(() => orders.filter(o => o.status === 'pending_review'), [orders]);
    const mainListOrders = useMemo(() => orders.filter(o => o.status === 'pending' || o.status === 'completed'), [orders]);

    const { activeOrders, completedOrders } = useMemo(() => {
        let res = mainListOrders;
        if (orderSubTab === 'today') res = res.filter(o => o.pickupDate === todayStr);
        else if (orderSubTab === 'future') res = res.filter(o => o.pickupDate > todayStr);

        if (filterType !== 'all') res = res.filter(o => o.pickupType === filterType);

        const active = res.filter(o => o.status !== 'completed');
        const completed = res.filter(o => o.status === 'completed');

        // ⭐ 在非今日出單標籤，不顯示已完成
        if (orderSubTab === 'future') {
            return { activeOrders: active, completedOrders: [] };
        }

        return { activeOrders: active, completedOrders: completed };
    }, [mainListOrders, orderSubTab, filterType]);

    // --- 訂單修改日期 ---
    const updateOrderDate = async (id) => {
        if (!editingOrderDate) return;
        try {
            await api.put(`/api/orders/${id}`, { pickup_date: editingOrderDate }); // Server 需支援只傳日期
            alert("日期已更新");
            fetchData();
        } catch (e) { alert("更新失敗"); }
    };

    // --- 訂單操作邏輯 ---
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
            alert("訂單已確認");
            setOrders(prev => prev.map(o =>
                o.id === order.id
                    ? { ...o, status: 'pending', ...(payload.pickupDate && { pickupDate: payload.pickupDate }) }
                    : o
            ));
            const newPendingDates = { ...pendingDates };
            delete newPendingDates[order.id];
            setPendingDates(newPendingDates);
        } catch (e) { alert("確認失敗"); }
    };

    const completeOrder = async (id) => {
        if (!window.confirm("確定標記為已完成？")) return;
        try {
            await api.put(`/api/orders/${id}/complete`);
            setOrders(prev => prev.map(o => o.id === id ? { ...o, status: 'completed' } : o));
        } catch (e) { alert("更新失敗"); }
    };

    const deleteOrder = async (id) => {
        if (!window.confirm("⚠️ 確定要永久刪除此訂單嗎？")) return;
        try {
            await api.delete(`/history/${id}`);
            setOrders(prev => prev.filter(o => o.id !== id));
            alert("訂單已刪除");
        } catch (e) { alert("刪除失敗"); }
    };

    const startEditOrder = (order) => {
        setEditingOrder(JSON.parse(JSON.stringify(order)));
        setEditingOrderDate(order.pickupDate);
        setExpandedOrderId(order.id); // 自動展開明細
    };

    const saveOrderEdit = async () => {
        if (!editingOrder) return;
        if (!window.confirm("確定儲存修改？")) return;

        // ⭐ 修正：確保 products 存在才進行 reduce 計算，否則預設為 []
        const currentProducts = editingOrder.products || [];
        const newTotal = currentProducts.reduce((sum, p) => sum + (Number(p.price) * Number(p.qty)), 0);

        try {
            await api.put(`/api/orders/${editingOrder.id}`, {
                items: currentProducts, // 使用確保存在的 products
                total: newTotal,
                order_note: editingOrder.order_note,
                pickup_date: editingOrder.pickupDate,
                pickup_type: editingOrder.pickupType,
                is_printed: editingOrder.isPrinted
            });

            setOrders(prev => prev.map(o => o.id === editingOrder.id ? { ...editingOrder, total: newTotal } : o));
            setEditingOrder(null);
            alert("修改成功");
        } catch (e) {
            console.error(e);
            alert("修改失敗");
        }
    };

    const handleEditItemQty = (index, delta) => {
        setEditingOrder(prev => {
            const newProducts = [...prev.products];
            const item = newProducts[index];
            const newQty = Math.max(0, Number(item.qty) + delta);

            if (newQty === 0) {
                if (window.confirm("數量為 0 將移除此商品，確定嗎？")) {
                    newProducts.splice(index, 1);
                }
            } else {
                newProducts[index] = { ...item, qty: newQty };
            }
            return { ...prev, products: newProducts };
        });
    };

    const toggleOrder = (id) => setExpandedOrderId(expandedOrderId === id ? null : id);
    const printOrder = async (id) => {
        const baseUrl = api.defaults.baseURL || 'http://localhost:4000';
        window.open(`${baseUrl}/api/orders/${id}/print`, '_blank');
        setOrders(prev => prev.map(o => o.id === id ? { ...o, isPrinted: true } : o));
    };

    // ⭐ 套用利潤設定
    const handleEditProfit = () => setIsEditingProfit(true);
    const handleSaveProfit = async () => {
        try {
            await api.put('/api/settings', { key: 'profit_ratio', value: profitRatio });
            alert("全域利潤已儲存");
            setIsEditingProfit(false);
        } catch (e) { alert("儲存失敗"); }
    };
    const handleApplyProfitToAll = async () => {
        if (!confirm(`確定將全商品價格套用利潤 ${profitRatio}？此操作無法復原。`)) return;
        try {
            await api.post('/api/products/apply-profit', { ratio: profitRatio });
            alert("套用成功，請重新整理頁面以查看更新");
            fetchData();
        } catch (e) { alert("套用失敗"); }
    };
    const applyProfitSettings = () => {
        if (!editingVariant) return;
        const newPriceA = Math.round((editingVariant.standard_cost || 0) * profitRatio);
        setEditingVariant({ ...editingVariant, price_A: newPriceA });
    };

    // --- 套組管理邏輯 ---
    const openCreateBundle = () => {
        setEditingBundleId(null);
        setNewBundle({ title: '', image: '', filterType: 'category', filterValue: '', productIds: [] });
        setIsBundleModalOpen(true);
    };

    const openEditBundle = (bundle) => {
        setEditingBundleId(bundle.id);
        setNewBundle({
            title: bundle.title,
            image: bundle.image,
            filterType: bundle.filter_type,
            filterValue: bundle.filter_value,
            productIds: bundle.product_ids ? bundle.product_ids.split(',').map(Number) : []
        });
        setIsBundleModalOpen(true);
    };

    const handleSaveBundle = async () => {
        if (!newBundle.title) return alert("請輸入套組名稱");
        if (newBundle.filterType === 'manual' && newBundle.productIds.length === 0) return alert("請至少選擇一項商品");

        try {
            if (editingBundleId) {
                // 編輯模式
                await api.put(`/api/bundles/${editingBundleId}`, newBundle);
                alert("套組已更新！");
            } else {
                // 新增模式
                await api.post('/api/bundles', newBundle);
                alert("套組已建立！");
            }
            const res = await api.get("/api/bundles");
            setBundles(res.data);
            setIsBundleModalOpen(false);
        } catch (e) {
            console.error(e);
            alert("儲存失敗");
        }
    };

    const handleDeleteBundle = async (e, id) => {
        e.stopPropagation(); // 避免觸發編輯
        if (!confirm("確定刪除此套組？")) return;
        try {
            await api.delete(`/api/bundles/${id}`);
            setBundles(prev => prev.filter(b => b.id !== id));
        } catch (e) { alert("刪除失敗"); }
    };


    // 套組選品：將 rawProducts 分組 (顯示為商品卡)
    const groupedProductsForSelection = useMemo(() => {
        let filtered = rawProducts;

        // 1. 搜尋
        if (bundleProductSearch) {
            const fuse = new Fuse(rawProducts, { keys: ['name', 'alias'], threshold: 0.3 });
            filtered = fuse.search(bundleProductSearch).map(r => r.item);
        }

        // 2. 篩選
        if (manualSelectCategory !== '全部') filtered = filtered.filter(p => p.main_category === manualSelectCategory);
        if (manualSelectSubCategory !== '全部') filtered = filtered.filter(p => p.sub_category === manualSelectSubCategory);
        if (manualSelectBrand !== '全部') filtered = filtered.filter(p => p.brand === manualSelectBrand);

        // 3. 只顯示已選
        if (manualShowSelected) {
            filtered = filtered.filter(p => newBundle.productIds.includes(p.id));
        }

        const groups = {};
        filtered.forEach(item => {
            if (!groups[item.name]) groups[item.name] = [];
            groups[item.name].push(item);
        });

        return Object.keys(groups).map(name => ({
            name,
            items: groups[name],
            mainImg: groups[name][0].image || null,
            isSelected: groups[name].some(item => newBundle.productIds.includes(item.id))
        }));
    }, [rawProducts, bundleProductSearch, manualSelectCategory, manualSelectSubCategory, manualSelectBrand, manualShowSelected, newBundle.productIds]);

    const handleGroupClick = (group) => {
        setSelectingProductGroup(group);
        setIsVariantModalOpen(true);
    };

    // 在第二層 Modal 中切換規格選擇
    const toggleVariantInBundle = (productId) => {
        setNewBundle(prev => {
            const ids = new Set(prev.productIds);
            if (ids.has(productId)) ids.delete(productId);
            else ids.add(productId);
            return { ...prev, productIds: Array.from(ids) };
        });
    };

    const { stats, chartData } = useMemo(() => {
        const now = moment();
        const rangeDate = moment().subtract(Number(dashboardRange), 'days');

        // 過濾有效訂單
        const validOrders = orders.filter(o =>
            o.status !== 'pending_review' &&
            moment(o.rawTime).isAfter(rangeDate)
        );

        let totalRevenue = 0;
        let totalCost = 0;
        const dateMap = {};
        const productSalesMap = {};
        const categoryMap = {}; // 分類圓餅圖用
        let selfCount = 0, deliveryCount = 0; // 自取/送貨圓餅圖用

        // 初始化日期 Map
        for (let i = Number(dashboardRange) - 1; i >= 0; i--) {
            const d = moment().subtract(i, 'days').format('MM/DD');
            dateMap[d] = { revenue: 0, cost: 0, profit: 0 };
        }

        validOrders.forEach(o => {
            const d = moment(o.rawTime).format('MM/DD');

            // 計算自取/送貨
            if (o.pickupType === 'self') selfCount++; else deliveryCount++;

            if (dateMap[d]) {
                const revenue = Number(o.total || 0);
                let orderCost = 0;

                if (o.products) {
                    o.products.forEach(p => {
                        // ⭐ 成本計算：優先用訂單內的 cost，沒有的話去 rawProducts 查 standard_cost
                        let unitCost = Number(p.cost || 0);
                        if (unitCost === 0 && rawProducts.length > 0) {
                            const found = rawProducts.find(r => r.id == p.id || r.name === p.name); // 寬鬆匹配
                            if (found) unitCost = Number(found.standard_cost || 0);
                        }
                        orderCost += unitCost * Number(p.qty || 0);

                        // ⭐ 分類統計
                        let catName = '其他';
                        const foundProd = rawProducts.find(r => r.id == p.id || r.name === p.name);
                        if (foundProd) {
                            catName = categoryChartMode === 'main' ? (foundProd.main_category || '其他') : (foundProd.sub_category || '其他');
                        }
                        categoryMap[catName] = (categoryMap[catName] || 0) + Number(p.qty);

                        // 熱銷商品
                        productSalesMap[p.name] = (productSalesMap[p.name] || 0) + Number(p.qty);
                    });
                }

                dateMap[d].revenue += revenue;
                dateMap[d].cost += orderCost;
                dateMap[d].profit += (revenue - orderCost);

                totalRevenue += revenue;
                totalCost += orderCost;
            }
        });

        // 轉換圖表資料
        const lineChartData = Object.keys(dateMap).map(date => ({
            date,
            revenue: dateMap[date].revenue,
            cost: dateMap[date].cost,
            profit: dateMap[date].profit
        }));

        const barChartData = Object.entries(productSalesMap)
            .map(([name, qty]) => ({ name, qty })).sort((a, b) => b.qty - a.qty).slice(0, 5);

        const categoryPieData = Object.entries(categoryMap)
            .map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);

        const typePieData = [
            { name: '自取', value: selfCount },
            { name: '送貨', value: deliveryCount }
        ].filter(d => d.value > 0);

        // 頂部卡片數據
        const todayStr = moment().format('YYYY-MM-DD');
        const currentMonth = moment().format('YYYY-MM');
        let pendingCount = 0, todayCompleted = 0, monthCompleted = 0;
        orders.forEach(o => {
            if (o.status === 'pending_review') pendingCount++;
            if (o.status === 'completed') {
                if (moment(o.rawTime).format('YYYY-MM-DD') === todayStr) todayCompleted++;
                if (moment(o.rawTime).format('YYYY-MM') === currentMonth) monthCompleted++;
            }
        });

        return {
            stats: { pendingCount, todayCompleted, monthCompleted, totalRevenue, totalProfit: totalRevenue - totalCost },
            chartData: { lineChartData, barChartData, categoryPieData, typePieData }
        };
    }, [orders, rawProducts, dashboardRange, categoryChartMode]);

    // --- 商品管理邏輯 ---
    const handleProductSearch = () => {
        setActiveSearch(searchInput);
        setSelectedParent('全部');
        setSelectedChild('全部');
        setSelectedBrand('全部');
        setSelectedSaler('全部');
        setProdPage(1);
    };

    const handleProfitChange = (val) => {
        if (!editingVariant) return;
        const profit = Number(val);
        const cost = Number(editingVariant.standard_cost || 0);
        setEditingVariant({ ...editingVariant, profit: profit, price_A: cost + profit });
    };

    const handleCostChange = (val) => {
        if (!editingVariant) return;
        const cost = Number(val);
        const profit = Number(editingVariant.profit || 0);
        // 若有設定 profit 則優先使用加法，否則維持原值
        setEditingVariant({ ...editingVariant, standard_cost: cost, price_A: cost + profit });
    };

    const processedProductGroups = useMemo(() => {
        let filtered = rawProducts;

        if (activeSearch) {
            const keywords = activeSearch.toLowerCase().split(/\s+/).filter(Boolean);
            filtered = filtered.filter(p => {
                const target = `${p.name} ${p.brand || ''} ${p.spec || ''} ${p.alias || ''} ${p.saler || ''}`.toLowerCase();
                return keywords.every(k => target.includes(k));
            });
        }

        filtered = filtered.filter(item => {
            if (selectedParent !== '全部' && item.main_category !== selectedParent) return false;
            if (selectedChild !== '全部' && item.sub_category !== selectedChild) return false;
            if (selectedBrand !== '全部' && item.brand !== selectedBrand) return false;
            // ⭐ 確保這裡有加入進貨人篩選
            if (selectedSaler !== '全部' && item.saler !== selectedSaler) return false;
            return true;
        });

        const groups = {};
        filtered.forEach(item => { if (!groups[item.name]) groups[item.name] = []; groups[item.name].push(item); });

        let result = Object.keys(groups).map(name => ({
            name,
            items: groups[name],
            brand: groups[name][0].brand,
            mainImg: groups[name][0].image || null
        }));

        if (sortBy === 'price_asc') result.sort((a, b) => (a.items[0].price_A || 0) - (b.items[0].price_A || 0));
        else if (sortBy === 'price_desc') result.sort((a, b) => (b.items[0].price_A || 0) - (a.items[0].price_A || 0));
        else if (sortBy === 'popularity_desc') result.sort((a, b) => (b.items[0].popularity || 0) - (a.items[0].popularity || 0));

        return result;
    }, [rawProducts, activeSearch, selectedParent, selectedChild, selectedBrand, selectedSaler, sortBy]);

    const totalProdPages = Math.ceil(processedProductGroups.length / prodPageSize);
    const currentProdData = processedProductGroups.slice((prodPage - 1) * prodPageSize, prodPage * prodPageSize);

    const openEditGroupModal = (group) => { setEditingGroup(group.items); setEditingVariant({ ...group.items[0] }); setIsEditModalOpen(true); };
    const saveProductChanges = async () => {
        if (!editingVariant) return;
        try {
            if (editingVariant.id) {
                // --- 舊商品：執行更新 (PUT) ---
                await api.put(`/products/${editingVariant.id}`, editingVariant);

                // 同步更新邏輯 (保持不變)
                if (syncCommonFields) {
                    const commonFields = {
                        name: editingVariant.name,
                        brand: editingVariant.brand,
                        image: editingVariant.image,
                        main_category: editingVariant.main_category,
                        sub_category: editingVariant.sub_category,
                        saler: editingVariant.saler,
                        alias: editingVariant.alias
                    };
                    const otherIds = editingGroup.filter(i => i.id && i.id !== editingVariant.id).map(i => i.id);
                    const promises = otherIds.map(id => api.put(`/products/${id}`, { ...editingGroup.find(i => i.id === id), ...commonFields }));
                    await Promise.all(promises);
                    alert("修改成功 (含同步更新)");
                } else {
                    alert("修改成功");
                }
            } else {
                // --- 新商品：執行新增 (POST) ---
                await api.post("/products", editingVariant);
                alert("新增成功");
            }

            // 重新抓取資料並關閉視窗
            fetchData();
            setIsEditModalOpen(false);
        } catch (e) {
            console.error(e);
            alert("儲存失敗");
        }
    };

    //建立新規格
    const handleAddNewVariant = () => {
        if (!editingVariant) return;

        // 建立一個新物件，複製大部分欄位，但清空規格相關欄位
        const newVariant = {
            ...editingVariant,
            id: null, // 標記為新商品
            spec: '', // 清空規格讓用戶填
            flavor: '',
            price_A: editingVariant.price_A || 0,
            price_B: editingVariant.price_B || 0
        };

        // 將這個暫存的新規格加入編輯群組，並設為當前編輯對象
        setEditingGroup(prev => [...prev, newVariant]);
        setEditingVariant(newVariant);
    };

    //建立新產品
    const handleCreateProduct = () => {
        const emptyProduct = {
            id: null,
            name: '',
            brand: '',
            spec: '',
            price_A: 0,
            // ...其他欄位會由 input 自動填入 undefined/empty
        };
        setEditingGroup([emptyProduct]); // 群組只有它自己
        setEditingVariant(emptyProduct);
        setSyncCommonFields(false);
        setIsEditModalOpen(true);
    };

    //刪除單一規格
    const handleDeleteVariant = async (e, variantId) => {
        e.stopPropagation(); // 避免觸發切換規格
        if (!confirm("確定刪除此規格？")) return;

        try {
            await api.delete(`/products/${variantId}`);

            // 更新 UI state
            const newGroup = editingGroup.filter(item => item.id !== variantId);

            if (newGroup.length === 0) {
                // 如果刪光了，關閉視窗並重整
                setIsEditModalOpen(false);
                fetchData();
            } else {
                setEditingGroup(newGroup);
                // 如果刪除的是當前選中的，切換到剩下的一個
                if (editingVariant.id === variantId) {
                    setEditingVariant(newGroup[0]);
                }
                fetchData(); // 背景更新列表
            }
        } catch (err) {
            alert("刪除失敗");
        }
    };

    //刪除整個商品（所有規格）
    const handleDeleteProduct = async () => {
        if (!confirm(`⚠️ 確定要刪除商品「${editingVariant.name}」嗎？\n這將會刪除該商品底下的【所有規格】。\n此操作無法復原。`)) return;

        try {
            // 刪除群組內所有 ID
            const promises = editingGroup.map(item => api.delete(`/products/${item.id}`));
            await Promise.all(promises);

            alert("商品已完整刪除");
            setIsEditModalOpen(false);
            fetchData();
        } catch (err) {
            alert("刪除失敗");
        }
    };

    //  匯出所有商品資料
    const handleExportAllProducts = () => {
        window.open(`${api.defaults.baseURL || 'http://localhost:4000'}/api/products/export`, '_blank');
    };

    // 列印預覽處理器
    const handlePrintPreview = (order) => {
        setPreviewOrder(order);
        setIsPrintPreviewOpen(true);
    };

    // 執行列印 (修正版：詢問後才更新狀態)
    const handleBrowserPrint = async () => {
        window.print();

        // 給一點延遲讓列印視窗出來
        setTimeout(async () => {
            if (previewOrder && !previewOrder.isPrinted) {
                if (window.confirm("請問列印是否成功？(點擊「確定」將標記為已列印)")) {
                    try {
                        // 呼叫後端更新 DB
                        await api.put(`/api/orders/${previewOrder.id}/print-status`);

                        // 更新本地 State
                        setOrders(prev => prev.map(o => o.id === previewOrder.id ? { ...o, isPrinted: true } : o));
                        if (previewOrder) setPreviewOrder(prev => ({ ...prev, isPrinted: true }));
                    } catch (e) {
                        alert("狀態更新失敗");
                    }
                }
            }
        }, 500);
    };

    // 下載 Excel (舊有功能)
    const handleDownloadOrderExcel = () => {
        if (!previewOrder) return;
        const baseUrl = api.defaults.baseURL || 'http://localhost:4000';
        window.open(`${baseUrl}/api/orders/${previewOrder.id}/print`, '_blank');
        // 更新狀態
        setOrders(prev => prev.map(o => o.id === previewOrder.id ? { ...o, isPrinted: true } : o));
    };

    //  圖片上傳處理器
    const handleFileUpload = async (e, targetSetter, currentData) => {
        const file = e.target.files[0];
        if (!file) return;

        const formData = new FormData();
        formData.append('file', file);

        try {
            // 顯示上傳中... (可選)
            const res = await api.post('/api/upload', formData, {
                headers: { 'Content-Type': 'multipart/form-data' }
            });

            // 上傳成功，更新狀態中的圖片檔名
            targetSetter({ ...currentData, image: res.data.filename });
            alert("圖片上傳成功！");
        } catch (err) {
            console.error(err);
            alert("圖片上傳失敗");
        }
    };

    //分頁功能
    const PaginationControl = ({ curr, total, setPage }) => {
        const [val, setVal] = useState(curr);
        useEffect(() => setVal(curr), [curr]); // 同步外部變化

        const commit = () => {
            let p = Number(val);
            if (isNaN(p)) p = 1;
            if (p < 1) p = 1;
            if (p > total) p = total;
            setPage(p);
            setVal(p);
        };
        return (
            <div className="pagination" style={{ padding: '10px 0' }}>
                <button onClick={() => setPage(Math.max(1, curr - 1))} disabled={curr === 1}>◀</button>
                <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                    <input
                        type="number"
                        value={val}
                        onChange={e => setVal(e.target.value)}
                        onBlur={commit}
                        onKeyDown={e => e.key === 'Enter' && commit()}
                        style={{ width: '50px', textAlign: 'center', padding: '5px', borderRadius: '4px', border: '1px solid #ddd' }}
                    />
                    <span> / {total}</span>
                </div>
                <button onClick={() => setPage(Math.min(total, curr + 1))} disabled={curr === total}>▶</button>
            </div>
        );
    };

    const handleOrderSearch = () => {
        setActiveOrderSearch(orderSearchInput);
        setOrdersPage(1); // 搜尋時重置分頁
    };

    const processedOrders = useMemo(() => {
        let res = orders;

        // 搜尋邏輯 (名字 或 20250108 格式)
        if (activeOrderSearch) {
            const term = activeOrderSearch.toLowerCase();
            res = res.filter(o => {
                const dateStr = moment(o.rawTime).format('YYYYMMDD');
                const name = (o.storeName || '').toLowerCase();
                return name.includes(term) || dateStr.includes(term);
            });
        }
        return res;
    }, [orders, activeOrderSearch]);

    // ⭐ 修改：訂單分類邏輯 (已完成訂單完全獨立)
    const { pendingData, expiredData, mainData, completedData } = useMemo(() => {
        const todayStr = moment().format('YYYY-MM-DD');

        // 1. 待審
        const pending = processedOrders.filter(o => o.status === 'pending_review');

        // 2. 過期
        const expired = processedOrders.filter(o => o.status !== 'completed' && o.status !== 'pending_review' && o.pickupDate < todayStr);

        // 3. 已完成 (獨立搜尋邏輯)
        let completed = orders.filter(o => o.status === 'completed');
        if (activeCompletedSearch) {
            const term = activeCompletedSearch.toLowerCase();
            completed = completed.filter(o => {
                const dateStr = moment(o.rawTime).format('YYYYMMDD');
                const name = (o.storeName || '').toLowerCase();
                return name.includes(term) || dateStr.includes(term);
            });
        }
        if (completedFilterType !== 'all') {
            completed = completed.filter(o => o.pickupType === completedFilterType);
        }

        // 4. 主要列表 (進行中)
        let main = processedOrders.filter(o =>
            o.status !== 'completed' &&
            o.status !== 'pending_review' &&
            o.pickupDate >= todayStr
        );
        if (orderSubTab === 'today') main = main.filter(o => o.pickupDate === todayStr);
        else if (orderSubTab === 'future') main = main.filter(o => o.pickupDate > todayStr);
        if (filterType !== 'all') main = main.filter(o => o.pickupType === filterType);

        return { pendingData: pending, expiredData: expired, mainData: main, completedData: completed };
    }, [processedOrders, orders, orderSubTab, filterType, activeCompletedSearch, completedFilterType]);

    // 分頁裁切
    const getPagedData = (data, page) => {
        const start = (page - 1) * orderPageSize;
        return {
            data: data.slice(start, start + orderPageSize),
            totalPages: Math.ceil(data.length / orderPageSize) || 1
        };
    };

    const pagedPending = getPagedData(pendingData, pendingPage);
    const pagedExpired = getPagedData(expiredData, expiredPage);
    const pagedMain = getPagedData(mainData, ordersPage);
    const pagedCompleted = getPagedData(completedData, completedPage); // ⭐ 新增分頁

    const handleImageError = (e) => {
        e.target.onerror = null;
        e.target.src = '/images/default.png';
    };
    // --- 使用者編輯 ---
    const handleEditUser = (user) => { setEditingUser({ ...user }); };
    const saveUserChanges = async () => {
        if (!editingUser) return;
        try {
            await api.put(`/api/users/${editingUser.uuid}`, editingUser);
            alert("使用者已更新");
            fetchData();
            setEditingUser(null);
        } catch (e) { alert("更新失敗"); }
    };

    // --- 渲染元件 ---
    const renderOrderRow = (o, isCompleted = false, isPendingReview = false) => {
        const isEditing = editingOrder && editingOrder.id === o.id;
        // 如果正在編輯，顯示編輯中的資料，否則顯示原始資料
        const displayOrder = isEditing ? editingOrder : o;

        return (
            <>
                <tr key={o.id} style={{
                    background: isCompleted ? '#f5f5f5' : (o.isPrinted ? '#f0f0f0' : 'white'),
                    opacity: isCompleted ? 0.6 : 1,
                    color: isCompleted ? '#888' : 'inherit',
                    borderLeft: isEditing ? '4px solid #2196f3' : 'none' // 編輯中提示
                }}>
                    <td>{o.時間}</td>

                    {/* ⭐ 可編輯的日期與方式 */}
                    <td>
                        {isEditing ? (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                                <input
                                    type="date"
                                    value={displayOrder.pickupDate}
                                    onChange={e => setEditingOrder({ ...editingOrder, pickupDate: e.target.value })}
                                    style={{ padding: '4px' }}
                                />
                                <select
                                    value={displayOrder.pickupType}
                                    onChange={e => setEditingOrder({ ...editingOrder, pickupType: e.target.value })}
                                    style={{ padding: '4px' }}
                                >
                                    <option value="self">自取</option>
                                    <option value="delivery">送貨</option>
                                </select>
                            </div>
                        ) : (
                            <>
                                {o.pickupDate}<br />
                                <span style={{ fontSize: '0.8em', color: '#666' }}>
                                    {o.pickupType === 'delivery' ? '🚚 送貨' : '🏠 自取'} {o.pickupTime}
                                </span>
                            </>
                        )}
                    </td>

                    <td>{o.storeName}</td>

                    {/* 金額與確認按鈕邏輯保持不變 */}
                    {isPendingReview ? (
                        <td>
                            {o.pickupType === 'delivery' ? (
                                <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                                    <input type="date" style={{ padding: '5px', border: '1px solid #ccc', borderRadius: '4px' }} value={pendingDates[o.id] || ''} onChange={(e) => setPendingDates({ ...pendingDates, [o.id]: e.target.value })} />
                                    <button className="btn-detail" style={{ background: '#e65100', color: 'white' }} onClick={() => confirmPendingOrder(o)}>確認</button>
                                </div>
                            ) : (
                                <button className="btn-detail" style={{ background: '#e65100', color: 'white' }} onClick={() => confirmPendingOrder(o)}>確認</button>
                            )}
                        </td>
                    ) : (
                        <td className="text-price" style={{ color: isCompleted ? '#999' : '#e53935' }}>${o.total}</td>
                    )}

                    {/* ⭐ 可編輯的列印狀態 */}
                    <td>
                        {isEditing ? (
                            <label style={{ cursor: 'pointer', display: 'flex', alignItems: 'center' }}>
                                <input
                                    type="checkbox"
                                    checked={displayOrder.isPrinted}
                                    onChange={e => setEditingOrder({ ...editingOrder, isPrinted: e.target.checked })}
                                    style={{ marginRight: '5px' }}
                                />
                                已列印
                            </label>
                        ) : (
                            isPendingReview ? <p style={{ color: '#ff0303ff' }}>待審核</p> : (isCompleted ? <p style={{ color: '#4caf50' }}>✅ 已完成</p> : (o.isPrinted ? <p style={{ color: '#2196f3' }}>已列印</p> : <p style={{ color: '#9e9e9e' }}>未列印</p>))
                        )}
                    </td>

                    {/* 操作按鈕區 */}
                    <td>
                        {!isPendingReview && !isEditing && (
                            <button className="btn-detail" style={{ background: '#2196f3', color: 'white' }} onClick={() => handlePrintPreview(o)} title="列印/下載">🖨</button>
                        )}

                        {/* 展開/收合明細 */}
                        <button className="btn-detail" style={{ color: 'white' }} onClick={() => toggleOrder(o.id)}>{expandedOrderId === o.id ? '▲' : '▼'}</button>

                        {/* 完成按鈕 (非編輯狀態才顯示) */}
                        {!isCompleted && !isPendingReview && !isEditing && (
                            <button className="btn-detail" style={{ background: '#43a047', color: 'white' }} onClick={() => completeOrder(o.id)}>完成</button>
                        )}

                        {/* 編輯/儲存 按鈕切換 */}
                        {!isPendingReview && !isCompleted && (
                            isEditing ? (
                                <div style={{ marginTop: '5px', display: 'flex', gap: '5px' }}>
                                    <button className="btn-detail" style={{ background: '#2196f3', color: 'white' }} onClick={saveOrderEdit}>儲存</button>
                                    <button className="btn-detail" style={{ background: '#757575', color: 'white' }} onClick={() => setEditingOrder(null)}>取消</button>
                                </div>
                            ) : (
                                <button className="btn-detail" style={{ marginLeft: '5px', background: '#ffa000', color: 'white' }} onClick={() => startEditOrder(o)}>編輯</button>
                            )
                        )}

                        {/* 刪除按鈕 (非編輯狀態才顯示) */}
                        {!isCompleted && !isPendingReview && !isEditing && (
                            <button className="btn-delete" onClick={() => deleteOrder(o.id)} style={{ background: 'red', color: 'white' }}>刪除訂單</button>
                        )}
                    </td>
                </tr>

                {/* 下拉明細區塊 (保持不變，但移除重複的編輯按鈕) */}
                {expandedOrderId === o.id && (
                    <tr style={{ background: '#fafafa' }}>
                        <td colSpan="6" style={{ padding: '10px 20px' }}>
                            <div className="order-dropdown">
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                                    <h4>商品明細：</h4>
                                </div>
                                <ul>
                                    {displayOrder.products && displayOrder.products.map((p, idx) => (
                                        <li key={idx} style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', borderBottom: '1px solid #eee' }}>
                                            <span>{p.name} ({p.note})</span>
                                            {isEditing ? (
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                                    <button onClick={() => handleEditItemQty(idx, -1)} style={{ padding: '2px 8px' }}>-</button>
                                                    <span>{p.qty}</span>
                                                    <button onClick={() => handleEditItemQty(idx, 1)} style={{ padding: '2px 8px' }}>+</button>
                                                </div>
                                            ) : (
                                                <span>x{p.qty}</span>
                                            )}
                                            <span>(${p.price})</span>
                                        </li>
                                    ))}
                                </ul>
                                {isEditing && (
                                    <div style={{ marginTop: '10px', fontWeight: 'bold', color: 'blue' }}>
                                        預估新總價: ${(displayOrder.products || []).reduce((sum, p) => sum + (Number(p.price) * Number(p.qty)), 0)}
                                    </div>
                                )}
                                <div style={{ marginTop: '10px' }}>
                                    <p><strong>電話：</strong> {users.find(u => u.uuid === o.user_uuid)?.phone || '未知'}</p>
                                    <p><strong>備註：</strong>
                                        {isEditing ?
                                            <input value={displayOrder.order_note || ''} onChange={e => setEditingOrder({ ...editingOrder, order_note: e.target.value })} style={{ width: '80%', padding: '5px', border: '1px solid #ccc' }} />
                                            : o.order_note}
                                    </p>
                                </div>
                            </div>
                        </td>
                    </tr>
                )}
            </>
        );
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
            {/* ⭐ Hamburger Button */}
            <button className="hamburger-btn" onClick={() => setIsMenuOpen(true)}>☰</button>
            <div className={`sidebar-overlay ${isMenuOpen ? "active" : ""}`} onClick={() => setIsMenuOpen(false)}></div>

            <nav className={`admin-sidebar ${isMenuOpen ? "open" : ""}`}>
                <div className="sidebar-brand"><h3>管理後台</h3><button className="close-sidebar" onClick={() => setIsMenuOpen(false)}>×</button></div>
                <div className="nav-menu">
                    <button className={activeTab === "dashboard" ? "active" : ""} onClick={() => setActiveTab("dashboard")}>📊 數據看板</button>
                    <button className={activeTab === "orders" ? "active" : ""} onClick={() => setActiveTab("orders")}>📦 訂單管理</button>
                    <button className={activeTab === "products" ? "active" : ""} onClick={() => setActiveTab("products")}>🍎 商品管理</button>
                    <button className={activeTab === "bundles" ? "active" : ""} onClick={() => setActiveTab("bundles")}>🎁 套組管理</button>
                    <button className={activeTab === "users" ? "active" : ""} onClick={() => setActiveTab("users")}>👥 使用者管理</button>
                    <button className="logout-btn-nav" onClick={handleLogout}>登出</button>
                </div>
            </nav>

            {/* ⭐ 通知系統 */}
            {notification && (
                <div className="notification-toast">
                    <span>{notification}</span>
                    <button onClick={() => setNotification(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.2rem' }}>×</button>
                </div>
            )}

            <main className="admin-content">
                {activeTab === "dashboard" && (
                    <div className="dashboard-view">
                        <header className="content-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <h2>數據看板</h2>
                            <select value={dashboardRange} onChange={e => setDashboardRange(e.target.value)} style={{ padding: '5px', borderRadius: '5px' }}>
                                <option value="7">近 7 天</option>
                                <option value="30">近 30 天</option>
                                <option value="90">近 90 天</option>
                            </select>
                        </header>
                        <div className="stat-grid">
                            <div className="stat-card"><span>💰 區間營收</span><strong>${stats.totalRevenue.toLocaleString()}</strong></div>
                            <div className="stat-card"><span>📈 區間淨利</span><strong style={{ color: '#2196f3' }}>${stats.totalProfit.toLocaleString()}</strong></div>
                        </div>

                        <div className="charts-container" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(400px, 1fr))', gap: '20px', marginTop: '30px' }}>
                            {/* 財務趨勢圖 */}
                            <div className="chart-card" style={{ background: 'white', padding: '20px', borderRadius: '15px' }}>
                                <h3>財務趨勢</h3>
                                <div style={{ width: '100%', height: 300 }}>
                                    <ResponsiveContainer>
                                        <LineChart data={chartData.lineChartData}>
                                            <CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="date" /><YAxis /><Tooltip /><Legend />
                                            <Line type="monotone" dataKey="revenue" name="營收" stroke="#8884d8" />
                                            <Line type="monotone" dataKey="cost" name="支出" stroke="#ff8042" />
                                            <Line type="monotone" dataKey="profit" name="淨利" stroke="#82ca9d" />
                                        </LineChart>
                                    </ResponsiveContainer>
                                </div>
                            </div>

                            {/* 分類圓餅圖 */}
                            <div className="chart-card" style={{ background: 'white', padding: '20px', borderRadius: '15px' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                    <h3>類別佔比</h3>
                                    <select value={categoryChartMode} onChange={e => setCategoryChartMode(e.target.value)}>
                                        <option value="main">主分類</option>
                                        <option value="sub">子分類</option>
                                    </select>
                                </div>
                                <div style={{ width: '100%', height: 300 }}>
                                    <ResponsiveContainer>
                                        <PieChart>
                                            <Pie data={chartData.categoryPieData} cx="50%" cy="50%" outerRadius={80} fill="#8884d8" dataKey="value" nameKey="name" label>
                                                {chartData.categoryPieData.map((entry, index) => <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />)}
                                            </Pie>
                                            <Tooltip /><Legend />
                                        </PieChart>
                                    </ResponsiveContainer>
                                </div>
                            </div>

                            {/* 訂單類型圓餅圖 (補回) */}
                            <div className="chart-card" style={{ background: 'white', padding: '20px', borderRadius: '15px' }}>
                                <h3>訂單類型</h3>
                                <div style={{ width: '100%', height: 300 }}>
                                    <ResponsiveContainer>
                                        <PieChart>
                                            <Pie data={chartData.typePieData} cx="50%" cy="50%" outerRadius={80} fill="#82ca9d" dataKey="value" nameKey="name" label>
                                                <Cell fill="#0088FE" /><Cell fill="#FFBB28" />
                                            </Pie>
                                            <Tooltip /><Legend />
                                        </PieChart>
                                    </ResponsiveContainer>
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {activeTab === "orders" && (
                    <div className="orders-view">
                        <header className="content-header"><h2>訂單管理</h2></header>

                        {/* 待審訂單區塊 (Pending Review) */}
                        <div className="pending-section" style={{ marginBottom: '40px', background: '#fff3e0', padding: '20px', borderRadius: '10px', border: '1px solid #ffe0b2' }}>
                            <h3 style={{ color: '#e65100', marginBottom: '15px' }}>🔔 待審訂單 ({pendingReviewOrders.length})</h3>
                            {pendingReviewOrders.length === 0 ? <p style={{ color: '#888' }}>目前沒有新進訂單。</p> : (
                                <table className="admin-table" style={{ background: 'white' }}>
                                    <thead><tr><th>下單時間</th><th>取貨日期</th><th>店家名稱</th><th>操作</th><th>狀態</th><th>明細</th></tr></thead>
                                    <tbody>
                                        {pendingReviewOrders.map(o => renderOrderRow(o, false, true))}
                                    </tbody>
                                </table>
                            )}
                            <PaginationControl curr={pendingPage} total={pagedPending.totalPages} setPage={setPendingPage} />
                        </div>

                        {/* 過期訂單區塊 (Expired) */}
                        {expiredData.length > 0 && (
                            <div className="expired-section">
                                <h3>⚠️ 過期未完成訂單</h3>
                                <table className="admin-table"><tbody>{pagedExpired.data.map(o => renderOrderRow(o))}</tbody></table>
                                <PaginationControl curr={expiredPage} total={pagedExpired.totalPages} setPage={setExpiredPage} />
                            </div>
                        )}

                        {/* 正式列表 (Active) */}
                        <div className="tabs" style={{ marginBottom: '10px' }}>
                            <button className={orderSubTab === 'today' ? 'active' : ''} onClick={() => setOrderSubTab('today')}>今日出單</button>
                            <button className={orderSubTab === 'future' ? 'active' : ''} onClick={() => setOrderSubTab('future')}>非今日出單</button>
                            <button className={orderSubTab === 'all' ? 'active' : ''} onClick={() => setOrderSubTab('all')}>訂單總覽</button>
                        </div>
                        <div className="sub-tabs" style={{ marginBottom: '20px', display: 'flex', gap: '10px' }}>
                            <button className={`filter-btn ${filterType === 'all' ? 'active-filter' : ''}`} onClick={() => setFilterType('all')}>全部類型</button>
                            <button className={`filter-btn ${filterType === 'self' ? 'active-filter' : ''}`} onClick={() => setFilterType('self')}>🏠 自取</button>
                            <button className={`filter-btn ${filterType === 'delivery' ? 'active-filter' : ''}`} onClick={() => setFilterType('delivery')}>🚚 送貨</button>

                            <div style={{ marginLeft: 'auto', display: 'flex', gap: '5px' }}>
                                <input
                                    placeholder="搜尋姓名或日期(20250101)..."
                                    value={orderSearchInput}
                                    onChange={e => setOrderSearchInput(e.target.value)}
                                    style={{ padding: '8px', borderRadius: '20px', border: '1px solid #ccc', width: '250px' }}
                                />
                                <button className="btn-detail" onClick={handleOrderSearch}>搜尋</button>
                            </div>
                        </div>
                        <div className="table-container">
                            <h4>📋 訂單列表</h4>
                            <table className="admin-table"><tbody>
                                {pagedMain.data.length > 0 ? pagedMain.data.map(o => renderOrderRow(o, o.status === 'completed')) : <tr><td colSpan="6">無訂單</td></tr>}
                            </tbody></table>
                            <PaginationControl curr={ordersPage} total={pagedMain.totalPages} setPage={setOrdersPage} />
                        </div>

                        {orderSubTab === 'all' && (
                            <div className="table-container" style={{ marginTop: '30px', borderTop: '4px solid #4caf50' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                                    <h4 style={{ color: '#2e7d32', margin: 0 }}>✅ 已完成訂單</h4>
                                    <div style={{ display: 'flex', gap: '10px' }}>
                                        <select value={completedFilterType} onChange={e => setCompletedFilterType(e.target.value)} style={{ padding: '5px' }}>
                                            <option value="all">全部</option>
                                            <option value="self">自取</option>
                                            <option value="delivery">送貨</option>
                                        </select>
                                        <input
                                            placeholder="搜尋已完成..."
                                            value={completedSearchInput}
                                            onChange={e => setCompletedSearchInput(e.target.value)}
                                            onKeyDown={e => e.key === 'Enter' && setActiveCompletedSearch(completedSearchInput)}
                                            style={{ padding: '5px' }}
                                        />
                                        <button onClick={() => setActiveCompletedSearch(completedSearchInput)} className="btn-detail">搜尋</button>
                                    </div>
                                </div>
                                <table className="admin-table"><tbody>
                                    {pagedCompleted.data.map(o => renderOrderRow(o, true))}
                                </tbody></table>
                                <PaginationControl curr={completedPage} total={pagedCompleted.totalPages} setPage={setCompletedPage} />
                            </div>
                        )}
                    </div>
                )
                }

                {
                    activeTab === "products" && (
                        <div className="product-page" style={{ paddingTop: '0px' }}>
                            <header className="content-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <h2>商品管理</h2>
                                <button className="btn-detail" onClick={handleExportAllProducts} style={{ background: '#4caf50', color: 'white' }}>匯出全商品 Excel</button>
                            </header>
                            {/* ⭐ 利潤設定區塊 */}
                            {/*<div className="profit-settings">
                            <label><strong>全域利潤比例設定：</strong></label>
                            {isEditingProfit ? (
                                <>
                                    <input type="number" step="0.1" value={profitRatio} onChange={e => setProfitRatio(e.target.value)} style={{ padding: '5px', width: '80px', borderRadius: '5px', border: '1px solid #ccc' }} />
                                    <button className="btn-detail" onClick={handleSaveProfit}>確定</button>
                                </>
                            ) : (
                                <>
                                    <span>{profitRatio} (預設)</span>
                                    <button className="btn-detail" onClick={handleEditProfit}>編輯</button>
                                </>
                            )}
                            <button className="btn-detail" onClick={handleApplyProfitToAll} style={{ background: '#e3f2fd', border: '1px solid #2196f3', color: '#2196f3' }}>套用至全商品</button>
                        </div>*/}


                            <div className="filter-section" style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                                <input
                                    placeholder="搜尋商品..."
                                    value={searchInput}
                                    onChange={e => setSearchInput(e.target.value)}
                                    onKeyDown={e => e.key === 'Enter' && handleProductSearch()}
                                    style={{ marginRight: '10px', padding: '8px', border: '1px solid #ccc', borderRadius: '5px' }}
                                />
                                <button onClick={handleProductSearch} className="filter-btn">搜尋</button>

                                <select onChange={e => { setSelectedParent(e.target.value); setSelectedChild('全部'); }}>
                                    <option value="全部">所有分類</option>
                                    {Object.keys(categoriesMap).map(c => <option key={c} value={c}>{c}</option>)}
                                </select>
                                <select value={selectedChild} onChange={(e) => setSelectedChild(e.target.value)}>
                                    <option value="全部">所有子分類</option>
                                    {selectedParent !== '全部' && categoriesMap[selectedParent]?.map(sub => (<option key={sub} value={sub}>{sub}</option>))}
                                </select>
                                <input list="brand-list" placeholder="品牌" value={selectedBrand === '全部' ? '' : selectedBrand} onChange={e => setSelectedBrand(e.target.value || '全部')} className="filter-input" />
                                <datalist id="brand-list"><option value="全部" />{brands.map(b => <option key={b} value={b} />)}</datalist>

                                <input list="saler-list" placeholder="進貨人" value={selectedSaler === '全部' ? '' : selectedSaler} onChange={e => setSelectedSaler(e.target.value || '全部')} className="filter-input" />
                                <datalist id="saler-list"><option value="全部" />{uniqueSalers.map(s => <option key={s} value={s} />)}</datalist>

                                <select value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
                                    <option value="default">預設排序</option>
                                    <option value="price_asc">價格由低到高</option>
                                    <option value="price_desc">價格由高到低</option>
                                    <option value="popularity_desc">依熱門排序</option>
                                </select>
                            </div>
                            <div className="product-grid">
                                <div className="new-bundle-card" onClick={handleCreateProduct}>
                                    <div style={{ textAlign: 'center' }}>
                                        <span style={{ fontSize: '3rem', display: 'block' }}>＋</span>
                                        <span>建立新商品</span>
                                    </div>
                                </div>
                                {currentProdData.map(group => (
                                    <div key={group.name} className="product-card">
                                        <div className="admin-product-img-wrapper">
                                            <img
                                                src={group.mainImg ? `/images/${group.mainImg}` : '/images/default.png'}
                                                alt={group.name}
                                                className="admin-product-img"
                                                loading="lazy"
                                                onError={handleImageError}
                                            />
                                        </div>
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
                    )
                }

                {
                    activeTab === "users" && (
                        <div className="users-view">
                            <header className="content-header"><h2>使用者管理</h2></header>
                            <div className="table-container">
                                <table className="admin-table">
                                    <thead>
                                        <tr>
                                            <th>店家名稱</th>
                                            <th>電話</th>
                                            <th>價格等級</th>
                                            <th>訂單數</th>
                                            <th>操作</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {users.map(u => (
                                            <>
                                                <tr key={u.uuid}>
                                                    <td>{u.store_name}</td>
                                                    <td>{u.phone}</td>
                                                    <td>{u.price_tier}</td>
                                                    <td>{u.order_count}</td>
                                                    <td>
                                                        {/* ⭐ 整合：同時保留編輯與紀錄按鈕 */}
                                                        <button className="btn-detail" onClick={() => handleEditUser(u)}>編輯</button>
                                                        <button
                                                            className="btn-detail"
                                                            style={{
                                                                background: expandedUserHistory === u.uuid ? '#666' : '#2196f3',
                                                                color: 'white'
                                                            }}
                                                            onClick={() => setExpandedUserHistory(expandedUserHistory === u.uuid ? null : u.uuid)}
                                                        >
                                                            {expandedUserHistory === u.uuid ? '收起紀錄' : `紀錄 (${u.order_count})`}
                                                        </button>
                                                    </td>
                                                </tr>

                                                {/* ⭐ 歷史紀錄展開區塊 (來自第一段程式碼) */}
                                                {expandedUserHistory === u.uuid && (
                                                    <tr>
                                                        <td colSpan="6" style={{ background: '#f1f8ff', padding: '20px' }}>
                                                            <h4 style={{ marginBottom: '10px' }}>{u.store_name} 的歷史紀錄：</h4>
                                                            <table style={{ width: '100%', fontSize: '0.9rem', background: 'white', borderRadius: '8px' }}>
                                                                <thead>
                                                                    <tr style={{ background: '#eef' }}>
                                                                        <th style={{ padding: '10px' }}>日期</th>
                                                                        <th>金額</th>
                                                                        <th>狀態</th>
                                                                        <th>明細</th>
                                                                    </tr>
                                                                </thead>
                                                                <tbody>
                                                                    {orders.filter(o => o.user_uuid === u.uuid).map(historyOrder => (
                                                                        <>
                                                                            <tr key={historyOrder.id} style={{ borderBottom: '1px solid #eee' }}>
                                                                                <td style={{ padding: '10px' }}>{historyOrder.pickupDate}</td>
                                                                                <td className="text-price">${historyOrder.total}</td>
                                                                                <td>
                                                                                    {historyOrder.status === 'completed'
                                                                                        ? <span style={{ color: 'green' }}>已完成</span>
                                                                                        : <span style={{ color: 'orange' }}>處理中</span>}
                                                                                </td>
                                                                                <td>
                                                                                    <button
                                                                                        className="btn-detail"
                                                                                        onClick={() => setExpandedHistoryOrderId(
                                                                                            expandedHistoryOrderId === historyOrder.id ? null : historyOrder.id
                                                                                        )}
                                                                                    >
                                                                                        {expandedHistoryOrderId === historyOrder.id ? '▲ 收起' : '▼ 展開'}
                                                                                    </button>
                                                                                </td>
                                                                            </tr>
                                                                            {/* 歷史訂單的詳細商品內容 */}
                                                                            {expandedHistoryOrderId === historyOrder.id && (
                                                                                <tr>
                                                                                    <td colSpan="4" style={{ padding: '10px 20px', background: '#fafafa' }}>
                                                                                        <ul style={{ margin: 0, paddingLeft: '20px', color: '#555' }}>
                                                                                            {historyOrder.products.map((p, idx) => (
                                                                                                <li key={idx}>
                                                                                                    {p.name} <span style={{ color: '#888' }}>x{p.qty} (${p.price})</span>
                                                                                                </li>
                                                                                            ))}
                                                                                        </ul>
                                                                                        {historyOrder.order_note && (
                                                                                            <div style={{ marginTop: '5px', color: '#d32f2f', fontSize: '0.85rem' }}>
                                                                                                備註: {historyOrder.order_note}
                                                                                            </div>
                                                                                        )}
                                                                                    </td>
                                                                                </tr>
                                                                            )}
                                                                        </>
                                                                    ))}
                                                                </tbody>
                                                            </table>
                                                        </td>
                                                    </tr>
                                                )}
                                            </>
                                        ))}
                                    </tbody>
                                </table>
                            </div>

                            {/* ⭐ 使用者編輯 Modal (來自第二段程式碼) */}
                            {editingUser && (
                                <div className="modal-overlay">
                                    <div className="modal-content">
                                        <h3>編輯使用者</h3>
                                        <div className="input-group">
                                            <label>店家名稱</label>
                                            <input value={editingUser.store_name} onChange={e => setEditingUser({ ...editingUser, store_name: e.target.value })} />
                                        </div>
                                        <div className="input-group">
                                            <label>電話</label>
                                            <input value={editingUser.phone} onChange={e => setEditingUser({ ...editingUser, phone: e.target.value })} />
                                        </div>
                                        <div className="input-group">
                                            <label>價格等級 (A/B)</label>
                                            <input value={editingUser.price_tier} onChange={e => setEditingUser({ ...editingUser, price_tier: e.target.value })} />
                                        </div>
                                        <div className="modal-btns">
                                            <button className="cancel-btn" onClick={() => setEditingUser(null)}>取消</button>
                                            <button className="confirm-btn" onClick={saveUserChanges}>儲存</button>
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>
                    )
                }
                {/* ⭐ 套組管理 (優化版) */}
                {
                    activeTab === "bundles" && (
                        <div className="bundles-view">
                            <header className="content-header"><h2>套組管理</h2></header>
                            <div className="product-grid">
                                <div className="new-bundle-card" onClick={openCreateBundle}>
                                    <div style={{ textAlign: 'center' }}><span style={{ fontSize: '3rem', display: 'block' }}>＋</span><span>建立新套組</span></div>
                                </div>
                                {bundles.map(b => (
                                    <div key={b.id} className="bundle-card" style={{ height: 'auto', cursor: 'pointer', background: 'white' }} onClick={() => openEditBundle(b)}>
                                        <div style={{ height: '120px', overflow: 'hidden' }}><img src={b.image && b.image.startsWith('http') ? b.image : `/images/${b.image}`} style={{ width: '100%', height: '100%', objectFit: 'cover' }} onError={handleImageError} /></div>
                                        <div style={{ padding: '10px' }}>
                                            <h4>{b.title}</h4>
                                            <p style={{ fontSize: '0.9rem', color: '#666' }}>{b.filter_type === 'manual' ? `手動 (${b.product_ids ? b.product_ids.split(',').length : 0}項)` : `條件: ${b.filter_value}`}</p>
                                            <button className="btn-delete" style={{ width: '100%', marginTop: '10px' }} onClick={(e) => handleDeleteBundle(e, b.id)}>刪除</button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )
                }

                {/*  套組編輯 Modal (第一層) */}
                {
                    isBundleModalOpen && (
                        <div className="modal-overlay">
                            <div className="modal-content" style={{ maxWidth: '700px' }}>
                                <h3>{editingBundleId ? '編輯套組' : '建立新套組'}</h3>
                                <div style={{ display: 'flex', gap: '15px', marginBottom: '15px' }}>
                                    <div style={{ flex: 1 }}><label>名稱</label><input value={newBundle.title} onChange={e => setNewBundle({ ...newBundle, title: e.target.value })} style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid rgb(204, 204, 204)' }} placeholder="例如：早餐組合" /></div>
                                    <div style={{ flex: 1 }}>
                                        <label>圖片</label>
                                        <div style={{ display: 'flex', gap: '5px' }}>
                                            <input
                                                value={newBundle.image}
                                                onChange={e => setNewBundle({ ...newBundle, image: e.target.value })}
                                                style={{ flex: 1, padding: '8px', borderRadius: '4px', border: '1px solid rgb(204, 204, 204)' }}
                                                placeholder="輸入檔名或上傳"
                                            />
                                            {/* ⭐ 新增套組上傳按鈕 */}
                                            <label className="btn-detail" style={{ cursor: 'pointer', background: '#e0e0e0', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 10px', borderRadius: '4px', whiteSpace: 'nowrap' }}>
                                                上傳
                                                <input
                                                    type="file"
                                                    style={{ display: 'none' }}
                                                    accept="image/*"
                                                    onChange={(e) => handleFileUpload(e, setNewBundle, newBundle)}
                                                />
                                            </label>
                                        </div>
                                    </div>
                                </div>
                                <div style={{ marginBottom: '15px' }}>
                                    <label style={{ marginRight: '10px' }}>模式：</label>
                                    <label style={{ marginRight: '15px' }}><input type="radio" checked={newBundle.filterType === 'manual'} onChange={() => setNewBundle({ ...newBundle, filterType: 'manual' })} /> 手動選品</label>
                                    <label style={{ marginRight: '15px' }}><input type="radio" checked={newBundle.filterType === 'category'} onChange={() => setNewBundle({ ...newBundle, filterType: 'category' })} /> 依分類</label>
                                    <label><input type="radio" checked={newBundle.filterType === 'search'} onChange={() => setNewBundle({ ...newBundle, filterType: 'search' })} /> 依關鍵字</label>
                                </div>

                                {newBundle.filterType === 'manual' ? (
                                    <div>
                                        <div style={{ display: 'flex', gap: '10px', marginBottom: '10px', flexWrap: 'wrap' }}>
                                            <input
                                                placeholder="搜尋商品..."
                                                value={bundleProductSearch}
                                                onChange={e => setBundleProductSearch(e.target.value)}
                                                style={{ flex: 1, padding: '8px', borderRadius: '4px', border: '1px solid #ccc', minWidth: '120px' }}
                                            />

                                            {/* 主分類 */}
                                            <select
                                                value={manualSelectCategory}
                                                onChange={e => {
                                                    setManualSelectCategory(e.target.value);
                                                    setManualSelectSubCategory('全部'); // 切換主分類時，重置子分類
                                                }}
                                                style={{ padding: '8px', borderRadius: '4px', border: '1px solid #ccc' }}
                                            >
                                                <option value="全部">全部分類</option>
                                                {Object.keys(categoriesMap).map(c => <option key={c} value={c}>{c}</option>)}
                                            </select>

                                            {/* 子分類 (修正：依賴 manualSelectCategory) */}
                                            <select
                                                value={manualSelectSubCategory}
                                                onChange={(e) => setManualSelectSubCategory(e.target.value)}
                                                style={{ padding: '8px', borderRadius: '4px', border: '1px solid #ccc' }}
                                            >
                                                <option value="全部">所有子分類</option>
                                                {manualSelectCategory !== '全部' && categoriesMap[manualSelectCategory]?.map(sub => (
                                                    <option key={sub} value={sub}>{sub}</option>
                                                ))}
                                            </select>

                                            {/* 品牌 */}
                                            <select
                                                value={manualSelectBrand}
                                                onChange={(e) => setManualSelectBrand(e.target.value)}
                                                style={{ padding: '8px', borderRadius: '4px', border: '1px solid #ccc' }}
                                            >
                                                <option value="全部">所有品牌</option>
                                                {brands.map(b => (<option key={b} value={b}>{b}</option>))}
                                            </select>

                                            {/* 只顯示已選 (這也是您之前提到的需求) */}
                                            <label style={{ display: 'flex', alignItems: 'center', fontSize: '0.9rem', cursor: 'pointer' }}>
                                                <input
                                                    type="checkbox"
                                                    checked={manualShowSelected}
                                                    onChange={e => setManualShowSelected(e.target.checked)}
                                                    style={{ marginRight: '5px' }}
                                                />
                                                只顯已選
                                            </label>
                                        </div>
                                        <div className="selection-grid">
                                            {groupedProductsForSelection.map(group => (
                                                <div key={group.name} className={`selection-card ${group.isSelected ? 'selected' : ''}`} onClick={() => handleGroupClick(group)}>
                                                    <img src={group.mainImg ? (group.mainImg.startsWith('http') ? group.mainImg : `/images/${group.mainImg}`) : '/images/default.png'} className="selection-img" onError={handleImageError} />
                                                    <div className="selection-info"><h5>{group.name}</h5><p>{group.items.length} 規格</p></div>
                                                </div>
                                            ))}
                                        </div>
                                        <p style={{ textAlign: 'right', marginTop: '5px', color: 'var(--primary)' }}>已選 {newBundle.productIds.length} 個規格</p>
                                    </div>
                                ) : (
                                    <div><label>篩選條件</label><input value={newBundle.filterValue} onChange={e => setNewBundle({ ...newBundle, filterValue: e.target.value })} style={{ width: '100%', padding: '8px' }} /></div>
                                )}
                                <div className="modal-btns" style={{ marginTop: '20px' }}>
                                    <button className="cancel-btn" onClick={() => setIsBundleModalOpen(false)}>取消</button>
                                    <button className="save-btn" onClick={handleSaveBundle}>儲存</button>
                                </div>
                            </div>
                        </div>
                    )
                }

                {/* ⭐ 第二層 Modal: 選擇規格 */}
                {
                    isVariantModalOpen && selectingProductGroup && (
                        <div className="modal-overlay second-level" onClick={() => setIsVariantModalOpen(false)}>
                            <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: '400px' }}>
                                <h3>選擇 {selectingProductGroup.name} 的規格</h3>
                                <div className="product-select-list" style={{ maxHeight: '300px' }}>
                                    {selectingProductGroup.items.map(variant => (
                                        <div key={variant.id} className="product-select-item" onClick={() => toggleVariantInBundle(variant.id)} style={{ cursor: 'pointer' }}>
                                            <input type="checkbox" checked={newBundle.productIds.includes(variant.id)} readOnly style={{ marginRight: '10px' }} />
                                            <div style={{ flex: 1 }}><span style={{ fontWeight: 'bold' }}>{variant.spec}</span><span style={{ color: '#e53935', float: 'right' }}>${variant.price_A}</span></div>
                                        </div>
                                    ))}
                                </div>
                                <button className="change-btn" onClick={() => setIsVariantModalOpen(false)}>完成</button>
                            </div>
                        </div>
                    )
                }

                {/* ⭐ 商品編輯 Modal (擴充欄位) */}
                {
                    isEditModalOpen && editingVariant && (
                        <div className="modal-overlay">
                            <div className="modal-content" style={{ maxWidth: '800px' }}>
                                <button className="delete-product-btn" onClick={handleDeleteProduct}>
                                    🗑 刪除商品
                                </button>
                                <h3>修改商品</h3>
                                <div className="specs-list" style={{ marginBottom: '15px', display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                                    {editingGroup.map(item => (
                                        <div key={item.id} className="variant-btn-container">
                                            <button
                                                className={`filter-btn ${editingVariant.id === item.id ? 'active-filter' : ''}`}
                                                onClick={() => setEditingVariant({ ...item })}
                                                style={{ minWidth: '60px' }}
                                            >
                                                {item.flavor ? `${item.flavor} - ` : ''}{item.spec}
                                            </button>
                                            {/* ⭐ 懸浮顯示的刪除叉叉 */}
                                            <span
                                                className="delete-variant-x"
                                                onClick={(e) => handleDeleteVariant(e, item.id)}
                                                title="刪除此規格"
                                            >
                                                ✕
                                            </span>
                                        </div>
                                    ))}
                                    {/* 預留新增按鈕功能 */}
                                    <button
                                        className="filter-btn"
                                        style={{ borderStyle: 'dashed', color: '#888' }}
                                        onClick={handleAddNewVariant}
                                    >
                                        + 新增規格
                                    </button>
                                </div>
                                <div className="edit-grid-form">
                                    <div className="full-width" style={{ textAlign: 'center' }}>
                                        <img src={editingVariant.image ? `/images/${editingVariant.image}` : '/images/default.png'} className="admin-product-img-preview" />
                                    </div>

                                    <div className="input-group">
                                        <label>圖片</label>
                                        <div style={{ display: 'flex', gap: '5px' }}>
                                            <input
                                                value={editingVariant.image || ''}
                                                onChange={e => setEditingVariant({ ...editingVariant, image: e.target.value })}
                                                placeholder="手動輸入或上傳"
                                                style={{ flex: 1 }}
                                            />
                                            <label className="btn-detail" style={{ cursor: 'pointer', background: '#e0e0e0', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 10px', borderRadius: '4px' }}>
                                                上傳
                                                <input
                                                    type="file"
                                                    style={{ display: 'none' }}
                                                    accept="image/*"
                                                    onChange={(e) => handleFileUpload(e, setEditingVariant, editingVariant)}
                                                />
                                            </label>
                                        </div>
                                    </div>

                                    <div className="input-group"><label>圖片檔名</label><input value={editingVariant.image || ''} onChange={e => setEditingVariant({ ...editingVariant, image: e.target.value })} /></div>
                                    <div className="input-group" style={{ background: '#e3f2fd', padding: '10px', borderRadius: '8px' }} ><label>品名</label><input value={editingVariant.name} onChange={e => setEditingVariant({ ...editingVariant, name: e.target.value })} /></div>
                                    <div className="input-group"><label>別名 (Alias)</label><input value={editingVariant.alias || ''} onChange={e => setEditingVariant({ ...editingVariant, alias: e.target.value })} /></div>
                                    <div className="input-group"><label>品牌</label><input value={editingVariant.brand || ''} onChange={e => setEditingVariant({ ...editingVariant, brand: e.target.value })} /></div>
                                    <div className="input-group" style={{ background: '#e3f2fd', padding: '10px', borderRadius: '8px' }}><label>供應商</label><input value={editingVariant.saler || ''} onChange={e => setEditingVariant({ ...editingVariant, saler: e.target.value })} /></div>
                                    <div className="input-group" style={{ background: '#e3f2fd', padding: '10px', borderRadius: '8px' }}><label>主分類</label><input value={editingVariant.main_category || ''} onChange={e => setEditingVariant({ ...editingVariant, main_category: e.target.value })} /></div>
                                    <div className="input-group" style={{ background: '#e3f2fd', padding: '10px', borderRadius: '8px' }}><label>子分類</label><input value={editingVariant.sub_category || ''} onChange={e => setEditingVariant({ ...editingVariant, sub_category: e.target.value })} /></div>
                                    <div className="input-group"><label>口味</label><input value={editingVariant.flavor || ''} onChange={e => setEditingVariant({ ...editingVariant, flavor: e.target.value })} /></div>
                                    <div className="input-group" style={{ background: '#e3f2fd', padding: '10px', borderRadius: '8px' }}><label>規格</label><input value={editingVariant.spec} onChange={e => setEditingVariant({ ...editingVariant, spec: e.target.value })} /></div>
                                    <div className="input-group" style={{ background: '#e3f2fd', padding: '10px', borderRadius: '8px' }}><label>單位</label><input value={editingVariant.unit || ''} onChange={e => setEditingVariant({ ...editingVariant, unit: e.target.value })} /></div>

                                    {/* 價格與利潤區塊 */}
                                    <div className="input-group" style={{ background: '#e3f2fd', padding: '10px', borderRadius: '8px' }}>
                                        <label>進貨成本 (Standard Cost)</label>
                                        <input type="number" value={editingVariant.standard_cost || 0} onChange={e => handleCostChange(e.target.value)} />
                                    </div>
                                    <div className="input-group">
                                        <label>建議售價 (Rec. Price)</label>
                                        <input type="number" value={editingVariant.rec_price || 0} onChange={e => setEditingVariant({ ...editingVariant, rec_price: e.target.value })} />
                                    </div>
                                    <div className="input-group" style={{ background: '#e3f2fd', padding: '10px', borderRadius: '8px' }}><label>售價 A (Price A)</label><input type="number" value={editingVariant.price_A} onChange={e => setEditingVariant({ ...editingVariant, price_A: e.target.value })} /></div>
                                    <div className="input-group"><label>售價 B (Price B)</label><input type="number" value={editingVariant.price_B || 0} onChange={e => setEditingVariant({ ...editingVariant, price_B: e.target.value })} /></div>
                                    <div className="input-group" style={{ background: '#e8f5e9', padding: '10px', borderRadius: '8px' }}>
                                        <label>固定利潤 (Profit)</label>
                                        <input type="number" value={editingVariant.profit || 0} onChange={e => handleProfitChange(e.target.value)} />
                                    </div>
                                </div>
                                {/*<button className="change-btn" style={{ marginBottom: '10px', background: '#2196f3' }} onClick={applyProfitSettings}>套用利潤公式 (Price A = Cost x {profitRatio})</button>*/}
                                <div className="modal-btns">
                                    <button className="cancel-btn" onClick={() => setIsEditModalOpen(false)}>關閉</button>
                                    <button className="confirm-btn" onClick={saveProductChanges}>儲存</button>
                                </div>
                            </div>
                        </div>
                    )
                }

                {
                    isPrintPreviewOpen && previewOrder && (
                        <div className="modal-overlay">
                            <div className="modal-content print-modal-content" style={{ maxWidth: '800px', width: '95%' }}>
                                <div className="no-print" style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '10px' }}>
                                    <h3>訂單預覽</h3>
                                    <button onClick={() => setIsPrintPreviewOpen(false)} style={{ fontSize: '1.5rem', background: 'none', border: 'none', cursor: 'pointer' }}>×</button>
                                </div>

                                {/* 預覽區塊 (這塊會被印出來) */}
                                <div className="print-preview-box" style={{ fontFamily: 'Arial, sans-serif' }}>
                                    <h2 style={{ textAlign: 'center', borderBottom: '2px solid #333', paddingBottom: '10px' }}>訂單明細</h2>
                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '20px' }}>
                                        <div><strong>訂單編號：</strong> {previewOrder.id}</div>
                                        <div><strong>店家名稱：</strong> {previewOrder.storeName}</div>
                                        <div><strong>取貨方式：</strong> {previewOrder.pickupType === 'delivery' ? '外送' : '自取'}</div>
                                        <div><strong>取貨日期：</strong> {previewOrder.pickupDate} {previewOrder.pickupTime}</div>
                                        {previewOrder.pickupType === 'delivery' && <div style={{ gridColumn: '1/-1' }}><strong>地址：</strong> {users.find(u => u.uuid === previewOrder.user_uuid)?.address}</div>}
                                        <div style={{ gridColumn: '1/-1' }}><strong>備註：</strong> {previewOrder.order_note}</div>
                                    </div>

                                    <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: '10px' }}>
                                        <thead>
                                            <tr style={{ borderBottom: '2px solid #333' }}>
                                                <th style={{ textAlign: 'left', padding: '8px' }}>商品</th>
                                                <th style={{ textAlign: 'center', padding: '8px' }}>規格</th>
                                                <th style={{ textAlign: 'center', padding: '8px' }}>數量</th>
                                                <th style={{ textAlign: 'right', padding: '8px' }}>單價</th>
                                                <th style={{ textAlign: 'right', padding: '8px' }}>小計</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {previewOrder.products.map((p, idx) => (
                                                <tr key={idx} style={{ borderBottom: '1px solid #eee' }}>
                                                    <td style={{ padding: '8px' }}>{p.name} <span style={{ fontSize: '0.8em', color: '#666' }}>{p.note ? `(${p.note})` : ''}</span></td>
                                                    <td style={{ textAlign: 'center', padding: '8px' }}>{p.spec}</td>
                                                    <td style={{ textAlign: 'center', padding: '8px' }}>x{p.qty}</td>
                                                    <td style={{ textAlign: 'right', padding: '8px' }}>${p.price}</td>
                                                    <td style={{ textAlign: 'right', padding: '8px' }}>${p.price * p.qty}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                        <tfoot>
                                            <tr>
                                                <td colSpan="4" style={{ textAlign: 'right', padding: '15px 8px', fontWeight: 'bold' }}>總金額：</td>
                                                <td style={{ textAlign: 'right', padding: '15px 8px', fontWeight: 'bold', fontSize: '1.2em' }}>${previewOrder.total}</td>
                                            </tr>
                                        </tfoot>
                                    </table>
                                </div>

                                <div className="modal-btns no-print" style={{ marginTop: '20px' }}>
                                    <button className="change-btn" onClick={handleBrowserPrint} style={{ background: '#2196f3' }}>🖨 直接列印</button>
                                    <button className="change-btn" onClick={handleDownloadOrderExcel} style={{ background: '#4caf50' }}>📥 下載 Excel</button>
                                    <button className="cancel-btn" onClick={() => setIsPrintPreviewOpen(false)}>✖</button>
                                </div>
                            </div>
                        </div>
                    )
                }
            </main >
        </div >
    );
}

export default Owner;

