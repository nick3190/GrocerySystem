import { useNavigate } from 'react-router-dom';
import api from './api';

function Preview() {
    const navigate = useNavigate();

    return (
        <div className="page-wrapper">
            <div className="centered-box">
                <h2> 元榮南北批發 </h2>
                <p style={{ fontSize: '18px', color: 'var(--text-dark)' }}>請選擇取貨方式</p>

                <button onClick={() => navigate('/homeSelf')}>
                    到店自取
                </button>
                <button onClick={() => navigate('/homeDelivery')} style={{ backgroundColor: 'var(--primary)' }}>
                    送貨到府
                </button>
            </div>
        </div>
    );
}

export default Preview;