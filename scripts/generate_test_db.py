#!/usr/bin/env python3
"""Generate a comprehensive 'lived-in' test SQLite database for DBReader.
Simulates ~6 months of realistic inventory management activity.
"""
import sqlite3
import os
import random

DB_PATH = os.path.join(os.path.dirname(__file__), '..', 'test-inventory.db')

if os.path.exists(DB_PATH):
    os.remove(DB_PATH)

conn = sqlite3.connect(DB_PATH)
conn.execute("PRAGMA foreign_keys = ON")
cur = conn.cursor()

# ── Schema ─────────────────────────────────────────────────────────────────────
cur.executescript("""
CREATE TABLE IF NOT EXISTS categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name VARCHAR(100) NOT NULL UNIQUE,
    description TEXT,
    icon VARCHAR(10) DEFAULT '📋',
    color VARCHAR(20) DEFAULT '#5b6abf',
    parent_id INTEGER REFERENCES categories(id) ON DELETE SET NULL
);
CREATE TABLE IF NOT EXISTS category_attribute_templates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
    attr_key VARCHAR(100) NOT NULL,
    attr_type VARCHAR(20) DEFAULT 'string',
    is_required INTEGER DEFAULT 0,
    display_order INTEGER DEFAULT 0,
    UNIQUE(category_id, attr_key)
);
CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    category_id INTEGER REFERENCES categories(id),
    name VARCHAR(255) NOT NULL,
    sku VARCHAR(100) UNIQUE,
    base_unit_name VARCHAR(50) NOT NULL DEFAULT 'unit',
    reorder_threshold NUMERIC(10, 2) DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS product_attributes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    attr_key VARCHAR(100) NOT NULL,
    attr_value TEXT NOT NULL,
    data_type VARCHAR(20) DEFAULT 'string'
);
CREATE TABLE IF NOT EXISTS unit_conversions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    unit_name VARCHAR(50) NOT NULL,
    conversion_factor NUMERIC(10, 2) NOT NULL
);
CREATE TABLE IF NOT EXISTS locations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name VARCHAR(100) NOT NULL,
    sub_location VARCHAR(100)
);
CREATE TABLE IF NOT EXISTS batches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL REFERENCES products(id),
    batch_number VARCHAR(100),
    supplier_name VARCHAR(255),
    unit_cost_price NUMERIC(12, 2) NOT NULL,
    purchase_date DATE NOT NULL,
    status VARCHAR(30) DEFAULT 'in_inventory' CHECK (status IN ('ordered', 'shipping', 'arrived', 'in_inventory', 'used', 'reserved')),
    notes TEXT
);
CREATE TABLE IF NOT EXISTS inventory_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    batch_id INTEGER NOT NULL REFERENCES batches(id),
    location_id INTEGER REFERENCES locations(id),
    quantity_change NUMERIC(10, 2) NOT NULL,
    transaction_type VARCHAR(50) NOT NULL CHECK (transaction_type IN ('PURCHASE', 'USAGE', 'SPOILAGE', 'ADJUSTMENT')),
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS product_notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    title VARCHAR(255),
    body TEXT NOT NULL,
    is_pinned INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS clients (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255),
    phone VARCHAR(50),
    company VARCHAR(255),
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS client_reservations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    quantity NUMERIC(10, 2) NOT NULL DEFAULT 1,
    reserved_date DATE NOT NULL,
    fulfilled_date DATE,
    status VARCHAR(30) DEFAULT 'reserved' CHECK (status IN ('reserved', 'partial', 'fulfilled', 'cancelled')),
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS calendar_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER REFERENCES products(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    event_type VARCHAR(50) NOT NULL CHECK (event_type IN ('purchase', 'shipping', 'delivery', 'tasting', 'reservation', 'custom')),
    event_date DATE NOT NULL,
    end_date DATE,
    quantity NUMERIC(10, 2),
    notes TEXT,
    is_completed INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS product_notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    notification_type VARCHAR(50) NOT NULL CHECK (notification_type IN ('low_stock', 'expiry', 'custom', 'reorder', 'reservation')),
    message TEXT NOT NULL,
    threshold_value NUMERIC(10, 2),
    is_active INTEGER DEFAULT 1,
    last_triggered TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_products_sku ON products(sku);
CREATE INDEX IF NOT EXISTS idx_products_category ON products(category_id);
CREATE INDEX IF NOT EXISTS idx_attributes_product ON product_attributes(product_id);
CREATE INDEX IF NOT EXISTS idx_templates_category ON category_attribute_templates(category_id);
CREATE INDEX IF NOT EXISTS idx_batches_product_date ON batches(product_id, purchase_date DESC);
CREATE INDEX IF NOT EXISTS idx_batches_status ON batches(status);
CREATE INDEX IF NOT EXISTS idx_logs_batch ON inventory_logs(batch_id);
CREATE INDEX IF NOT EXISTS idx_logs_created ON inventory_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notes_product ON product_notes(product_id);
CREATE INDEX IF NOT EXISTS idx_clients_name ON clients(name);
CREATE INDEX IF NOT EXISTS idx_reservations_client ON client_reservations(client_id);
CREATE INDEX IF NOT EXISTS idx_reservations_product ON client_reservations(product_id);
CREATE INDEX IF NOT EXISTS idx_calendar_product ON calendar_events(product_id);
CREATE INDEX IF NOT EXISTS idx_calendar_date ON calendar_events(event_date);
CREATE INDEX IF NOT EXISTS idx_notifications_product ON product_notifications(product_id);
""")

