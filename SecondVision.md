+------------------+         +--------------------------+
|    categories    |<--------|         products         |
+------------------+         +--------------------------+
| id (PK)                  |
| name, sku, category_id   |
| reorder_threshold        |
| base_unit_name           |
+--------------------------+
|            |        |
+-----------------------+            |        +-----------------------+
|                                    |                                |
v                                    v                                v
+--------------------------+     +--------------------------+     +--------------------------+
|    product_attributes    |     |     unit_conversions     |     |         batches          |
+--------------------------+     +--------------------------+     +--------------------------+
| id (PK)                  |     | id (PK)                  |     | id (PK)                  |
| product_id (FK)          |     | product_id (FK)          |     | product_id (FK)          |
| attr_key                 |     | unit_name ("Case")       |     | batch_number             |
| attr_value               |     | conversion_factor (12)   |     | unit_cost_price          |
| data_type                |     +--------------------------+     | purchase_date, supplier  |
+--------------------------+                                      +--------------------------+
|
v
+--------------------------+
|      inventory_logs      |
+--------------------------+
| id (PK)                  |
| batch_id (FK)            |
| location_id (FK)         |
| quantity_change (+/-)    |
| transaction_type         |
| created_at               |
+--------------------------+

---

## 🗄️ Detailed Table Specifications

### 1. `categories`
Stores product categories and sub-categories.

| Column | Data Type | Constraints | Description |
| :--- | :--- | :--- | :--- |
| `id` | `UUID / INT` | `PRIMARY KEY` | Unique category identifier |
| `name` | `VARCHAR(100)` | `NOT NULL, UNIQUE` | Category name (e.g., "Wine", "Electronics") |
| `parent_id` | `UUID / INT` | `FOREIGN KEY (categories.id), NULL` | Enables hierarchical categories |

---

### 2. `products`
Master definition of distinct items in stock.

| Column | Data Type | Constraints | Description |
| :--- | :--- | :--- | :--- |
| `id` | `UUID / INT` | `PRIMARY KEY` | Unique product identifier |
| `category_id` | `UUID / INT` | `FOREIGN KEY (categories.id)` | Link to category |
| `name` | `VARCHAR(255)` | `NOT NULL` | Full product name |
| `sku` | `VARCHAR(100)` | `UNIQUE, NULL` | Barcode, UPC, or internal stock unit |
| `base_unit_name` | `VARCHAR(50)` | `NOT NULL` | Primary unit of measure (e.g., "bottle", "piece") |
| `reorder_threshold` | `NUMERIC(10, 2)` | `DEFAULT 0` | Alert threshold for low stock |
| `created_at` | `TIMESTAMP` | `DEFAULT CURRENT_TIMESTAMP` | Record creation date |

---

### 3. `product_attributes`
Flexible key-value store for item-specific attributes.

| Column | Data Type | Constraints | Description |
| :--- | :--- | :--- | :--- |
| `id` | `UUID / INT` | `PRIMARY KEY` | Unique attribute ID |
| `product_id` | `UUID / INT` | `FOREIGN KEY (products.id) ON DELETE CASCADE` | Link to product |
| `attr_key` | `VARCHAR(100)` | `NOT NULL` | Attribute name (e.g., "Vintage", "ABV", "Expiration Date") |
| `attr_value` | `TEXT` | `NOT NULL` | Value (e.g., "2018", "13.5%", "2027-12-31") |
| `data_type` | `VARCHAR(20)` | `DEFAULT 'string'` | Type hint (`string`, `number`, `date`, `boolean`) |

---

### 4. `unit_conversions`
Handles package size mappings to base units (e.g., 1 Box = 12 Bottles).

| Column | Data Type | Constraints | Description |
| :--- | :--- | :--- | :--- |
| `id` | `UUID / INT` | `PRIMARY KEY` | Unique conversion ID |
| `product_id` | `UUID / INT` | `FOREIGN KEY (products.id) ON DELETE CASCADE` | Link to product |
| `unit_name` | `VARCHAR(50)` | `NOT NULL` | Packaging name (e.g., "Box", "Case", "Pack") |
| `conversion_factor` | `NUMERIC(10, 2)` | `NOT NULL` | Number of base units in this package (e.g., 12) |

---

### 5. `locations`
Storage physical areas (cellars, shelves, warehouses).

| Column | Data Type | Constraints | Description |
| :--- | :--- | :--- | :--- |
| `id` | `UUID / INT` | `PRIMARY KEY` | Location ID |
| `name` | `VARCHAR(100)` | `NOT NULL` | Area identifier (e.g., "Cellar A", "Warehouse 2") |
| `sub_location` | `VARCHAR(100)` | `NULL` | Specific rack/shelf (e.g., "Rack 4, Shelf B") |

