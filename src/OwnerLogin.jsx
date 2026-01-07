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

    // --- ⭐ 套組管理狀態 (優化版) ---
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
        setEditingOrder({
            ...JSON.parse(JSON.stringify(order)),
            pickupDate: order.pickupDate || '',
            pickupType: order.pickupType || 'self',
            isPrinted: order.isPrinted || false
        });
    };

    const saveOrderEdit = async () => {
        if (!editingOrder) return;
        if (!window.confirm("確定儲存修改？")) return;

        const newTotal = editingOrder.products.reduce((sum, p) => sum + (Number(p.price) * Number(p.qty)), 0);

        try {
            await api.put(`/api/orders/${editingOrder.id}`, {
                items: editingOrder.products,
                total: newTotal,
                order_note: editingOrder.order_note,
                pickup_date: editingOrder.pickupDate, // ⭐ 更新日期
                pickup_type: editingOrder.pickupType, // ⭐ 更新方式
                is_printed: editingOrder.isPrinted      // ⭐ 更新列印狀態
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

    const handleCostChange = (val) => {
        if (!editingVariant) return;
        const newCost = Number(val);
        const newPriceA = Math.round(newCost * profitRatio);
        setEditingVariant({ ...editingVariant, standard_cost: newCost, price_A: newPriceA });
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
        const todayStr = moment().format('YYYY-MM-DD');
        const currentMonth = moment().format('YYYY-MM');
        let pendingCount = 0, todayCompleted = 0, monthCompleted = 0;
        const last7DaysMap = {};
        for (let i = 6; i >= 0; i--) last7DaysMap[moment().subtract(i, 'days').format('MM/DD')] = 0;
        const productSalesMap = {};
        let selfCount = 0, deliveryCount = 0;

        orders.forEach(o => {
            if (o.status === 'pending_review') return;
            const isCompleted = o.status === 'completed';
            const orderDateFull = moment(o.rawTime).format('YYYY-MM-DD');
            const orderMonth = moment(o.rawTime).format('YYYY-MM');
            const amount = Number(o.total || 0);

            if (!isCompleted) pendingCount++;
            if (isCompleted && orderDateFull === todayStr) todayCompleted++;
            if (isCompleted && orderMonth === currentMonth) monthCompleted++;

            const orderDateKey = moment(o.rawTime).format('MM/DD');
            if (last7DaysMap[orderDateKey] !== undefined) last7DaysMap[orderDateKey] += amount;

            if (o.products) o.products.forEach(p => {
                const pname = p.name;
                if (!productSalesMap[pname]) productSalesMap[pname] = 0;
                productSalesMap[pname] += Number(p.qty || 0);
            });
            if (o.pickupType === 'self') selfCount++; else deliveryCount++;
        });

        const lineChartData = Object.keys(last7DaysMap).map(date => ({ date, revenue: last7DaysMap[date] }));
        const barChartData = Object.entries(productSalesMap).map(([name, qty]) => ({ name, qty })).sort((a, b) => b.qty - a.qty).slice(0, 5);
        const pieChartData = [{ name: '自取', value: selfCount }, { name: '外送', value: deliveryCount }].filter(d => d.value > 0);

        return { stats: { pendingCount, todayCompleted, monthCompleted }, chartData: { lineChartData, barChartData, pieChartData } };
    }, [orders]);

    // --- 商品管理邏輯 ---
    const handleProductSearch = () => {
        setActiveSearch(searchInput);
        setSelectedParent('全部');
        setSelectedChild('全部');
        setSelectedBrand('全部');
        setSelectedSaler('全部');
        setProdPage(1);
    };

    const processedProductGroups = useMemo(() => {
        let filtered = rawProducts;

        if (activeSearch) {
            const fuse = new Fuse(rawProducts, {
                keys: ['name', 'brand', 'spec', 'alias'],
                threshold: 0.4,
                ignoreLocation: true,
                minMatchCharLength: 1
            });
            filtered = fuse.search(activeSearch).map(result => result.item);
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
                            isPendingReview ? '待審核' : (isCompleted ? '✅ 已完成' : (o.isPrinted ? '已列印' : '未列印'))
                        )}
                    </td>

                    {/* 操作按鈕區 */}
                    <td>
                        {!isPendingReview && !isEditing && (
                            <button className="btn-detail" onClick={() => printOrder(o.id)} title="列印工單">🖨</button>
                        )}

                        {/* 展開/收合明細 */}
                        <button className="btn-detail" onClick={() => toggleOrder(o.id)}>{expandedOrderId === o.id ? '▲' : '▼'}</button>

                        {/* 完成按鈕 (非編輯狀態才顯示) */}
                        {!isCompleted && !isPendingReview && !isEditing && (
                            <button className="btn-detail" style={{ background: '#43a047', color: 'white' }} onClick={() => completeOrder(o.id)}>完成</button>
                        )}

                        {/* ⭐ 新增：編輯/儲存 按鈕切換 */}
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
                    </td>
                </tr>

                {/* 下拉明細區塊 (保持不變，但移除重複的編輯按鈕) */}
                {expandedOrderId === o.id && (
                    <tr style={{ background: '#fafafa' }}>
                        <td colSpan="6" style={{ padding: '10px 20px' }}>
                            <div className="order-dropdown">
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                                    <h4>商品明細：</h4>
                                    <div>
                                        {!isEditing && (
                                            <button className="btn-delete" onClick={() => deleteOrder(o.id)}>🗑 刪除訂單</button>
                                        )}
                                    </div>
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
                                        預估新總價: ${displayOrder.products.reduce((sum, p) => sum + (p.price * p.qty), 0)}
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
                        <header className="content-header"><h2>DashBoard</h2></header>
                        <div className="stat-grid">
                            <div className="stat-card"><span>🚨 待處理訂單</span><strong style={{ color: '#e53935' }}>{stats.pendingCount} 筆</strong></div>
                            <div className="stat-card"><span>✅ 本日完成訂單</span><strong style={{ color: '#43a047' }}>{stats.todayCompleted} 筆</strong></div>
                            <div className="stat-card"><span>📅 本月完成訂單</span><strong>{stats.monthCompleted} 筆</strong></div>
                        </div>
                        <div className="charts-container" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(400px, 1fr))', gap: '20px', marginTop: '30px' }}>
                            <div className="chart-card" style={{ background: 'white', padding: '20px', borderRadius: '15px' }}><h3 style={{ marginBottom: '20px', color: '#555' }}>📈 近 7 日營收趨勢</h3><div style={{ width: '100%', height: 300 }}><ResponsiveContainer><LineChart data={chartData.lineChartData}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="date" /><YAxis /><Tooltip /><Line type="monotone" dataKey="revenue" stroke="#8884d8" /></LineChart></ResponsiveContainer></div></div>
                            <div className="chart-card" style={{ background: 'white', padding: '20px', borderRadius: '15px' }}><h3 style={{ marginBottom: '20px', color: '#555' }}>🏆 熱銷商品 Top 5</h3><div style={{ width: '100%', height: 300 }}><ResponsiveContainer><BarChart data={chartData.barChartData} layout="vertical"><CartesianGrid strokeDasharray="3 3" /><XAxis type="number" /><YAxis dataKey="name" type="category" width={100} /><Tooltip /><Bar dataKey="qty" fill="#82ca9d" /></BarChart></ResponsiveContainer></div></div>
                            <div className="chart-card" style={{ background: 'white', padding: '20px', borderRadius: '15px' }}><h3 style={{ marginBottom: '20px', color: '#555' }}>🛵 訂單類型分佈</h3><div style={{ width: '100%', height: 300 }}><ResponsiveContainer><PieChart><Pie data={chartData.pieChartData} cx="50%" cy="50%" innerRadius={60} outerRadius={100} fill="#8884d8" dataKey="value" label>{chartData.pieChartData.map((entry, index) => (<Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />))}</Pie><Tooltip /><Legend /></PieChart></ResponsiveContainer></div></div>
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
                        </div>

                        {expiredOrders.length > 0 && (
                            <div className="expired-section">
                                <h3>⚠️ 過期未完成訂單 ({expiredOrders.length})</h3>
                                <table className="admin-table"><tbody>{expiredOrders.map(o => renderOrderRow(o))}</tbody></table>
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
                        </div>

                        <div className="table-container">
                            <h4 style={{ padding: '10px', color: '#333' }}>📋 待處理 / 進行中</h4>
                            <table className="admin-table">
                                <thead><tr><th>下單時間</th><th>取貨日期</th><th>店家名稱</th><th>金額</th><th>狀態</th><th>操作</th></tr></thead>
                                <tbody>
                                    {activeOrders.length > 0 ? activeOrders.map(o => renderOrderRow(o, false)) : <tr><td colSpan="6" style={{ textAlign: 'center' }}>無訂單</td></tr>}
                                </tbody>
                            </table>
                        </div>

                        {/* 已完成訂單區塊 */}
                        {completedOrders.length > 0 && (
                            <div className="table-container" style={{ marginTop: '30px', opacity: 0.8 }}>
                                <h4 style={{ padding: '10px', color: '#666' }}>✅ 已完成訂單</h4>
                                <table className="admin-table">
                                    <thead><tr><th>下單時間</th><th>取貨日期</th><th>店家名稱</th><th>金額</th><th>狀態</th><th>操作</th></tr></thead>
                                    <tbody>
                                        {completedOrders.map(o => renderOrderRow(o, true))}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </div>
                )}

                {activeTab === "products" && (
                    <div className="product-page" style={{ paddingTop: '0px' }}>
                        <header className="content-header"><h2>商品管理</h2></header>
                        {/* ⭐ 利潤設定區塊 */}
                        <div className="profit-settings">
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
                        </div>


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
                            <select value={selectedBrand} onChange={(e) => setSelectedBrand(e.target.value)}>
                                <option value="全部">所有品牌</option>
                                {brands.map(b => (<option key={b} value={b}>{b}</option>))}
                            </select>
                            <select value={selectedSaler} onChange={(e) => setSelectedSaler(e.target.value)}>
                                <option value="全部">所有進貨人</option>
                                {uniqueSalers.map(s => (<option key={s} value={s}>{s}</option>))}
                            </select>

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
                )}
                {/* ⭐ 套組管理 (優化版) */}
                {activeTab === "bundles" && (
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
                )}

                {/*  套組編輯 Modal (第一層) */}
                {isBundleModalOpen && (
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
                )}

                {/* ⭐ 第二層 Modal: 選擇規格 */}
                {isVariantModalOpen && selectingProductGroup && (
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
                )}

                {/* ⭐ 商品編輯 Modal (擴充欄位) */}
                {isEditModalOpen && editingVariant && (
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
                            </div>
                            <button className="change-btn" style={{ marginBottom: '10px', background: '#2196f3' }} onClick={applyProfitSettings}>套用利潤公式 (Price A = Cost x {profitRatio})</button>
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