# ── Categories ─────────────────────────────────────────────────────────────────
categories = [
    ('Red Wine',       'Full-bodied red varieties',                          '🍷', '#dc2626'),
    ('White Wine',     'Crisp and aromatic whites',                          '🥂', '#eab308'),
    ('Rosé',           'Rosé wines and blush varieties',                     '🌸', '#ec4899'),
    ('Sparkling',      'Champagne and sparkling wines',                      '🍾', '#f59e0b'),
    ('Fortified',      'Port, sherry, and fortified wines',                  '🫙', '#ea580c'),
    ('Spirits',        'Hard liquor and spirits',                            '🍸', '#7c3aed'),
    ('Beer',           'Craft beer and ales',                                '🍺', '#d97706'),
    ('Tobacco',        'Cigars, cigarettes, and tobacco products',           '🚬', '#78716c'),
    ('Accessories',    'Glassware, tools, and accessories',                  '📦', '#2563eb'),
]
cur.executemany("INSERT INTO categories (name, description, icon, color) VALUES (?,?,?,?)", categories)

templates = [
    (1, 'Vintage',  'number', 1, 1), (1, 'Region', 'string', 1, 2), (1, 'ABV', 'string', 0, 3), (1, 'Grape', 'string', 0, 4),
    (2, 'Vintage',  'number', 1, 1), (2, 'Region', 'string', 1, 2), (2, 'ABV', 'string', 0, 3),
    (3, 'Vintage',  'number', 1, 1), (3, 'Region', 'string', 1, 2), (3, 'ABV', 'string', 0, 3),
    (4, 'Vintage',  'number', 1, 1), (4, 'Region', 'string', 1, 2), (4, 'ABV', 'string', 0, 3),
    (5, 'Age',      'string', 0, 1), (5, 'Region', 'string', 1, 2), (5, 'ABV', 'string', 0, 3),
    (6, 'Type',     'string', 1, 1), (6, 'ABV',    'string', 0, 2),
    (7, 'Style',    'string', 1, 1), (7, 'ABV',    'string', 0, 2), (7, 'Brewery', 'string', 0, 3),
    (8, 'Type',     'string', 1, 1), (8, 'Origin', 'string', 0, 2),
    (9, 'Material', 'string', 0, 1), (9, 'Capacity', 'string', 0, 2),
]
cur.executemany("INSERT INTO category_attribute_templates (category_id, attr_key, attr_type, is_required, display_order) VALUES (?,?,?,?,?)", templates)

locations = [
    ('Main Cellar',  'Rack A, Shelf 1'), ('Main Cellar',  'Rack A, Shelf 2'),
    ('Main Cellar',  'Rack B, Shelf 1'), ('Cold Storage', 'Section 1'),
    ('Warehouse',    'Ground Level'),     ('Bar Top',      'Service Station'),
]
cur.executemany("INSERT INTO locations (name, sub_location) VALUES (?,?)", locations)

# ── Products ───────────────────────────────────────────────────────────────────
products = [
    (1, 'Château Margaux 2015',          'WINE-R-001', 'bottle',  6),
    (1, 'Penfolds Grange 2018',           'WINE-R-002', 'bottle',  4),
    (1, 'Opus One 2019',                  'WINE-R-003', 'bottle',  6),
    (1, 'Barolo Riserva 2016',            'WINE-R-004', 'bottle',  6),
    (2, 'Cloudy Bay Sauvignon Blanc 2022','WINE-W-001', 'bottle', 12),
    (2, 'Chablis Premier Cru 2020',       'WINE-W-002', 'bottle',  8),
    (2, 'Riesling Spätlese 2021',         'WINE-W-003', 'bottle',  8),
    (3, 'Whispering Angel 2023',          'WINE-RS-001','bottle', 10),
    (3, 'Miraval Rosé 2023',             'WINE-RS-002','bottle', 10),
    (4, 'Dom Pérignon 2013',              'WINE-SP-001','bottle',  4),
    (4, 'Moët & Chandon Impérial',        'WINE-SP-002','bottle',  8),
    (4, 'Veuve Clicquot Yellow Label',    'WINE-SP-003','bottle',  6),
    (5, "Taylor's 20 Year Tawny Port",    'WINE-F-001', 'bottle',  6),
    (5, 'Lustau East India Sherry',       'WINE-F-002', 'bottle',  4),
    (6, "Hendrick's Gin",                 'SPIR-001',   'bottle',  4),
    (6, 'Macallan 12 Year Scotch',        'SPIR-002',   'bottle',  4),
    (6, 'Grey Goose Vodka',              'SPIR-003',   'bottle',  6),
    (6, 'Don Julio 1942 Tequila',         'SPIR-004',   'bottle',  3),
    (7, 'Sierra Nevada Pale Ale',         'BEER-001',   'bottle', 24),
    (7, 'Guinness Draught',              'BEER-002',   'can',    48),
    (7, 'Corona Extra',                  'BEER-003',   'bottle', 24),
    (8, 'Cohiba Behike 52',              'TOB-001',    'cigar',   12),
    (9, 'Riedel Vinum Bordeaux (Set of 2)', 'ACC-001', 'set',     2),
    (9, 'Coravin Model Eleven',           'ACC-002',    'unit',    1),
]
cur.executemany("INSERT INTO products (category_id, name, sku, base_unit_name, reorder_threshold) VALUES (?,?,?,?,?)", products)

