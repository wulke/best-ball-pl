import React from 'react';
import ReactDOM from 'react-dom/client';

import { App } from './App.js';
import './styles.css';

// Apply saved theme or default to pitch before first render to avoid flash
const savedTheme = localStorage.getItem('bbpl-theme') ?? 'pitch';
document.documentElement.setAttribute('data-theme', savedTheme);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
