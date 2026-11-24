import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import './base.css';
import './app.css';
import './theme.css';
import 'primeicons/primeicons.css';
import App from './App.jsx';
import { ToastProvider } from './ui.jsx';

createRoot(document.getElementById('root')).render(
  <BrowserRouter>
    <ToastProvider>
      <App />
    </ToastProvider>
  </BrowserRouter>
);