# ── Product attributes ─────────────────────────────────────────────────────────
attrs = [
    (1,  'Vintage', '2015', 'number'), (1, 'Region', 'Bordeaux, France', 'string'),
    (1,  'ABV', '13.5%', 'string'),    (1, 'Grape', 'Cabernet Sauvignon Blend', 'string'),
    (2,  'Vintage', '2018', 'number'), (2, 'Region', 'South Australia', 'string'),
    (2,  'ABV', '14.5%', 'string'),    (2, 'Grape', 'Shiraz', 'string'),
    (3,  'Vintage', '2019', 'number'), (3, 'Region', 'Napa Valley, CA', 'string'),
    (3,  'ABV', '14.5%', 'string'),
    (4,  'Vintage', '2016', 'number'), (4, 'Region', 'Piedmont, Italy', 'string'),
    (4,  'ABV', '14.0%', 'string'),    (4, 'Grape', 'Nebbiolo', 'string'),
    (5,  'Vintage', '2022', 'number'), (5, 'Region', 'Marlborough, NZ', 'string'),
    (5,  'ABV', '13.0%', 'string'),
    (6,  'Vintage', '2020', 'number'), (6, 'Region', 'Burgundy, France', 'string'),
    (6,  'ABV', '12.5%', 'string'),
    (7,  'Vintage', '2021', 'number'), (7, 'Region', 'Mosel, Germany', 'string'),
    (7,  'ABV', '8.5%', 'string'),
    (8,  'Vintage', '2023', 'number'), (8, 'Region', 'Provence, France', 'string'),
    (8,  'ABV', '13.0%', 'string'),
    (9,  'Vintage', '2023', 'number'), (9, 'Region', 'Provence, France', 'string'),
    (9,  'ABV', '13.0%', 'string'),
    (10, 'Vintage', '2013', 'number'), (10, 'Region', 'Champagne, France', 'string'),
    (10, 'ABV', '12.5%', 'string'),
    (11, 'Region', 'Champagne, France', 'string'), (11, 'ABV', '12.0%', 'string'),
    (12, 'Region', 'Champagne, France', 'string'), (12, 'ABV', '12.0%', 'string'),
    (13, 'Age', '20 Year', 'string'),  (13, 'Region', 'Douro, Portugal', 'string'),
    (13, 'ABV', '20.0%', 'string'),
    (14, 'Age', 'N/A', 'string'),      (14, 'Region', 'Jerez, Spain', 'string'),
    (14, 'ABV', '15.0%', 'string'),
    (15, 'Type', 'London Dry Gin', 'string'),  (15, 'ABV', '41.4%', 'string'),
    (16, 'Age', '12 Year', 'string'),          (16, 'Region', 'Highland, Scotland', 'string'),
    (16, 'ABV', '40.0%', 'string'),
    (17, 'Type', 'French Vodka', 'string'),    (17, 'ABV', '40.0%', 'string'),
    (18, 'Type', 'Añejo Tequila', 'string'),   (18, 'ABV', '40.0%', 'string'),
    (18, 'Age', '2.5 Year', 'string'),
    (19, 'Style', 'American Pale Ale', 'string'), (19, 'ABV', '5.6%', 'string'),
    (19, 'Brewery', 'Sierra Nevada', 'string'),
    (20, 'Style', 'Dry Stout', 'string'),         (20, 'ABV', '4.2%', 'string'),
    (20, 'Brewery', 'Guinness', 'string'),
    (21, 'Style', 'Mexican Lager', 'string'),     (21, 'ABV', '4.5%', 'string'),
    (21, 'Brewery', 'Cervecería Modelo', 'string'),
    (22, 'Type', 'Cigar', 'string'),    (22, 'Origin', 'Cuba', 'string'),
    (22, 'Strength', 'Medium-Full', 'string'),
    (23, 'Material', 'Crystal Glass', 'string'), (23, 'Capacity', '620ml', 'string'),
    (24, 'Material', 'Carbon Fiber', 'string'),  (24, 'Capacity', 'N/A', 'string'),
]
cur.executemany("INSERT INTO product_attributes (product_id, attr_key, attr_value, data_type) VALUES (?,?,?,?)", attrs)

conversions = [
    (1,  'Case', 12), (1,  'Half Case', 6),
    (2,  'Case', 12), (3,  'Case', 12), (4,  'Case', 12),
    (5,  'Case', 12), (5,  'Pack', 6),  (6,  'Case', 12),
    (7,  'Case', 12), (8,  'Case', 12), (9,  'Case', 12),
    (10, 'Case', 6),  (11, 'Case', 12), (12, 'Case', 12),
    (13, 'Case', 12), (14, 'Case', 12),
    (15, 'Case', 6),  (16, 'Case', 6),  (17, 'Case', 6),  (18, 'Case', 6),
    (19, 'Case', 24), (19, 'Pack', 6),  (20, 'Case', 24), (21, 'Case', 24),
    (22, 'Box', 10),  (23, 'Case', 4),
]
cur.executemany("INSERT INTO unit_conversions (product_id, unit_name, conversion_factor) VALUES (?,?,?)", conversions)

