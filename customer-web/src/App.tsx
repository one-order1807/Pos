import { Navigate, Route, Routes } from 'react-router-dom';
import { NotFoundPage } from './pages/NotFoundPage';
import { OrderPage } from './pages/OrderPage';
import { OrderStatusPage } from './pages/OrderStatusPage';

export default function App() {
  return (
    <Routes>
      <Route path="/t/:token" element={<OrderPage />} />
      <Route path="/order/:orderId" element={<OrderStatusPage />} />
      <Route path="/" element={<NotFoundPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
