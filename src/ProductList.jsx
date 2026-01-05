import { useState, useEffect, useMemo } from 'react';
import api from './api';
import { useNavigate } from 'react-router-dom';
import Fuse from 'fuse.js'; 
import './ProductList.css';

const ProductList = () => {
    const navigate = useNavigate();

    // --- 原始資料 ---
    const [rawProducts, setRawProducts] = useState([]);
    const [categoriesMap, setCategoriesMap] = useState({});
    const [brands, setBrands] = useState([]);
    const [cartCount, setCartCount] = useState(0);
    
    // ⭐ 新增：套組資料
    const [bundles, setBundles] = useState([]);
    const [activeBundle, setActiveBundle] = useState(null); // 目前選中的套組

    // --- 篩選狀態 ---
    const [searchInput, setSearchInput] = useState(''); 
    const [activeSearch, setActiveSearch] = useState('');
    
    const [selectedParent, setSelectedParent] = useState('全部');
    const [selectedChild, setSelectedChild] = useState('全部');
    const [selectedBrand, setSelectedBrand] = useState('全部');
    const [sortBy, setSortBy] = useState('default');

    // --- 分頁狀態 ---
    const [currentPage, setCurrentPage] = useState(1);
    const pageSize = 12;

    // --- Modal 狀態 ---
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [selectedGroup, setSelectedGroup] = useState([]);
    const [selectedVariant, setSelectedVariant] = useState(null);
    const [qty, setQty] = useState(1);
    const [note, setNote] = useState('');

    useEffect(() => {
        fetchInitialData();
        fetchCartCount();
        fetchBundles(); // 載入套組
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
        } catch (err) { }
    };

    const fetchBundles = async () => {
        try {
            const res = await api.get('/api/bundles');
            setBundles(res.data);
        } catch (err) { console.error(err); }
    };

    const fetchCartCount = async () => {
        try {
            const res = await api.get('/cart');
            setCartCount(res.data.length);
        } catch (err) { }
    };

    const handleSearch = () => {
        setActiveSearch(searchInput);
        setSelectedParent('全部');
        setSelectedChild('全部');
        setSelectedBrand('全部');
        setActiveBundle(null); // 搜尋時退出套組模式
        setCurrentPage(1);
    };

    const clearSearch = () => {
        setSearchInput('');
        setActiveSearch('');
        setCurrentPage(1);
    };

    // --- 套組操作 ---
    const handleViewBundle = (bundle) => {
        setActiveBundle(bundle);
        setActiveSearch(''); // 清空搜尋
        setSelectedParent('全部');
        // 頁面滾動到最上方
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    const handleExitBundle = () => {
        setActiveBundle(null);
    };

    // ⭐ 全部加入購物車 (批次)
    const handleAddAllToCart = async (bundleProducts) => {
        if (!window.confirm(`確定將 ${bundleProducts.length} 項商品全部加入購物車？`)) return;

        // 整理 payload：自動選取每個群組的第一個規格
        const itemsToAdd = bundleProducts.map(group => ({
            productId: group.items[0].id, // 預設拿第一個規格
            quantity: 1,
            note: '套組快速加入'
        }));

        try {
            await api.post('/cart/batch', { items: itemsToAdd });
            alert("已全部加入購物車！");
            fetchCartCount();
        } catch (e) {
            alert("部分商品加入失敗");
        }
    };

    // --- 核心邏輯 ---
    const processedGroups = useMemo(() => {
        let filtered = rawProducts;

        // ⭐ 1. 套組過濾優先
        if (activeBundle) {
            // 依據套組設定過濾 (目前支援 category 或 search 關鍵字)
            if (activeBundle.filter_type === 'category') {
                filtered = filtered.filter(p => p.main_category === activeBundle.filter_value);
            } else if (activeBundle.filter_type === 'search') {
                // 使用 Fuse 進行關鍵字匹配
                const fuse = new Fuse(rawProducts, { keys: ['name', 'alias'], threshold: 0.3 });
                filtered = fuse.search(activeBundle.filter_value).map(r => r.item);
            }
        } 
        // 2. 若無套組，則走一般搜尋邏輯
        else if (activeSearch) {
            const fuse = new Fuse(rawProducts, {
                keys: ['name', 'brand', 'spec', 'alias'], 
                threshold: 0.4, 
                ignoreLocation: true,
                minMatchCharLength: 1
            });
            filtered = fuse.search(activeSearch).map(result => result.item);
        }

        // 3. 分類篩選 (套組模式下通常不使用，但保留邏輯無妨)
        filtered = filtered.filter(item => {
            if (selectedParent !== '全部' && item.main_category !== selectedParent) return false;
            if (selectedChild !== '全部' && item.sub_category !== selectedChild) return false;
            if (selectedBrand !== '全部' && item.brand !== selectedBrand) return false;
            return true;
        });

        if (sortBy === 'price_asc') filtered.sort((a, b) => a.price_A - b.price_A);
        if (sortBy === 'price_desc') filtered.sort((a, b) => b.price_A - a.price_A);

        const groups = {};
        filtered.forEach(item => {
            const name = item.name;
            if (!groups[name]) groups[name] = [];
            groups[name].push(item);
        });

        return Object.keys(groups).map(name => {
            const items = groups[name];
            const minPrice = Math.min(...items.map(i => Number(i.price_A) || 0));
            const mainImg = items[0].image || null;
            return { name, items, brand: items[0].brand, minPrice, mainImg };
        });

    }, [rawProducts, activeSearch, selectedParent, selectedChild, selectedBrand, sortBy, activeBundle]);

    const totalPages = Math.ceil(processedGroups.length / pageSize);
    const currentData = processedGroups.slice((currentPage - 1) * pageSize, currentPage * pageSize);

    useEffect(() => { setCurrentPage(1); }, [activeSearch, selectedParent, selectedChild, selectedBrand, activeBundle]);

    const handleCardClick = (group) => {
        setSelectedGroup(group.items);
        setSelectedVariant(group.items[0]);
        setQty(1);
        setNote('');
        setIsModalOpen(true);
    };

    const confirmAddToCart = async () => {
        if (!selectedVariant) return;
        try {
            await api.post('/cart', { productId: selectedVariant.id, quantity: qty, note: note });
            setIsModalOpen(false);
            fetchCartCount();
        } catch (err) { alert("加入失敗"); }
    };

    const handleImageError = (e) => {
        e.target.onerror = null;
        e.target.src = '/images/default.png';
    };

    return (
        <div className="product-page">
            <header className="sticky-header">
                <div className="top-banner">
                    <h2>商品列表</h2>
                    <div className="search-wrapper">
                        <input
                            type="text"
                            placeholder="輸入關鍵字..."
                            value={searchInput}
                            onChange={(e) => setSearchInput(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && handleSearch()} 
                            className="search-input"
                        />
                        {searchInput && (
                            <button className="clear-search-btn" onClick={clearSearch}>✕</button>
                        )}
                        <button className="search-btn" onClick={handleSearch}>搜尋</button>
                    </div>
                    <button className="history-link-btn" onClick={() => navigate('/historyPage')}>歷史訂單</button>
                </div>

                {/* ⭐ 僅在非套組模式下顯示篩選器 */}
                {!activeBundle && (
                    <div className="filter-section">
                        <select value={selectedParent} onChange={(e) => { setSelectedParent(e.target.value); setSelectedChild('全部'); }}>
                            <option value="全部">所有分類</option>
                            {Object.keys(categoriesMap).map(cat => (<option key={cat} value={cat}>{cat}</option>))}
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
                )}
            </header>

            {/* ⭐ 為您推薦區塊 (僅在首頁顯示) */}
            {!activeBundle && !activeSearch && bundles.length > 0 && (
                <div className="recommendation-section">
                    <div className="recommendation-header">
                        <h3>✨ 為您推薦：熱門商品套組</h3>
                    </div>
                    <div className="bundle-scroll-container">
                        {bundles.map(bundle => (
                            <div key={bundle.id} className="bundle-card" onClick={() => handleViewBundle(bundle)}>
                                <img src={bundle.image || '/images/default_bundle.jpg'} className="bundle-bg" alt={bundle.title} />
                                <div className="bundle-overlay">
                                    <h4 className="bundle-title">{bundle.title}</h4>
                                    <div className="bundle-actions">
                                        <button className="bundle-btn">查看套組</button>
                                        <button 
                                            className="bundle-btn primary" 
                                            onClick={(e) => {
                                                e.stopPropagation(); // 避免觸發進入頁面
                                                handleViewBundle(bundle); // 先進入才能計算商品
                                                // 這裡可以做更進階的直接加入，但為了確保邏輯簡單，先進入頁面再讓用戶按全部加入比較安全
                                            }}
                                        >
                                            全部加入
                                        </button>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* ⭐ 套組模式 Header */}
            {activeBundle && (
                <div className="bundle-view-header">
                    <button className="back-btn" onClick={handleExitBundle}>
                        ⬅ 返回列表
                    </button>
                    <span style={{fontWeight:'bold', fontSize:'1.1rem'}}>{activeBundle.title}</span>
                    <button className="bundle-add-all-btn" onClick={() => handleAddAllToCart(processedGroups)}>
                        全部加入 ({processedGroups.length})
                    </button>
                </div>
            )}

            <div className="product-grid">
                {currentData.length > 0 ? currentData.map((group) => (
                    <div key={group.name} className="product-card" onClick={() => handleCardClick(group)}>
                        <div className="product-card-img-wrapper">
                            <img 
                                src={group.mainImg ? `/images/${group.mainImg}` : '/images/default.png'} 
                                alt={group.name}
                                className="product-card-img"
                                loading="lazy"
                                onError={handleImageError}
                            />
                        </div>
                        <div className="card-body">
                            <h3 className="product-name">{group.name}</h3>
                            <div className="product-meta">
                                <span className="brand-tag">{group.brand || '無品牌'}</span>
                                <span className="spec-count-badge">{group.items.length} 種規格</span>
                            </div>
                            <div className="price-row">
                                <span className="price-label">參考價</span>
                                <span className="price-val">${group.minPrice} 起</span>
                            </div>
                        </div>
                        <button className="add-btn">選擇規格</button>
                    </div>
                )) : (
                    <div className="no-result" style={{gridColumn: '1/-1', textAlign:'center', padding:'30px', color:'#888'}}>
                        {activeBundle ? "此套組暫無商品" : "沒有商品"}
                    </div>
                )}
            </div>

            {totalPages > 1 && (
                <div className="pagination">
                    <button onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={currentPage === 1}>上一頁</button>
                    <span>{currentPage} / {totalPages}</span>
                    <button onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))} disabled={currentPage === totalPages}>下一頁</button>
                </div>
            )}

            <div className="cart-wrapper" onClick={() => navigate('/shopcart')}>
                <div className="cart-float">🛒</div>
                {cartCount > 0 && <span className="cart-count">{cartCount}</span>}
            </div>

            {isModalOpen && selectedVariant && (
                <div className="modal-overlay" onClick={() => setIsModalOpen(false)}>
                    <div className="modal-content" onClick={e => e.stopPropagation()}>
                        <div className="modal-img-wrapper">
                            <img 
                                src={selectedVariant.image ? `/images/${selectedVariant.image}` : '/images/default.png'}
                                alt={selectedVariant.name}
                                className="modal-product-img"
                                onError={handleImageError}
                            />
                        </div>
                        <h3 className="modal-title">{selectedGroup[0].name}</h3>
                        <div className="specs-section">
                            <div className="specs-list">
                                {selectedGroup.map(item => (
                                    <button key={item.id} className={`spec-btn ${selectedVariant.id === item.id ? 'active' : ''}`} onClick={() => setSelectedVariant(item)}>
                                        <span className="spec-text">{item.spec}</span>
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
                            <div className="total-preview">小計: ${Number(selectedVariant.price_A) * qty}</div>
                        </div>
                        <textarea className="note-input" placeholder="備註..." value={note} onChange={(e) => setNote(e.target.value)} />
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