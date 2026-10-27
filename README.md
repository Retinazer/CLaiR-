# CLaiR — Smart Inventory & Stock Forecast Dashboard

CLaiR is an intelligent inventory management and demand forecasting dashboard designed for small businesses, retail shops, and food & beverage ventures.

---

## Architecture Overview

The codebase has been refactored from a single monolithic file into a modular **Frontend** and **Backend** architecture:

```
CLaiR/
├── backend/
│   ├── data/
│   │   ├── store.js             # Data store with JSON persistence (db.json)
│   ├── routes/
│   │   ├── overview.js          # GET /api/overview
│   │   ├── inventory.js         # GET, POST, PATCH, DELETE /api/inventory
│   │   ├── sales.js             # GET, POST, DELETE /api/sales
│   │   ├── restock.js           # GET, POST /api/restock
│   │   ├── suppliers.js         # GET, POST, DELETE /api/suppliers
│   │   ├── profile.js           # GET, PUT /api/profile
│   │   ├── chat.js              # POST /api/chat
│   │   └── forecast.js          # GET /api/forecast (SARIMAX & ETS with threshold switching)
│   ├── services/
│   │   ├── analyticsService.js  # Demand forecasting, status levels & restock math
│   │   ├── chatService.js       # CLaiR AI query parser and data-driven responses
│   │   └── forecastingEngine.js # Adaptive ETS & SARIMAX mathematical engine
│   └── server.js                # Express app serving static frontend & REST API
│
├── frontend/
│   ├── css/
│   │   ├── main.css             # Design tokens, typography, topbar, drawer & landing
│   │   ├── components.css       # Tables, cards, buttons, stat grids & skeletons
│   │   └── screens.css          # Forecast chart, chat, suppliers map & settings
│   ├── js/
│   │   ├── api.js               # REST client with automatic offline fallback
│   │   ├── utils.js             # Formatting, SVG icons, date helpers, status pills
│   │   └── app.js               # Reactive UI controller, Leaflet map & screen routing
│   └── index.html               # Clean HTML markup
│
├── index.html                   # Root entrypoint redirecting to frontend/
├── package.json                 # Project configuration & npm scripts
└── .gitignore                   # Ignores node_modules/ and local db.json
```

---

## Getting Started

### 1. Prerequisites
- Node.js (v18 or higher recommended)
- npm

### 2. Installation
Install the required dependencies:
```bash
npm install
```

### 3. Run the Server
Start the development server with live watch mode:
```bash
npm run dev
```
Or start in standard production mode:
```bash
npm start
```

Open your browser and navigate to:
**[http://localhost:3000](http://localhost:3000)**

---

## REST API Reference

| Endpoint | Method | Description |
|---|---|---|
| `/api/overview` | `GET` | Dashboard metrics (risk count, healthy, demand, urgent items) |
| `/api/inventory` | `GET` | List all tracked inventory items with computed status |
| `/api/inventory` | `POST` | Add a new SKU/item to inventory |
| `/api/inventory/:sku/stock` | `PATCH` | Add or adjust stock quantity |
| `/api/inventory/:sku` | `DELETE` | Remove an item from inventory |
| `/api/sales` | `GET` | Retrieve transactions summary & history (supports `?days=30`) |
| `/api/sales` | `POST` | Record a sale transaction (auto-deducts inventory) |
| `/api/sales/:id` | `DELETE` | Remove a transaction |
| `/api/restock` | `GET` | List items below reorder point with suggested quantities |
| `/api/restock` | `POST` | Execute restock order for an item |
| `/api/suppliers` | `GET` | List all pinned suppliers |
| `/api/suppliers` | `POST` | Add a supplier with GPS coordinates |
| `/api/suppliers/:id` | `DELETE` | Remove a supplier |
| `/api/profile` | `GET`, `PUT` | Retrieve or update user business profile & currency |
| `/api/chat` | `POST` | Ask CLaiR assistant questions about your live data |
| `/api/forecast` | `GET` | Dynamic demand forecast with ETS & SARIMAX switcher (`?range=1d\|1w\|1m`) |
| `/api/health` | `GET` | Server health check |

---

## Forecasting Engine (ETS & SARIMAX)

CLaiR features an automated statistical switcher that dynamically toggles algorithms based on the richness of historical observation data:

1. **Cold Start (< 3 days)**:
   - Data is insufficient for statistical estimation. Prompts the user to log transactions.
2. **Sparse Data Regime (3 to 13 days) — ETS (Holt-Winters)**:
   - Activates **Exponential Smoothing** with level ($\alpha$) and trend ($\beta$) updates.
   - Prevents parameter instability and matrix singularity that occurs when attempting high-order ARMA estimation on short series.
3. **Rich Data Regime (>= 14 days) — SARIMAX**:
   - Activates **SARIMAX $(1,1,1) \times (1,1,0)_7$** with weekly cycle differencing ($s=7$) and weekend/day-of-week exogenous regressors.
   - Generates point forecasts and shaded 95% confidence intervals displayed directly on the interactive SVG demand chart.

