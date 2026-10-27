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
│   │   └── chat.js              # POST /api/chat
│   ├── services/
│   │   ├── analyticsService.js  # Demand forecasting, status levels & restock math
│   │   └── chatService.js       # CLaiR AI query parser and data-driven responses
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
| `/api/health` | `GET` | Server health check |