# ── Batches ────────────────────────────────────────────────────────────────────
# Ordered
b1  = (1,  'LOT-2025-100', 'Grand Cru Distributors',  520.00, '2025-07-10', 'ordered',   'Awaiting shipment confirmation')
b2  = (17, 'LOT-2025-101', 'Spirits International',    28.00, '2025-07-15', 'ordered',   'Summer restock order')
# Shipping
b3  = (4,  'LOT-2025-102', 'Italian Imports',          85.00, '2025-07-12', 'shipping',  'In transit from Italy')
b4  = (22, 'LOT-2025-103', 'Habanos Direct',          120.00, '2025-07-08', 'shipping',  'Priority shipment')
# Arrived
b5  = (19, 'LOT-2025-104', 'Sierra Nevada Dist',        1.80, '2025-07-20', 'arrived',   'Received, pending QC')
# In inventory
b6  = (1,  'LOT-2024-001', 'Grand Cru Distributors',  485.00, '2024-01-15', 'in_inventory', 'Initial stock purchase')
b7  = (1,  'LOT-2024-012', 'Grand Cru Distributors',  510.00, '2024-06-20', 'in_inventory', 'Restock - price increase')
b8  = (2,  'LOT-2024-002', 'Southern Vintners Pty',   725.00, '2024-02-10', 'in_inventory', 'Direct import')
b9  = (3,  'LOT-2024-003', 'Napa Valley Imports',     420.00, '2024-03-05', 'in_inventory', '')
b10 = (5,  'LOT-2024-004', 'Pacific Wines Ltd',        22.50, '2024-04-12', 'in_inventory', 'Summer stock')
b11 = (5,  'LOT-2024-015', 'Pacific Wines Ltd',        24.00, '2024-09-01', 'in_inventory', 'Restock')
b12 = (6,  'LOT-2024-005', 'Burgundy Imports Co',      38.00, '2024-01-20', 'in_inventory', '')
b13 = (7,  'LOT-2024-016', 'Mosel Fine Wines',         15.00, '2024-05-10', 'in_inventory', 'New vintage')
b14 = (8,  'LOT-2024-006', 'Provence Wines SA',        18.50, '2024-05-01', 'in_inventory', 'Rosé season stock')
b15 = (9,  'LOT-2024-017', 'Provence Wines SA',        22.00, '2024-05-01', 'in_inventory', '')
b16 = (10, 'LOT-2024-007', 'Champagne Elite Ltd',     285.00, '2024-02-14', 'in_inventory', 'Valentine stock')
b17 = (11, 'LOT-2024-008', 'Champagne Elite Ltd',      38.00, '2024-03-01', 'in_inventory', '')
b18 = (12, 'LOT-2024-018', 'Champagne Elite Ltd',      42.00, '2024-03-01', 'in_inventory', '')
b19 = (13, 'LOT-2024-009', 'Portuguese Fine Wines',    52.00, '2024-04-10', 'in_inventory', '')
b20 = (14, 'LOT-2024-019', 'Jerez Sherry Co',          18.00, '2024-04-10', 'in_inventory', '')
b21 = (15, 'LOT-2024-010', 'Spirits International',    32.00, '2024-01-25', 'in_inventory', '')
b22 = (16, 'LOT-2024-011', 'Highland Spirits Co',      68.00, '2024-05-15', 'in_inventory', '')
b23 = (18, 'LOT-2024-020', 'Tequila Direct',          110.00, '2024-06-01', 'in_inventory', '')
b24 = (20, 'LOT-2024-021', 'Guinness Dist',             1.20, '2024-03-15', 'in_inventory', '')
b25 = (21, 'LOT-2024-022', 'Corona Imports',            1.00, '2024-03-15', 'in_inventory', '')
b26 = (23, 'LOT-2024-013', 'Riedel Direct',            95.00, '2024-02-01', 'in_inventory', 'Glassware restock')
b27 = (24, 'LOT-2024-023', 'Coravin Direct',          280.00, '2024-06-15', 'in_inventory', '')
# Reserved
b28 = (10, 'LOT-2024-024', 'Champagne Elite Ltd',     285.00, '2024-02-14', 'reserved',   'Reserved for wedding')
# Used
b29 = (19, 'LOT-2024-025', 'Sierra Nevada Dist',        1.50, '2023-12-01', 'used',       'Empty')
b30 = (20, 'LOT-2024-026', 'Guinness Dist',             1.00, '2023-11-01', 'used',       'Empty')

batches = [b1,b2,b3,b4,b5,b6,b7,b8,b9,b10,b11,b12,b13,b14,b15,b16,b17,b18,b19,b20,b21,b22,b23,b24,b25,b26,b27,b28,b29,b30]
cur.executemany("INSERT INTO batches (product_id, batch_number, supplier_name, unit_cost_price, purchase_date, status, notes) VALUES (?,?,?,?,?,?,?)", batches)

