import { createRoot } from 'react-dom/client';
import { Capacitor } from '@capacitor/core';
import App from './App.jsx';
import './styles.css';

createRoot(document.getElementById('root')).render(<App />);

if ('serviceWorker' in navigator && import.meta.env.PROD && !Capacitor.isNativePlatform()) {
  addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
}