---

### 6. `batches`
Tracks specific purchases, lots, and unit acquisition costs over time.

| Column | Data Type | Constraints | Description |
| :--- | :--- | :--- | :--- |
| `id` | `UUID / INT` | `PRIMARY KEY` | Batch ID |
| `product_id` | `UUID / INT` | `FOREIGN KEY (products.id)` | Link to product |
| `batch_number` | `VARCHAR(100)` | `NULL` | Lot/Batch code from supplier |
| `supplier_name` | `VARCHAR(255)` | `NULL` | Vendor or supplier name |
| `unit_cost_price` | `NUMERIC(12, 2)` | `NOT NULL` | Purchase price per base unit in this batch |
| `purchase_date` | `DATE` | `NOT NULL` | Date batch was acquired |
| `notes` | `TEXT` | `NULL` | Optional batch comments |

---

### 7. `inventory_logs`
The event ledger. All stock changes are written as individual row entries.

| Column | Data Type | Constraints | Description |
| :--- | :--- | :--- | :--- |
| `id` | `UUID / INT` | `PRIMARY KEY` | Transaction log ID |
| `batch_id` | `UUID / INT` | `FOREIGN KEY (batches.id)` | Source batch for this stock item |
| `location_id` | `UUID / INT` | `FOREIGN KEY (locations.id)` | Storage location |
| `quantity_change` | `NUMERIC(10, 2)` | `NOT NULL` | Pos (+) for incoming stock, Neg (-) for consumption |
| `transaction_type` | `VARCHAR(50)` | `NOT NULL` | Type (`PURCHASE`, `USAGE`, `SPOILAGE`, `ADJUSTMENT`) |
| `notes` | `TEXT` | `NULL` | Context (e.g., "Opened for dinner", "Broken bottle") |
| `created_at` | `TIMESTAMP` | `DEFAULT CURRENT_TIMESTAMP` | Timestamp of action |

---

## 💻 SQL DDL Implementation (PostgreSQL / SQLite Compatible)