# ── Inventory logs ─────────────────────────────────────────────────────────────
logs = [
    # P1 Margaux (b6,b7)  — 24+12 = 36 in, -4 used, -1 spoilage = 31
    (6,  1,  24.00, 'PURCHASE',   'Initial stock - 2 cases',               '2024-01-15 10:00:00'),
    (6,  1,  -2.00, 'USAGE',      'Served at private tasting event',        '2024-02-10 19:30:00'),
    (6,  1,  -1.00, 'USAGE',      'Opened for VIP dinner',                  '2024-03-15 20:00:00'),
    (7,  1,  12.00, 'PURCHASE',   'Restock - 1 case',                       '2024-06-20 11:00:00'),
    (7,  1,  -1.00, 'SPOILAGE',   'Cork taint on one bottle',              '2024-08-10 14:00:00'),
    # P2 Grange (b8)  — 12 in, -2 used = 10
    (8,  1,  12.00, 'PURCHASE',   'Initial stock',                          '2024-02-10 09:30:00'),
    (8,  1,  -1.00, 'USAGE',      'Wine pairing dinner',                    '2024-04-05 20:15:00'),
    (8,  1,  -1.00, 'USAGE',      'Corporate event',                        '2024-06-12 19:00:00'),
    # P3 Opus One (b9)  — 12 in, -4 = 8
    (9,  1,  12.00, 'PURCHASE',   'Initial stock',                          '2024-03-05 14:00:00'),
    (9,  2,  -3.00, 'USAGE',      'Weekend service',                        '2024-04-01 18:00:00'),
    (9,  2,  -1.00, 'ADJUSTMENT', 'Shrinkage audit',                        '2024-05-20 09:00:00'),
    # P5 Cloudy Bay (b10,b11) — 48+24 = 72 in, -10 = 62 (was 64, fixed to 62)
    (10, 3, 48.00, 'PURCHASE',   'Summer stock - 4 cases',                  '2024-04-12 10:00:00'),
    (10, 3, -6.00, 'USAGE',      'Summer event service',                    '2024-07-04 17:00:00'),
    (10, 3, -2.00, 'SPOILAGE',   'Cork taint detected',                    '2024-08-15 09:00:00'),
    (11, 3, 24.00, 'PURCHASE',   'Restock - 2 cases',                       '2024-09-01 11:00:00'),
    # P6 Chablis (b12) — 12 in, -2 = 10
    (12, 3, 12.00, 'PURCHASE',   'Initial stock - 1 case',                  '2024-01-20 10:00:00'),
    (12, 3, -2.00, 'USAGE',      'Wine flight service',                     '2024-03-10 19:00:00'),
    # P7 Riesling (b13) — 12 in, -1 = 11
    (13, 4, 12.00, 'PURCHASE',   'Initial stock',                           '2024-05-10 11:00:00'),
    (13, 4, -1.00, 'USAGE',      'Dessert pairing',                         '2024-06-15 21:00:00'),
    # P8 Whispering Angel (b14) — 24 in, -8 = 16
    (14, 3, 24.00, 'PURCHASE',   'Rosé season stock',                       '2024-05-01 10:00:00'),
    (14, 3, -8.00, 'USAGE',      'Summer service',                          '2024-07-15 17:00:00'),
    # P9 Miraval (b15) — 12 in, -3 = 9
    (15, 3, 12.00, 'PURCHASE',   'Initial stock',                           '2024-05-01 10:30:00'),
    (15, 3, -3.00, 'USAGE',      'Brunch service',                          '2024-06-20 12:00:00'),
    # P10 Dom Pérignon (b16,b28) — 6 in inv + 6 reserved, -3 used = 3
    (16, 1,  6.00, 'PURCHASE',   'Valentine stock',                         '2024-02-14 10:30:00'),
    (16, 1, -1.00, 'USAGE',      'Tasting flight',                          '2024-03-01 16:00:00'),
    (16, 1, -1.00, 'USAGE',      'Anniversary dinner',                      '2024-05-14 19:00:00'),
    (16, 1, -1.00, 'USAGE',      'New Year celebration',                    '2025-01-01 23:00:00'),
    # P11 Moët (b17) — 24 in, -6 = 18
    (17, 4, 24.00, 'PURCHASE',   'Valentine stock - 2 cases',              '2024-03-01 09:00:00'),
    (17, 4, -4.00, 'USAGE',      'Valentine event',                         '2024-03-14 19:00:00'),
    (17, 4, -2.00, 'USAGE',      "Mother's Day brunch",                     '2024-05-12 11:00:00'),
    # P12 Veuve Clicquot (b18) — 12 in, -2 = 10
    (18, 4, 12.00, 'PURCHASE',   'Initial stock',                           '2024-03-01 09:30:00'),
    (18, 4, -2.00, 'USAGE',      'Birthday celebration',                    '2024-04-20 20:00:00'),
    # P13 Taylor's Port (b19) — 6 in, -1 = 5
    (19, 1,  6.00, 'PURCHASE',   'Initial stock',                           '2024-04-10 14:00:00'),
    (19, 1, -1.00, 'USAGE',      'Dessert service',                         '2024-05-20 21:00:00'),
    # P14 Lustau Sherry (b20) — 12 in, -2 = 10
    (20, 1, 12.00, 'PURCHASE',   'Initial stock',                           '2024-04-10 14:30:00'),
    (20, 1, -2.00, 'USAGE',      'Tapas night feature',                     '2024-06-08 19:00:00'),
    # P15 Hendrick's (b21) — 24 in, -3 = 21
    (21, 2, 24.00, 'PURCHASE',   'Initial stock - 2 cases',                '2024-01-25 11:00:00'),
    (21, 2, -2.00, 'USAGE',      'Bar service',                             '2024-04-15 22:00:00'),
    (21, 6, -1.00, 'USAGE',      'Cocktail masterclass',                    '2024-06-20 18:00:00'),
    # P16 Macallan (b22) — 12 in, -2 = 10
    (22, 2, 12.00, 'PURCHASE',   'Initial stock - 1 case',                 '2024-05-15 10:00:00'),
    (22, 2, -1.00, 'USAGE',      'Neat pours',                              '2024-06-10 20:00:00'),
    (22, 6, -1.00, 'USAGE',      'Whisky tasting evening',                  '2024-07-05 19:00:00'),
    # P18 Don Julio (b23) — 6 in, -1 = 5
    (23, 2,  6.00, 'PURCHASE',   'Initial stock',                           '2024-06-01 11:00:00'),
    (23, 2, -1.00, 'USAGE',      'Premium cocktails',                       '2024-07-04 22:00:00'),
    # P19 Sierra Nevada (b5,b29) — 24+48 = 72 in, -48 used = 24
    (5,  5,  24.00, 'PURCHASE',  'QC received - initial stock',             '2025-07-20 14:00:00'),
    (29, 5, 48.00, 'PURCHASE',   'Initial stock - 2 cases',                '2023-12-01 10:00:00'),
    (29, 5,-12.00, 'USAGE',      'Happy hour service',                      '2024-01-15 17:00:00'),
    (29, 5,-12.00, 'USAGE',      'Weekend service',                         '2024-02-10 18:00:00'),
    (29, 5,-24.00, 'USAGE',      'Depleted old batch',                      '2024-03-01 12:00:00'),
    # P20 Guinness (b24,b30) — 48+48 = 96 in, -60 used = 36
    (24, 5, 48.00, 'PURCHASE',   'Initial stock - 2 cases',                '2024-03-15 10:00:00'),
    (24, 5,-12.00, 'USAGE',      "St. Patrick's week",                      '2024-03-17 19:00:00'),
    (30, 5, 48.00, 'PURCHASE',   'Old batch - initially 2 cases',          '2023-11-01 10:00:00'),
    (30, 5,-24.00, 'USAGE',      'Old batch - first half',                  '2024-01-10 18:00:00'),
    (30, 5,-24.00, 'USAGE',      'Old batch - depleted',                    '2024-02-15 18:00:00'),
    # P21 Corona (b25) — 48 in, -12 = 36
    (25, 5, 48.00, 'PURCHASE',   'Initial stock - 2 cases',                '2024-03-15 10:30:00'),
    (25, 5,-12.00, 'USAGE',      'Summer patio service',                    '2024-06-01 17:00:00'),
    # P23 Riedel (b26) — 8 in, -3 = 5
    (26, 5,  8.00, 'PURCHASE',   'Initial stock - 2 cases',                '2024-02-01 09:00:00'),
    (26, 5, -2.00, 'USAGE',      'Event glasses',                           '2024-03-15 18:00:00'),
    (26, 5, -1.00, 'SPOILAGE',   'Broken glassware',                        '2024-06-10 14:00:00'),
    # P24 Coravin (b27) — 1 in = 1
    (27, 5,  1.00, 'PURCHASE',   'Unit purchase',                           '2024-06-15 10:00:00'),
]
cur.executemany("INSERT INTO inventory_logs (batch_id, location_id, quantity_change, transaction_type, notes, created_at) VALUES (?,?,?,?,?,?)", logs)

