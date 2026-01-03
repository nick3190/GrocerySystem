import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';

function HomeSelf() {
    const navigate = useNavigate();
    const inputRef = useRef();
    const [isLoading, setIsLoading] = useState(false);

    const pushName = async () => {
        const inputValue = inputRef.current.value.trim();
        if (!inputValue) {
            alert("請輸入電話號碼或名稱");
            return;
        }
        setIsLoading(true);
        try {
            await axios.post('http://localhost:4000/api/user', {
                type: '自取',
                name: inputValue,
                phone: inputValue
            });
            localStorage.setItem('currentUser', JSON.stringify({ type: '自取', name: inputValue }));
            navigate('/productList');
        } catch (error) {
            alert("伺服器連線錯誤");
        } finally {
            setIsLoading(false);
        }
    }

    return (
        <div className="page-wrapper">
            <div className="centered-box">
                <h2>元榮南北批發 (自取)</h2>
                <div style={{ textAlign: 'left' }}>
                    <label style={{ fontSize: '14px', fontWeight: 'bold' }}>您的手機/電話號碼</label>
                    <input 
                        ref={inputRef} 
                        className="main-input"
                        placeholder="請輸入您的手機或電話號碼" 
                        disabled={isLoading}
                        style={{ width: '100%', padding: '12px', marginTop: '8px', borderRadius: '8px', border: '1px solid #ddd' }}
                    />
                    <small style={{ color: '#888' }}>範例: 0912345678</small>
                </div>
                <button onClick={pushName} disabled={isLoading}>
                    {isLoading ? "處理中..." : "開始下單"}
                </button>
            </div>
        </div>
    )
}

export default HomeSelf;