import { BrowserRouter, Route, Routes, useNavigate } from 'react-router-dom';
import { Navigate } from 'react-router-dom';
import Preview from './Preview';
import HomeSelf from './HomeSelf';
import HomeDelievery from './HomeDelievery';
import ProductList from './ProductList';
import ShopCart from './ShopCart';
import OwnerLogin from './OwnerLogin';
import HistoryPage from './HistoryPage';
import LoginEntry from './LoginEntry';
import './App.css';




function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Navigate to="/loginEntry" />} />
        <Route path="/loginEntry" element={<LoginEntry />} />
        <Route path="/homeSelf" element={<HomeSelf />} />
        <Route path="/homeDelivery" element={<HomeDelievery />} />
        <Route path="/preview" element={<Preview />} />
        <Route path="/productList" element={<ProductList />} />
        <Route path="/shopCart" element={<ShopCart />} />
        <Route path="/ownerlogin" element={<OwnerLogin />} />
        <Route path="/historyPage" element={<HistoryPage />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App