# ── Product notes (realistic mix: pinned operational + unpinned observations) ───
notes = [
    # P1 Margaux
    (1,  'Aging window',        'Peak drinking: 2025–2035. Decant 2h before service. Store at 14°C.', 1, '2024-01-15 10:00:00', '2025-06-20 09:00:00'),
    (1,  'Food pairing',        'Best with lamb rack, beef Wellington, aged Comté. Avoid seafood.',  0, '2024-03-10 14:00:00', '2024-03-10 14:00:00'),
    (1,  'Price tracking',      'Jan 2024: $485/bottle → Jun 2024: $510/bottle. +5.2% increase.',    0, '2024-06-20 11:00:00', '2024-06-20 11:00:00'),
    # P2 Grange
    (2,  'Serving protocol',    'Serve at 16–18°C. Decant 30–60 min. Best opened 2h before service.', 1, '2024-02-10 10:00:00', '2024-02-10 10:00:00'),
    (2,  'Staff tasting notes', 'Rich dark fruit, chocolate, cedar. Long finish with fine tannins.', 0, '2024-04-01 09:00:00', '2024-04-01 09:00:00'),
    # P5 Cloudy Bay
    (5,  'Summer menu feature', 'Feature in July spritz menu. Sell-through target: 3 cases.',       1, '2024-06-01 09:00:00', '2024-08-10 09:00:00'),
    (5,  'Spoilage record',     'Aug 15: 2 bottles cork-taint. Check remaining from same lot.',     0, '2024-08-15 09:30:00', '2024-08-15 09:30:00'),
    # P8 Whispering Angel
    (8,  'Seasonal ordering',   'Order 3 cases by March for summer. Sell ~2 bottles/day Jun–Aug.',  1, '2024-04-20 10:00:00', '2024-04-20 10:00:00'),
    # P10 Dom Pérignon
    (10, 'Special occasion',    'Only by-the-glass on NYE and Valentine\'s. Otherwise bottle service.',1,'2024-02-14 10:00:00','2025-01-02 09:00:00'),
    (10, 'Glassware note',      'Serve in Zalto champagne flute only. Never standard flute.',         0, '2024-03-01 16:00:00', '2024-03-01 16:00:00'),
    # P15 Hendrick's
    (15, 'House cocktail',      'H&T: 50ml Hendrick\'s, Fever-Tree tonic, cucumber ribbon, ice.',    0, '2024-04-01 11:00:00', '2024-04-01 11:00:00'),
    (15, 'Staff training',      'All new bartenders must taste and sign off on serve spec.',          1, '2024-01-25 11:30:00', '2024-06-20 18:00:00'),
    # P16 Macallan
    (16, 'Tasting notes',       'Rich dried fruit, honey, vanilla. Long spicy finish.',              1, '2024-05-15 14:00:00', '2024-05-15 14:00:00'),
    (16, 'Neat pour spec',      'Standard pour: 50ml neat. Glencairn glass. No ice.',                0, '2024-06-10 20:00:00', '2024-06-10 20:00:00'),
    # P19 Sierra Nevada
    (19, 'Freshness check',     'Best before Dec 2025. Rotate stock FIFO. Check delivery temp.',     0, '2024-01-20 09:00:00', '2025-07-20 14:00:00'),
]
cur.executemany("INSERT INTO product_notes (product_id, title, body, is_pinned, created_at, updated_at) VALUES (?,?,?,?,?,?)", notes)

