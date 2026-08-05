#!/usr/bin/env python3
"""Import wine inventory into Wine and Cigars.db.

Two storage sections (SIIC, SIHL). Products are keyed by 編號 (code); a code
appearing in both sections maps to the same product with one batch per section.
"""
import sqlite3
import sys

DB = "/Users/jasonleong/DBReader/Wine and Cigars.db"

SIIC = [
    (1001, "白酒", "茅台", None, 2),
    (1002, "白酒", "五糧液", None, 6),
    (1003, "白酒", "瀘州老窖", None, 5),
    (1005, "白酒", "杏花村汾酒 150", 150, 3),
    (2003, "餐酒", "白葡萄酒 Manzoni Bianco 2010", None, 20),
    (2007, "餐酒", "白葡萄酒 Moscato d'Asti DOCG 2018", 128, 48),
    (2024, "餐酒", "白葡萄酒 Josmeyer Gewurztraminer 2024", 230, 24),
    (2006, "餐酒", "白葡萄酒 Gew. Spatlese 2015", 250, 21),
    (2013, "餐酒", "白葡萄酒 Chateau Rieussec 2010", 395, 4),
    (3008, "紅酒", "Napa Valley 2011 189", None, 1),
    (3015, "紅酒", "(南煙)紅雙囍紅酒", None, 12),
    (3086, "紅酒", "Vilafonte Seriously old dirt", 198, 53),
    (3085, "紅酒", "Luis Canas, Reserva Selection de Familia", 248, 27),
    (3070, "紅酒", "Echo de Lynch Bages 2019", 269, 7),
    (3044, "紅酒", "Pichon Comtesse Reserve 2018", 295, 6),
    (3084, "紅酒", "Chateau Branaire Ducru 2021", 315, 3),
    (3047, "紅酒", "Chateau Lascombes 2017", 399, 1),
    (3064, "紅酒", "La Rioja Alta Gran Reserva 904 2011", 438, 21),
    (3074, "紅酒", "Saperavi 2020 Georgian Red Dry Wine (AG2)", 444, 10),
    (3063, "紅酒", "La Rioja Alta Gran Reserva 904 2007", 450, 3),
    (3051, "紅酒", "Les Aromes de Pavie 2016", 485, 4),
    (3078, "紅酒", "Rauzan-Segla 2019", 598, 6),
]

SIHL = [
    (1004, "白酒", "夢之藍", None, 8),
    (1006, "白酒", "杏花村汾酒(10年陳釀) 390", 390, 3),
    (2017, "餐酒", "白葡萄酒 2021 Blue Fish Gewurztraminer", 80, 4),
    (2018, "餐酒", "白葡萄酒 2021 Blue Fish Pinot Grigio", 80, 2),
    (2026, "餐酒", "白葡萄酒 Black Canvas Abstract Three Rows 2023", 270, 12),
    (2008, "餐酒", "白葡萄酒 Chateau Talbot Caillou Blanc 2019", 288, 8),
    (2027, "餐酒", "白葡萄酒 Black Canvas Reed Chardonnay 2023", 300, 12),
    (3086, "紅酒", "Vilafonte Seriously old dirt", 198, 46),
    (3077, "紅酒", "Tenuta San Guido Guidalberto 2021", 255, 2),
    (3035, "紅酒", "Les Griffons de Pichon Baron 2017", 295, 4),
    (3067, "紅酒", "Chateau Lascombes 2018", 398, 4),
    (3079, "紅酒", "Chateau Lascombes 2016", 410, 7),
    (3064, "紅酒", "La Rioja Alta Gran Reserva 904 2011", 438, 22),
    (3043, "紅酒", "Chateau Lascombes 2014", 440, 5),
    (3014, "紅酒", "Penfolds BIN389 2018", 399, 3),
    (3041, "紅酒", "Penfolds BIN798 2018", 780, 6),
    (3073, "紅酒", "Kapistoni 2019 Georgian Qvevri Red Dry Wine (KA1)", 433, 8),
    (3048, "紅酒", "Chateau Leoville Barton 2017", 540, 2),
    (3053, "紅酒", "Chateau Leoville Poyferre 2017", 545, 9),
    (3045, "紅酒", "Les Aromes de Pavie 2015", 535, 2),
    (3076, "紅酒", "Saperavi 17 month with Skin contact Red Dry Wine", 550, 2),
    (3027, "紅酒", "Pauillac de Latour 2015", 590, 5),
    (3036, "紅酒", "Pauillac de Latour 2007", 688, 5),
    (3071, "紅酒", "Sena 2017", 599, 10),
    (3083, "紅酒", "Chateau Pontet-Canet 2006", 600, 2),
    (3040, "紅酒", "Sena 2009", 795, 14),
    (4001, "洋酒", "威士忌 The Macallan 12 Yrs Triple Cask Oak", 440, 7),
]