```sql
-- Categories Table
CREATE TABLE categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name VARCHAR(100) NOT NULL UNIQUE,
    parent_id INTEGER REFERENCES categories(id) ON DELETE SET NULL
);

-- Products Table
CREATE TABLE products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    category_id INTEGER REFERENCES categories(id),
    name VARCHAR(255) NOT NULL,
    sku VARCHAR(100) UNIQUE,
    base_unit_name VARCHAR(50) NOT NULL DEFAULT 'unit',
    reorder_threshold NUMERIC(10, 2) DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Dynamic Attributes Table (EAV Pattern)
CREATE TABLE product_attributes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    attr_key VARCHAR(100) NOT NULL,
    attr_value TEXT NOT NULL,
    data_type VARCHAR(20) DEFAULT 'string'
);

-- Unit Conversions Table
CREATE TABLE unit_conversions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    unit_name VARCHAR(50) NOT NULL,
    conversion_factor NUMERIC(10, 2) NOT NULL
);

-- Storage Locations
CREATE TABLE locations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name VARCHAR(100) NOT NULL,
    sub_location VARCHAR(100)
);

-- Batches / Purchases
CREATE TABLE batches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL REFERENCES products(id),
    batch_number VARCHAR(100),
    supplier_name VARCHAR(255),
    unit_cost_price NUMERIC(12, 2) NOT NULL,
    purchase_date DATE NOT NULL,
    notes TEXT
);

-- Inventory Transaction Logs Ledger
CREATE TABLE inventory_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    batch_id INTEGER NOT NULL REFERENCES batches(id),
    location_id INTEGER REFERENCES locations(id),
    quantity_change NUMERIC(10, 2) NOT NULL,
    transaction_type VARCHAR(50) NOT NULL CHECK (transaction_type IN ('PURCHASE', 'USAGE', 'SPOILAGE', 'ADJUSTMENT')),
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for Query Optimization
CREATE INDEX idx_products_sku ON products(sku);
CREATE INDEX idx_attributes_product ON product_attributes(product_id);
CREATE INDEX idx_batches_product_date ON batches(product_id, purchase_date DESC);
CREATE INDEX idx_logs_batch ON inventory_logs(batch_id);

⚡ Useful Query Patterns
1. Calculate Current Stock Level for a Product
SELECT 
    p.id AS product_id,
    p.name AS product_name,
    COALESCE(SUM(l.quantity_change), 0) AS total_stock,
    p.base_unit_name
FROM products p
JOIN batches b ON b.product_id = p.id
JOIN inventory_logs l ON l.batch_id = b.id
WHERE p.id = :product_id
GROUP BY p.id, p.name, p.base_unit_name;

2. Identify Low Stock Items Triggering Reorder Threshold
SELECT 
    p.id,
    p.name,
    COALESCE(SUM(l.quantity_change), 0) AS current_stock,
    p.reorder_threshold,
    p.base_unit_name
FROM products p
LEFT JOIN batches b ON b.product_id = p.id
LEFT JOIN inventory_logs l ON l.batch_id = b.id
GROUP BY p.id, p.name, p.reorder_threshold, p.base_unit_name
HAVING COALESCE(SUM(l.quantity_change), 0) <= p.reorder_threshold;

3. Fetch Price of Last Purchased Batch for a Brand/Product
SELECT 
    p.name AS product_name,
    b.unit_cost_price,
    b.purchase_date,
    b.supplier_name
FROM batches b
JOIN products p ON p.id = b.product_id
WHERE p.id = :product_id
ORDER BY b.purchase_date DESC
LIMIT 1;

4. Record Action: "Used 3 bottles of Wine"
-- Step 1: Identify active batch ID (e.g., batch 42)
INSERT INTO inventory_logs (batch_id, location_id, quantity_change, transaction_type, notes)
VALUES (42, 1, -3.00, 'USAGE', 'Consumed at dinner');

5. Record Action: "Restocked 1 Case (12 bottles) at $15/bottle"
-- Step 1: Insert new batch record
INSERT INTO batches (product_id, supplier_name, unit_cost_price, purchase_date)
VALUES (101, 'Grand Cru Distributors', 15.00, CURRENT_DATE);

-- Step 2: Insert inventory addition log (using batch ID created above)
INSERT INTO inventory_logs (batch_id, location_id, quantity_change, transaction_type, notes)
VALUES (LAST_INSERT_ROWID(), 1, 12.00, 'PURCHASE', 'Added 1 case of 12');

"""
with open("inventory_schema.md", "w", encoding="utf-8") as f:
f.write(schema_md)
print("FILE_GENERATED: inventory_schema.md")
Your Markdown schema document is ready:
[file-tag: code-generated-file-0-1784896833991223673]

Here is a preview of the full database schema design, formatted in Markdown for your inventory management application:

---

# Inventory Management System Database Schema Specification

This specification outlines a flexible, event-driven relational database schema designed to track diverse inventory types (e.g., wine, electronics, perishable goods, office supplies) without requiring rigid or product-specific table columns.

---

## 🏛️ System Architecture Overview

The database uses a hybrid approach:
1. **Core Product Catalog:** Standard metadata shared across all items.
2. **Entity-Attribute-Value (EAV) Model:** Dynamic key-value pairs for item-specific attributes (e.g., *Vintage*, *ABV*, *Expiration Date*, *Battery Size*).
3. **Batch/Lot Tracking:** Financial and cost history attached to specific purchase orders.
4. **Event-Driven Inventory Ledger:** Immutable transaction logs (`+` for stock additions, `-` for stock consumption) instead of mutable stock count fields.

---

## 📐 Entity-Relationship Overview


+------------------+         +--------------------------+
|    categories    |<--------|         products         |
+------------------+         +--------------------------+
| id (PK)                  |
| name, sku, category_id   |
| reorder_threshold        |
| base_unit_name           |
+--------------------------+
|            |        |
+-----------------------+            |        +-----------------------+
|                                    |                                |
v                                    v                                v
+--------------------------+     +--------------------------+     +--------------------------+
|    product_attributes    |     |     unit_conversions     |     |         batches          |
+--------------------------+     +--------------------------+     +--------------------------+
| id (PK)                  |     | id (PK)                  |     | id (PK)                  |
| product_id (FK)          |     | product_id (FK)          |     | product_id (FK)          |
| attr_key                 |     | unit_name ("Case")       |     | batch_number             |
| attr_value               |     | conversion_factor (12)   |     | unit_cost_price          |
| data_type                |     +--------------------------+     | purchase_date, supplier  |
+--------------------------+                                      +--------------------------+
|
v
+--------------------------+
|      inventory_logs      |
+--------------------------+
| id (PK)                  |
| batch_id (FK)            |
| location_id (FK)         |
| quantity_change (+/-)    |
| transaction_type         |
| created_at               |
+--------------------------+

---

## 🗄️ Detailed Table Specifications

### 1. `categories`
Stores product categories and sub-categories.

| Column | Data Type | Constraints | Description |
| :--- | :--- | :--- | :--- |
| `id` | `UUID / INT` | `PRIMARY KEY` | Unique category identifier |
| `name` | `VARCHAR(100)` | `NOT NULL, UNIQUE` | Category name (e.g., "Wine", "Electronics") |
| `parent_id` | `UUID / INT` | `FOREIGN KEY (categories.id), NULL` | Enables hierarchical categories |

---

### 2. `products`
Master definition of distinct items in stock.

| Column | Data Type | Constraints | Description |
| :--- | :--- | :--- | :--- |
| `id` | `UUID / INT` | `PRIMARY KEY` | Unique product identifier |
| `category_id` | `UUID / INT` | `FOREIGN KEY (categories.id)` | Link to category |
| `name` | `VARCHAR(255)` | `NOT NULL` | Full product name |
| `sku` | `VARCHAR(100)` | `UNIQUE, NULL` | Barcode, UPC, or internal stock unit |
| `base_unit_name` | `VARCHAR(50)` | `NOT NULL` | Primary unit of measure (e.g., "bottle", "piece") |
| `reorder_threshold` | `NUMERIC(10, 2)` | `DEFAULT 0` | Alert threshold for low stock |
| `created_at` | `TIMESTAMP` | `DEFAULT CURRENT_TIMESTAMP` | Record creation date |

---

### 3. `product_attributes`
Flexible key-value store for item-specific attributes.

| Column | Data Type | Constraints | Description |
| :--- | :--- | :--- | :--- |
| `id` | `UUID / INT` | `PRIMARY KEY` | Unique attribute ID |
| `product_id` | `UUID / INT` | `FOREIGN KEY (products.id) ON DELETE CASCADE` | Link to product |
| `attr_key` | `VARCHAR(100)` | `NOT NULL` | Attribute name (e.g., "Vintage", "ABV", "Expiration Date") |
| `attr_value` | `TEXT` | `NOT NULL` | Value (e.g., "2018", "13.5%", "2027-12-31") |
| `data_type` | `VARCHAR(20)` | `DEFAULT 'string'` | Type hint (`string`, `number`, `date`, `boolean`) |

---

### 4. `unit_conversions`
Handles package size mappings to base units (e.g., 1 Box = 12 Bottles).

| Column | Data Type | Constraints | Description |
| :--- | :--- | :--- | :--- |
| `id` | `UUID / INT` | `PRIMARY KEY` | Unique conversion ID |
| `product_id` | `UUID / INT` | `FOREIGN KEY (products.id) ON DELETE CASCADE` | Link to product |
| `unit_name` | `VARCHAR(50)` | `NOT NULL` | Packaging name (e.g., "Box", "Case", "Pack") |
| `conversion_factor` | `NUMERIC(10, 2)` | `NOT NULL` | Number of base units in this package (e.g., 12) |

---

### 5. `locations`
Storage physical areas (cellars, shelves, warehouses).

| Column | Data Type | Constraints | Description |
| :--- | :--- | :--- | :--- |
| `id` | `UUID / INT` | `PRIMARY KEY` | Location ID |
| `name` | `VARCHAR(100)` | `NOT NULL` | Area identifier (e.g., "Cellar A", "Warehouse 2") |
| `sub_location` | `VARCHAR(100)` | `NULL` | Specific rack/shelf (e.g., "Rack 4, Shelf B") |

---

### 6. `batches`
Tracks specific purchases, lots, and unit acquisition costs over time.

| Column | Data Type | Constraints | Description |
| :--- | :--- | :--- | :--- |
| `id` | `UUID / INT` | `PRIMARY KEY` | Batch ID |
| `product_id` | `UUID / INT` | `FOREIGN KEY (products.id)` | Link to product |
| `batch_number` | `VARCHAR(100)` | `NULL` | Lot/Batch code from supplier |
| `supplier_name` | `VARCHAR(255)` | `NULL` | Vendor or supplier name |
| `unit_cost_price` | `NUMERIC(12, 2)` | `NOT NULL` | Purchase price per base unit in this batch |
| `purchase_date` | `DATE` | `NOT NULL` | Date batch was acquired |
| `notes` | `TEXT` | `NULL` | Optional batch comments |

---

### 7. `inventory_logs`
The event ledger. All stock changes are written as individual row entries.

| Column | Data Type | Constraints | Description |
| :--- | :--- | :--- | :--- |
| `id` | `UUID / INT` | `PRIMARY KEY` | Transaction log ID |
| `batch_id` | `UUID / INT` | `FOREIGN KEY (batches.id)` | Source batch for this stock item |
| `location_id` | `UUID / INT` | `FOREIGN KEY (locations.id)` | Storage location |
| `quantity_change` | `NUMERIC(10, 2)` | `NOT NULL` | Pos (+) for incoming stock, Neg (-) for consumption |
| `transaction_type` | `VARCHAR(50)` | `NOT NULL` | Type (`PURCHASE`, `USAGE`, `SPOILAGE`, `ADJUSTMENT`) |
| `notes` | `TEXT` | `NULL` | Context (e.g., "Opened for dinner", "Broken bottle") |
| `created_at` | `TIMESTAMP` | `DEFAULT CURRENT_TIMESTAMP` | Timestamp of action |

---

## 💻 SQL DDL Implementation (PostgreSQL / SQLite Compatible)

```sql
-- Categories Table
CREATE TABLE categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name VARCHAR(100) NOT NULL UNIQUE,
    parent_id INTEGER REFERENCES categories(id) ON DELETE SET NULL
);

