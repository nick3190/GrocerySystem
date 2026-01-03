import { useState, useEffect, useMemo } from 'react';
import api from './api';
import { useNavigate } from 'react-router-dom';
import './ProductList.css';

const ProductList = () => {
    const navigate = useNavigate();

    // --- 原始資料 ---
    const [rawProducts, setRawProducts] = useState([]); // 從後端抓回來的原始陣列
    const [categoriesMap, setCategoriesMap] = useState({});
    const [brands, setBrands] = useState([]);
    const [cartCount, setCartCount] = useState(0);

    // --- 篩選狀態 (保留您原本的功能) ---
    const [searchText, setSearchText] = useState('');
    const [selectedParent, setSelectedParent] = useState('全部');
    const [selectedChild, setSelectedChild] = useState('全部');
    const [selectedBrand, setSelectedBrand] = useState('全部');
    const [sortBy, setSortBy] = useState('default');

    // --- 分頁狀態 ---
    const [currentPage, setCurrentPage] = useState(1);
    const pageSize = 12; // 每頁顯示幾組商品

    // --- Modal 狀態 (新功能: 規格選擇) ---
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [selectedGroup, setSelectedGroup] = useState([]); // 選中的那一組(多規格)
    const [selectedVariant, setSelectedVariant] = useState(null); // 選中的特定規格
    const [qty, setQty] = useState(1);
    const [note, setNote] = useState('');

    // --- 初始化 ---
    useEffect(() => {
        fetchInitialData();
        fetchCartCount();
    }, []);

    const fetchInitialData = async () => {
        try {
            const [prodRes, catRes, brandRes] = await Promise.all([
                api.get('/products'),
                api.get('/api/categories'),
                api.get('/api/brands')
            ]);
            setRawProducts(prodRes.data);
            setCategoriesMap(catRes.data);
            setBrands(brandRes.data);
        } catch (err) {
            console.error("資料讀取失敗", err);
        }
    };

    const fetchCartCount = async () => {
        try {
            const res = await api.get('/cart');
            setCartCount(res.data.length);
        } catch (err) { }
    };

    // --- 核心邏輯: 整合「篩選」與「群組化」 ---
    // 使用 useMemo 優化效能，當篩選條件變更時才重新計算
    const processedGroups = useMemo(() => {
        // 1. 先進行篩選 (Filter)
        let filtered = rawProducts.filter(item => {
            // 搜尋關鍵字 (比對 品名 或 產品編號)
            if (searchText && !item.name.includes(searchText) && !String(item.id).includes(searchText)) return false;
            // 主類別
            if (selectedParent !== '全部' && item.main_category !== selectedParent) return false;
            // 子類別
            if (selectedChild !== '全部' && item.sub_category !== selectedChild) return false;
            // 品牌
            if (selectedBrand !== '全部' && item.brand !== selectedBrand) return false;
            return true;
        });

        // 2. 進行排序 (Sort)
        if (sortBy === 'price_asc') filtered.sort((a, b) => a.price_A - b.price_A);
        if (sortBy === 'price_desc') filtered.sort((a, b) => b.price_A - a.price_A);
        // 若有其他排序邏輯可在此加入

        // 3. 進行群組化 (Grouping)
        // 將篩選後的商品，依照「品名」歸類
        const groups = {};
        filtered.forEach(item => {
            const name = item.name;
            if (!groups[name]) groups[name] = [];
            groups[name].push(item);
        });

        // 轉回陣列以便渲染
        // 格式: [{ name: "沙茶醬", items: [...], minPrice: 100, brand: "牛頭牌" }, ...]
        return Object.keys(groups).map(name => {
            const items = groups[name];
            // 找出最低價作為代表價格
            const minPrice = Math.min(...items.map(i => Number(i.price_A) || 0));
            return {
                name,
                items, // 這一組裡面的所有規格
                brand: items[0].brand, // 取第一個的品牌當代表
                minPrice,
                mainImg: items[0].main_category // 用來決定圖片或樣式(若有的話)
            };
        });

    }, [rawProducts, searchText, selectedParent, selectedChild, selectedBrand, sortBy]);

    // --- 分頁邏輯 ---
    const totalPages = Math.ceil(processedGroups.length / pageSize);
    const currentData = processedGroups.slice(
        (currentPage - 1) * pageSize,
        currentPage * pageSize
    );

    // 當篩選條件改變時，回到第一頁
    useEffect(() => {
        setCurrentPage(1);
    }, [searchText, selectedParent, selectedChild, selectedBrand]);


    // --- 互動處理 ---

    // 點擊卡片 (打開 Modal)
    const handleCardClick = (group) => {
        setSelectedGroup(group.items);
        setSelectedVariant(group.items[0]); // 預設選第一個
        setQty(1);
        setNote('');
        setIsModalOpen(true);
    };

    // 確認加入購物車
    const confirmAddToCart = async () => {
        if (!selectedVariant) return;
        try {
            await api.post('/cart', {
                productId: selectedVariant.id,
                quantity: qty,
                note: note
            });
            setIsModalOpen(false);
            fetchCartCount(); // 更新購物車數字
            // alert("已加入購物車"); // 可選：提示使用者
        } catch (err) {
            alert("加入失敗，請稍後再試");
        }
    };

    return (
        <div className="product-page">
            {/* --- 頂部固定區 (保留您的排版) --- */}
            <header className="sticky-header">
                <div className="top-banner">
                    <h2>商品列表</h2>
                    <div className="search-wrapper">
                        <input
                            type="text"
                            placeholder="搜尋商品名稱或編號..."
                            value={searchText}
                            onChange={(e) => setSearchText(e.target.value)}
                            className="search-input"
                        />
                        {searchText && <button onClick={() => setSearchText('')} className="clear-btn">X</button>}
                    </div>
                    {/* 購物車懸浮球整合在 Header 或維持懸浮皆可，這裡保留 Header 內的入口 */}
                    <div className="cart-icon-header" onClick={() => navigate('/historyPage')}>
                        歷史訂單 
                    </div>
                </div>

                {/* --- 篩選區 (Filter Section) --- */}
                <div className="filter-section">
                    <select value={selectedParent} onChange={(e) => { setSelectedParent(e.target.value); setSelectedChild('全部'); }}>
                        <option value="全部">所有分類</option>
                        {Object.keys(categoriesMap).map(cat => (
                            <option key={cat} value={cat}>{cat}</option>
                        ))}
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
            </header>

            {/* --- 商品網格 (Product Grid) --- */}
            <div className="product-grid">
                {currentData.length > 0 ? (
                    currentData.map((group) => (
                        <div key={group.name} className="product-card" onClick={() => handleCardClick(group)}>
                            <div className="card-body">
                                <h3 className="product-name">{group.name}</h3>
                                <div className="product-meta">
                                    <span className="brand-tag">{group.brand || '無品牌'}</span>
                                    {/* 顯示有多少種規格 */}
                                    <span className="spec-count-badge">{group.items.length} 種規格</span>
                                </div>
                                <div className="price-row">
                                    <span className="price-label">參考價</span>
                                    <span className="price-val">${group.minPrice} 起</span>
                                </div>
                            </div>
                            <button className="add-btn">選擇規格</button>
                        </div>
                    ))
                ) : (
                    <div className="no-result">沒有找到符合條件的商品</div>
                )}
            </div>

            {/* --- 分頁控制 (Pagination) --- */}
            {totalPages > 1 && (
                <div className="pagination">
                    <button onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={currentPage === 1}>上一頁</button>
                    <span>{currentPage} / {totalPages}</span>
                    <button onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))} disabled={currentPage === totalPages}>下一頁</button>
                </div>
            )}

            {/* --- 購物車懸浮按鈕 (保留您的風格) --- */}
            <div className="cart-wrapper" onClick={() => navigate('/shopcart')}>
                <div className="cart-float">🛒</div>
                {cartCount > 0 && <span className="cart-count">{cartCount}</span>}
            </div>

            {/* --- 新功能: 規格選擇 Modal --- */}
            {isModalOpen && selectedVariant && (
                <div className="modal-overlay" onClick={() => setIsModalOpen(false)}>
                    <div className="modal-content" onClick={e => e.stopPropagation()}>
                        <h3 className="modal-title">{selectedGroup[0].name}</h3>
                        <p className="modal-subtitle">品牌: {selectedGroup[0].brand}</p>

                        <div className="specs-section">
                            <h4>請選擇規格：</h4>
                            <div className="specs-list">
                                {selectedGroup.map(item => (
                                    <button
                                        key={item.id}
                                        className={`spec-btn ${selectedVariant.id === item.id ? 'active' : ''}`}
                                        onClick={() => setSelectedVariant(item)}
                                    >
                                        <span className="spec-text">{item.spec}</span>
                                        <span className="spec-unit">/ {item.unit}</span>
                                        {/* 這裡顯示價格A僅供參考，實際後端會重算 */}
                                        <span className="spec-price">${item.price_A}</span>
                                    </button>
                                ))}
                            </div>
                        </div>

                        <div className="qty-control-area">
                            <div className="qty-control">
                                <button onClick={() => setQty(Math.max(1, qty - 1))}>-</button>
                                <span className="qty-display">{qty}</span>
                                <button onClick={() => setQty(qty + 1)}>+</button>
                            </div>
                            <div className="total-preview">
                                小計: ${Number(selectedVariant.price_A) * qty}
                            </div>
                        </div>

                        <textarea
                            className="note-input"
                            placeholder="備註 (例如：不要太碎、要分裝...)"
                            value={note}
                            onChange={(e) => setNote(e.target.value)}
                        />

                        <div className="modal-btns">
                            <button className="cancel-btn" onClick={() => setIsModalOpen(false)}>取消</button>
                            <button className="confirm-btn" onClick={confirmAddToCart}>加入購物車</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default ProductList;