-- Order Item Photos: Support thermal POS / camera uploads for item descriptions
-- Run against PostgreSQL (Supabase). Ensures uploads directory is used by API.

-- Table: order_item_photos
-- Links photos to orders (and optionally to specific receipt items via order_id).
-- Each order row = one line item; multiple orders can share same receipt_number.
CREATE TABLE IF NOT EXISTS order_item_photos (
    id SERIAL PRIMARY KEY,
    order_id INTEGER NOT NULL,
    branch_id INTEGER,
    file_path TEXT NOT NULL,
    file_name TEXT,
    mime_type TEXT DEFAULT 'image/jpeg',
    caption TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_by TEXT,
    FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
    FOREIGN KEY (branch_id) REFERENCES branches(id)
);

CREATE INDEX IF NOT EXISTS idx_order_item_photos_order ON order_item_photos(order_id);
CREATE INDEX IF NOT EXISTS idx_order_item_photos_branch ON order_item_photos(branch_id);
CREATE INDEX IF NOT EXISTS idx_order_item_photos_created ON order_item_photos(created_at);

-- Optional: composite for branch-scoped lookups
CREATE INDEX IF NOT EXISTS idx_order_item_photos_branch_created ON order_item_photos(branch_id, created_at);