-- Products Table
CREATE TABLE products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    category_id INTEGER REFERENCES categories(id),
    name VARCHAR(255) NOT NULL,
    sku VARCHAR(100) UNIQUE,
    base_unit_name VARCHAR(50) NOT NULL DEFAULT 'unit',
    reorder_threshold NUMERIC(10, 2) DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Dynamic Attributes Table (EAV Pattern)
CREATE TABLE product_attributes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    attr_key VARCHAR(100) NOT NULL,
    attr_value TEXT NOT NULL,
    data_type VARCHAR(20) DEFAULT 'string'
);

-- Unit Conversions Table
CREATE TABLE unit_conversions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    unit_name VARCHAR(50) NOT NULL,
    conversion_factor NUMERIC(10, 2) NOT NULL
);

-- Storage Locations
CREATE TABLE locations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name VARCHAR(100) NOT NULL,
    sub_location VARCHAR(100)
);

-- Batches / Purchases
CREATE TABLE batches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL REFERENCES products(id),
    batch_number VARCHAR(100),
    supplier_name VARCHAR(255),
    unit_cost_price NUMERIC(12, 2) NOT NULL,
    purchase_date DATE NOT NULL,
    notes TEXT
);

-- Inventory Transaction Logs Ledger
CREATE TABLE inventory_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    batch_id INTEGER NOT NULL REFERENCES batches(id),
    location_id INTEGER REFERENCES locations(id),
    quantity_change NUMERIC(10, 2) NOT NULL,
    transaction_type VARCHAR(50) NOT NULL CHECK (transaction_type IN ('PURCHASE', 'USAGE', 'SPOILAGE', 'ADJUSTMENT')),
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for Query Optimization
CREATE INDEX idx_products_sku ON products(sku);
CREATE INDEX idx_attributes_product ON product_attributes(product_id);
CREATE INDEX idx_batches_product_date ON batches(product_id, purchase_date DESC);
CREATE INDEX idx_logs_batch ON inventory_logs(batch_id);

