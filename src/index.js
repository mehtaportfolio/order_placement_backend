// ✅ Polyfill browser-only objects for pdfjs-dist in Node environment
if (typeof global.window === 'undefined') {
  global.window = global;
}
global.process.browser = false;
if (typeof global.location === 'undefined') {
  global.location = { href: 'http://localhost', origin: 'http://localhost', protocol: 'http:', host: 'localhost', hostname: 'localhost', port: '', pathname: '/', search: '', hash: '' };
}
if (typeof global.window.location === 'undefined') {
  global.window.location = global.location;
}
if (typeof global.self === 'undefined') {
  global.self = global;
}
if (typeof global.navigator === 'undefined') {
  global.navigator = { userAgent: 'node' };
}
if (typeof global.document === 'undefined') {
  global.document = {
    createElement: () => ({
      getContext: () => ({})
    })
  };
}
if (typeof global.DOMMatrix === 'undefined') {
  global.DOMMatrix = class DOMMatrix {
    constructor() {
      this.m11 = 1; this.m12 = 0; this.m13 = 0; this.m14 = 0;
      this.m21 = 0; this.m22 = 1; this.m23 = 0; this.m24 = 0;
      this.m31 = 0; this.m32 = 0; this.m33 = 1; this.m34 = 0;
      this.m41 = 0; this.m42 = 0; this.m43 = 0; this.m44 = 1;
    }
  };
}
if (typeof global.ImageData === 'undefined') {
  global.ImageData = class ImageData {
    constructor() {}
  };
}
if (typeof global.Path2D === 'undefined') {
  global.Path2D = class Path2D {
    constructor() {}
  };
}
if (typeof global.CanvasRenderingContext2D === 'undefined') {
  global.CanvasRenderingContext2D = class CanvasRenderingContext2D {
    constructor() {}
  };
}
if (typeof global.HTMLCanvasElement === 'undefined') {
  global.HTMLCanvasElement = class HTMLCanvasElement {
    constructor() {}
  };
}
if (typeof global.DOMPoint === 'undefined') {
  global.DOMPoint = class DOMPoint {
    constructor() {}
  };
}
if (typeof global.DOMRect === 'undefined') {
  global.DOMRect = class DOMRect {
    constructor() {}
  };
}
if (typeof global.HTMLElement === 'undefined') {
  global.HTMLElement = class HTMLElement {
    constructor() {}
  };
}
if (typeof global.Image === 'undefined') {
  global.Image = class Image {
    constructor() {}
  };
}
if (typeof global.OffscreenCanvas === 'undefined') {
  global.OffscreenCanvas = class OffscreenCanvas {
    constructor() {}
    getContext() { return {}; }
  };
}
if (typeof global.Blob === 'undefined') {
  // Use global Blob if available (Node 18+), else mock it
  if (typeof Blob === 'undefined') {
    global.Blob = class Blob {
      constructor() {}
    };
  } else {
    global.Blob = Blob;
  }
}
if (typeof global.XMLSerializer === 'undefined') {
  global.XMLSerializer = class XMLSerializer {
    constructor() {}
    serializeToString() { return ''; }
  };
}

// ✅ Load environment variables FIRST (before anything else)
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// Resolve .env.backend path (one level up from src/)
const envPath = join(dirname(fileURLToPath(import.meta.url)), '..', '.env.backend');
dotenv.config({ path: envPath, override: false });

// -------------------------------------------------------------
// Import core dependencies (safe to import now)
import express from 'express';
import cors from 'cors';
import errorHandler from './middleware/errorHandler.js';

// -------------------------------------------------------------
// Initialize Express app
const app = express();
const PORT = process.env.PORT || 3001;

// Simple request logging middleware
// app.use((req, res, next) => {
//   console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
//   next();
// });

// -------------------------------------------------------------
// Global Middleware
const rawCorsOrigins = process.env.CORS_ORIGIN || 'http://localhost:3000,https://mehta-wealths-dashboard.vercel.app';

const allowedOrigins = rawCorsOrigins
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);
  

app.use(
  cors({
    origin: (origin, callback) => {
      
      // Allow requests with no origin (like mobile apps or curl)
      if (!origin) return callback(null, true);
      
      if (origin.includes('localhost') || origin.includes('127.0.0.1')) return callback(null, true);
      
      const isAllowed = allowedOrigins.some((o) => origin === o || origin.startsWith(o));
      if (isAllowed) return callback(null, true);
      
      console.warn(`⚠️ CORS blocked for origin: ${origin}`);
      return callback(null, false); // Return false instead of error to avoid crashing
    },
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    credentials: true,
  })
);

