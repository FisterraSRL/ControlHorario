import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

// The token layer first, so component stylesheets can only ever override it, never lose to
// it on source order. It imports the vendored brand tokens and the self-hosted Montserrat.
import '../tokens/fisterra.app.css';
import { App } from './App.js';

const contenedor = document.getElementById('root');
if (!contenedor) throw new Error('No se encontró #root en index.html.');

createRoot(contenedor).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
