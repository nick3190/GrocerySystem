import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';

function HomeDelivery() {
    const navigate = useNavigate();
    const [isLoading, setIsLoading] = useState(false);
    const formRef = useRef({ name: '', address: '', mobile: '' });

    const handleSubmit = async () => {
        const { name, address, mobile } = formRef.current;
        if (!name.value || !address.value || !mobile.value) {
            alert("請填寫所有必填欄位");
            return;
        }

        setIsLoading(true);
        try {
            const userData = { type: '外送', name: name.value, address: address.value, mobile: mobile.value };
            await axios.post('http://localhost:4000/api/user', userData);
            localStorage.setItem('currentUser', JSON.stringify(userData));
            navigate('/productList');
        } catch (error) {
            alert("儲存失敗");
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="page-wrapper">
            <div className="centered-box" style={{ gap: '15px' }}>
                <h2>元榮南北批發 (外送)</h2>
                <input ref={el => formRef.current.name = el} placeholder="名字或店家名稱 *(必填)" className="custom-input" />
                <input ref={el => formRef.current.address = el} placeholder="送貨地址 *(必填)" className="custom-input" />
                <input ref={el => formRef.current.mobile = el} placeholder="手機電話 *(必填)" className="custom-input" />
                
                <button onClick={handleSubmit} disabled={isLoading} style={{ marginTop: '10px' }}>
                    {isLoading ? "處理中..." : "開始下單"}
                </button>
            </div>
        </div>
    );
}

export default HomeDelivery;