app.use(express.json());

// Add global error handlers to prevent crash restarts
process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (err) => {
  console.error('❌ Uncaught Exception:', err);
});

// -------------------------------------------------------------
// Root routes for Render keep-alive and restart simulation
app.get('/', (req, res) => {
  res.json({ status: 'backend up', timestamp: new Date().toISOString() });
});

app.post('/', (req, res) => {
  // Simulate restart request (Render free tier doesn't support API restarts)
  res.status(202).json({ message: 'Service is already running' });
});

// Health check route
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.post("/restart", (req, res) => {
  res.json({ status: "info", message: "Service is running. Server restart not required." });
});

console.log('[ZERODHA-INFO] Backend startup: initializing Zerodha token check flow');

// -------------------------------------------------------------
// ✅ Dynamically import routes and init functions AFTER dotenv is loaded
const { default: authRoutes } = await import('./routes/auth.js');
const { default: orderRoutes } = await import('./routes/orderRoutes.js');
const { default: buyOrderRoutes } = await import('./routes/buyOrderRoutes.js');
const { default: multiOrderRoutes } = await import('./routes/multiOrderRoutes.js');
const { default: diagnosticsRoutes } = await import('./routes/diagnostics.js');
const { default: zerodhaRoutes } = await import('./routes/zerodha.js');
const { initializeStockMapping } = await import('./db/initStockMapping.js');
const { initLivePriceServer, loginToAngel } = await import('./services/angelLiveService.js');
const { getAngelStatus } = await import('./services/angelOneService.js');

// Attach only the routes needed by the equity order placement frontend
app.use('/api/auth', authRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/orders', multiOrderRoutes);
app.use('/api/order', orderRoutes);
app.use('/api/buy-order', buyOrderRoutes);
app.use('/api/diagnostics', diagnosticsRoutes);
app.use('/api/zerodha', zerodhaRoutes);

app.get('/api/health', async (req, res) => {
  const result = {
    status: 'ok',
    services: {},
    timestamp: new Date().toISOString()
  };

  try {
    const { supabase } = await import('./db/supabaseClient.js');
    const { data, error } = await supabase.from('stock_symbols').select('name').limit(1);
    if (error) {
      result.services.supabase = { ok: false, error: error.message || error };
      result.status = 'degraded';
    } else {
      result.services.supabase = { ok: true, rows: Array.isArray(data) ? data.length : 0 };
    }
  } catch (err) {
    result.services.supabase = { ok: false, error: err.message };
    result.status = 'degraded';
  }

  try {
    const angelStatus = getAngelStatus();
    result.services.angel = angelStatus;
    if (angelStatus.circuitOpen) result.status = 'degraded';
  } catch (err) {
    result.services.angel = { ok: false, error: err.message };
    result.status = 'degraded';
  }

  res.json(result);
});

// -------------------------------------------------------------
// Error handler middleware
app.use(errorHandler);

// Initialize stock_mapping table on startup
try {
  await initializeStockMapping();
} catch (err) {
  console.error('[Startup] Error during initialization:', err);
}

// -------------------------------------------------------------
// Start the server
const server = app.listen(PORT, () => {
  console.log(`🚀 Dedicated equity order backend running on port ${PORT}`);

  try {
    initLivePriceServer(server);
    loginToAngel();
  } catch (err) {
    console.error('[Startup] Error initializing equity live price services:', err);
  }

  (async () => {
    try {
      const { default: kiteClient } = await import('./services/zerodha/kiteClient.js');
      const accounts = ['PM', 'PDM', 'PSM'];

      for (const account of accounts) {
        try {
          console.log(`[ZERODHA-INFO] Startup probe: checking Zerodha token lookup for ${account}`);
          await kiteClient.getInstance(account);
          console.log(`[ZERODHA-INFO] Startup probe completed for ${account}`);
        } catch (err) {
          console.error(`[ZERODHA-ERROR] Startup probe failed for ${account}:`, err.message);
        }
      }
    } catch (err) {
      console.error('[ZERODHA-ERROR] Startup probe failed:', err.message);
    }
  })();
});