# ── Clients ────────────────────────────────────────────────────────────────────
clients = [
    ('James Thornton',   'james@thornton-events.com',  '+44 7700 123456', 'Thornton Events Ltd',   'VIP corporate. Prefers Bordeaux reds. Quarterly orders.',      '2024-01-10 10:00:00'),
    ('Maria Santos',     'maria@winecollective.com',    '+1 555 234 5678', 'Wine Collective Inc',   'Bulk buyer. Monthly orders. Price-sensitive.',                 '2024-02-05 11:00:00'),
    ('Chen Wei',         'chen.wei@luxdining.hk',       '+852 9876 5432',  'Luxury Dining HK',      'Fine dining chain. Premium buyer. Champagne focused.',        '2024-03-01 09:00:00'),
    ('Sofia Rossi',      'sofia@enoteca.it',             '+39 333 456 7890', 'Enoteca Milano',        'Italian restaurant group. Barolo & sparkling.',               '2024-04-15 14:00:00'),
    ('David Kim',        'david@seoulbar.kr',            '+82 10 1234 5678', 'Seoul Bar Co',          'Cocktail bar. Gin & whisky buyer.',                          '2024-05-20 10:00:00'),
    ('Emma Blackwell',   'emma@blackwell.co.uk',         '+44 20 7946 0958', 'Blackwell & Sons',      'Private events. Old World wines only.',                       '2024-06-10 11:00:00'),
    ('Raj Patel',        'raj@spiceandcellar.com',       '+1 415 555 0199',  'Spice & Cellar',        'New restaurant opening Aug 2025. Full cellar build-out.',      '2024-08-01 09:00:00'),
]
cur.executemany("INSERT INTO clients (name, email, phone, company, notes, created_at) VALUES (?,?,?,?,?,?)", clients)

# ── Client reservations (all 4 statuses) ───────────────────────────────────────
reservations = [
    # Fulfilled (past)
    (2,  5, 12.00, '2025-03-01', 'fulfilled', 'Monthly restock order.',                  '2025-03-01 09:00:00', '2025-02-20 14:00:00'),
    (6,  1,  6.00, '2025-04-12', 'fulfilled', 'Wine dinner event.',                      '2025-04-12 18:00:00', '2025-04-01 11:00:00'),
    (3, 11,  6.00, '2025-05-20', 'fulfilled', 'Champagne for private tasting.',          '2025-05-20 19:00:00', '2025-05-10 10:00:00'),
    # Partial
    (4,  4,  4.00, '2025-07-15', 'partial',   'Partially fulfilled. 2 of 4 delivered.',   '2025-07-10 10:00:00', '2025-07-01 12:00:00'),
    # Reserved (future)
    (1, 10,  6.00, '2025-08-15', 'reserved',  'Corporate gala. Dom Pérignon only.',       None,                  '2025-07-01 10:00:00'),
    (1,  1,  3.00, '2025-09-20', 'reserved',  'Wine dinner feature.',                     None,                  '2025-07-10 11:00:00'),
    (3, 10,  2.00, '2025-12-31', 'reserved',  "New Year's Eve feature.",                  None,                  '2025-07-12 16:00:00'),
    (7,  9, 24.00, '2025-08-20', 'reserved',  'Restaurant opening. Full case order.',     None,                  '2025-08-01 09:00:00'),
    # Cancelled
    (5, 15,  6.00, '2025-06-01', 'cancelled', 'Client cancelled — switched to vodka.',     None,                  '2025-05-15 09:00:00'),
]
cur.executemany("INSERT INTO client_reservations (client_id, product_id, quantity, reserved_date, status, notes, fulfilled_date, created_at) VALUES (?,?,?,?,?,?,?,?)", reservations)

