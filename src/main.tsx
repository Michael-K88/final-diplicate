import ReactDOM from 'react-dom/client';
import { AuthWrapper } from './app/AuthWrapper';
import { AnalyticsInitializer } from './utils/analytics';
import './styles/index.scss';

AnalyticsInitializer();

const dismissSplash = () => {
    const splash = document.getElementById('splash-screen');
    if (splash) {
        splash.classList.add('fade-out');
        setTimeout(() => splash.remove(), 600);
    }
};

ReactDOM.createRoot(document.getElementById('root')!).render(<AuthWrapper />);

setTimeout(dismissSplash, 3500);
