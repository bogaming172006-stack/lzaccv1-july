import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

// Ensure navigation bar and theme color is white on mobile devices / PWAs
const enforceWhiteNavigation = () => {
  try {
    const metaNames = ['theme-color', 'navigation-bar-color', 'msapplication-navbutton-color', 'msapplication-TileColor'];
    metaNames.forEach(name => {
      let meta = document.querySelector(`meta[name="${name}"]`);
      if (!meta) {
        meta = document.createElement('meta');
        meta.setAttribute('name', name);
        document.head.appendChild(meta);
      }
      meta.setAttribute('content', '#ffffff');
    });
    document.querySelectorAll('meta[name="theme-color"]').forEach(m => {
      m.setAttribute('content', '#ffffff');
    });
  } catch (e) {
    console.error('Failed to set white navigation bar meta:', e);
  }
};
enforceWhiteNavigation();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