# ── Calendar events (past completed + future pending) ──────────────────────────
events = [
    # Past — completed
    (None, 'New Year\'s Eve Service Prep',        'custom',     '2025-01-01', None,        None, 'Stock all premium shelves', 1, '2024-12-28 10:00:00'),
    (10,   'Valentine\'s Day Champagne Push',      'reservation','2025-02-14', None,        12,   'Dom + Moët featured',       1, '2025-02-01 09:00:00'),
    (None, 'Quarterly Inventory Audit',            'custom',     '2025-03-31', None,        None, 'Full stock count',          1, '2025-03-25 10:00:00'),
    (19,   'Craft Beer Festival',                  'reservation','2025-04-20', None,        48,   'Tap takeover + Sierra Nev.', 1, '2025-04-01 11:00:00'),
    (5,    'Summer Menu Feature Start',            'custom',     '2025-05-01', '2025-09-30', None,'Cloudy Bay spritz menu',    1, '2025-04-20 11:00:00'),
    (16,   'Scotch Tasting Night',                 'tasting',    '2025-06-14', None,        6,    'Flight night promo',         1, '2025-06-01 10:00:00'),
    (None, 'Mid-Year Inventory Audit',             'custom',     '2025-06-30', None,        None, 'Full stock count + spoilage',1, '2025-06-25 10:00:00'),
    # Future — pending
    (1,    'Margaux Restock Arriving',             'shipping',   '2025-08-01', None,        12,   'Confirm with distributor',   0, '2025-07-10 10:00:00'),
    (10,   'Dom Pérignon Tasting Event',           'tasting',    '2025-08-15', None,        6,    'VIP rooftop tasting',        0, '2025-07-01 09:00:00'),
    (15,   "Hendrick's Gin Masterclass",           'tasting',    '2025-08-20', None,        4,    'Staff training',             0, '2025-07-15 14:00:00'),
    (19,   'Oktoberfest Craft Beer Night',         'reservation','2025-09-20', None,        24,   'Tap takeover event',         0, '2025-07-20 10:00:00'),
    (23,   'New Glassware Delivery',               'delivery',   '2025-08-05', None,        4,    'Riedel restock',             0, '2025-07-18 09:00:00'),
    (22,   'Cohiba Launch Party',                  'reservation','2025-09-12', None,        10,   'Premium cigar launch',       0, '2025-07-22 16:00:00'),
    (None, "Supplier Meeting — Pacific Wines",     'purchase',   '2025-08-12', None,        None, 'Negotiate Q4 pricing',       0, '2025-07-20 09:00:00'),
    (7,    'Restaurant Opening Night',             'reservation','2025-08-20', None,        24,   'Raj Patel opening',          0, '2025-08-01 09:00:00'),
]
cur.executemany("INSERT INTO calendar_events (product_id, title, event_type, event_date, end_date, quantity, notes, is_completed, created_at) VALUES (?,?,?,?,?,?,?,?,?)", events)

# ── Product notifications ──────────────────────────────────────────────────────
notifications = [
    (1,  'low_stock',    'Margaux below 6 bottles',                         6.0,  1, '2025-07-22 09:00:00', '2025-01-15 10:00:00'),
    (2,  'low_stock',    'Grange below 4 bottles',                           4.0,  1, '2025-07-22 09:00:00', '2025-02-10 10:00:00'),
    (10, 'reorder',      'Dom Pérignon reorder when below 4',                4.0,  1, '2025-07-22 09:00:00', '2024-02-14 10:00:00'),
    (15, 'low_stock',    'Gin running low — reorder soon',                   4.0,  1, None,                  '2024-01-25 11:00:00'),
    (19, 'expiry',       'Sierra Nevada best-before check',                 30.0,  0, None,                  '2024-01-20 09:00:00'),
    (1,  'custom',       'Monitor vintage transition 2015→2016',             None, 1, None,                  '2024-06-20 11:00:00'),
    (10, 'reservation',  'Dom Pérignon reserved for NYE — confirm stock',   None, 1, None,                  '2025-07-12 16:00:00'),
    (11, 'low_stock',    'Moët below 8 bottles — consider restocking',      8.0,  1, None,                  '2024-03-01 09:00:00'),
    (20, 'expiry',       'Guinness cans approaching best-before',           24.0,  0, None,                  '2024-03-15 10:00:00'),
    (16, 'low_stock',    'Macallan below 4 bottles',                        4.0,  1, None,                  '2024-05-15 10:00:00'),
]
cur.executemany("INSERT INTO product_notifications (product_id, notification_type, message, threshold_value, is_active, last_triggered, created_at) VALUES (?,?,?,?,?,?,?)", notifications)

conn.commit()
conn.close()

print(f"✅ Test database created: {os.path.abspath(DB_PATH)}")
print(f"   Categories:  {len(categories)}")
print(f"   Products:    {len(products)}")
print(f"   Attributes:  {len(attrs)}")
print(f"   Batches:     {len(batches)} (all 6 statuses)")
print(f"   Logs:        {len(logs)}")
print(f"   Notes:       {len(notes)}")
print(f"   Clients:     {len(clients)}")
print(f"   Reservations:{len(reservations)} (all 4 statuses)")
print(f"   Events:      {len(events)} (7 completed, 8 pending)")
print(f"   Alerts:      {len(notifications)} (8 active, 2 inactive)")