⚡ Key Application Queries
1. Calculate Current Stock Level for a Product
SELECT 
    p.id AS product_id,
    p.name AS product_name,
    COALESCE(SUM(l.quantity_change), 0) AS total_stock,
    p.base_unit_name
FROM products p
JOIN batches b ON b.product_id = p.id
JOIN inventory_logs l ON l.batch_id = b.id
WHERE p.id = :product_id
GROUP BY p.id, p.name, p.base_unit_name;

2. Identify Low Stock Items Triggering Reorder Threshold
SELECT 
    p.id,
    p.name,
    COALESCE(SUM(l.quantity_change), 0) AS current_stock,
    p.reorder_threshold,
    p.base_unit_name
FROM products p
LEFT JOIN batches b ON b.product_id = p.id
LEFT JOIN inventory_logs l ON l.batch_id = b.id
GROUP BY p.id, p.name, p.reorder_threshold, p.base_unit_name
HAVING COALESCE(SUM(l.quantity_change), 0) <= p.reorder_threshold;

3. Fetch Price of Last Purchased Batch
SELECT 
    p.name AS product_name,
    b.unit_cost_price,
    b.purchase_date,
    b.supplier_name
FROM batches b
JOIN products p ON p.id = b.product_id
WHERE p.id = :product_id
ORDER BY b.purchase_date DESC
LIMIT 1;