PURCHASE_DATE = "2026-07-14"


def main():
    conn = sqlite3.connect(DB)
    cur = conn.cursor()

    def get_cat(name):
        cur.execute("SELECT id FROM categories WHERE name = ?", (name,))
        row = cur.fetchone()
        if row:
            return row[0]
        cur.execute("INSERT INTO categories (name, description, icon, color) VALUES (?, ?, ?, ?)",
                    (name, None, "🍷", "#7f1d1d"))
        return cur.lastrowid

    def get_loc(name):
        cur.execute("SELECT id FROM locations WHERE name = ?", (name,))
        row = cur.fetchone()
        if row:
            return row[0]
        cur.execute("INSERT INTO locations (name, sub_location) VALUES (?, NULL)", (name,))
        return cur.lastrowid

    def get_product(code, name, cat_id):
        cur.execute("SELECT id FROM products WHERE sku = ?", (str(code),))
        row = cur.fetchone()
        if row:
            cur.execute("UPDATE products SET category_id = ?, name = ? WHERE id = ?",
                        (cat_id, name, row[0]))
            return row[0]
        cur.execute("INSERT INTO products (category_id, name, sku, base_unit_name, reorder_threshold) VALUES (?, ?, ?, '支', 0)",
                    (cat_id, name, str(code)))
        return cur.lastrowid

    loc_siic = get_loc("SIIC")
    loc_sihl = get_loc("SIHL")

    t = 0
    for section, rows, loc in [("SIIC", SIIC, loc_siic), ("SIHL", SIHL, loc_sihl)]:
        for code, cat, name, price, stock in rows:
            cat_id = get_cat(cat)
            pid = get_product(code, name, cat_id)
            cost = price if price is not None else 0
            cur.execute(
                "INSERT INTO batches (product_id, batch_number, supplier_name, unit_cost_price, purchase_date, status, notes) "
                "VALUES (?, NULL, NULL, ?, ?, 'in_inventory', NULL)",
                (pid, cost, PURCHASE_DATE))
            batch_id = cur.lastrowid
            cur.execute(
                "INSERT INTO inventory_logs (batch_id, location_id, quantity_change, transaction_type, notes, created_at) "
                "VALUES (?, ?, ?, 'PURCHASE', NULL, ?)",
                (batch_id, loc, stock, f"{PURCHASE_DATE} 12:00:{t % 60:02d}"))
            t += 1
            print(f"{section}: {code} {cat} {name} x{stock} @{cost}")

    conn.commit()
    cur.execute("SELECT COUNT(*) FROM products")
    n_products = cur.fetchone()[0]
    cur.execute("SELECT COUNT(*) FROM batches")
    n_batches = cur.fetchone()[0]
    cur.execute("SELECT COUNT(*) FROM inventory_logs")
    n_logs = cur.fetchone()[0]
    print(f"\nDone: products={n_products}, batches={n_batches}, logs={n_logs}")
    conn.close()


if __name__ == "__main__":
    sys.exit(main())
