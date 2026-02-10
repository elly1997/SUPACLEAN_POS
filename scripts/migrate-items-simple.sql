-- Simple Migration Script: Create Items Tables
-- Run this FIRST to create the tables, then we'll populate them

-- Step 1: Create Items Table
CREATE TABLE IF NOT EXISTS items (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    category TEXT NOT NULL DEFAULT 'general',
    base_price DECIMAL(10,2) NOT NULL DEFAULT 0,
    service_type TEXT NOT NULL DEFAULT 'Wash, Press & Hanged',
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Step 2: Create Branch Item Prices Table
CREATE TABLE IF NOT EXISTS branch_item_prices (
    id SERIAL PRIMARY KEY,
    branch_id INTEGER NOT NULL,
    item_id INTEGER NOT NULL,
    price DECIMAL(10,2) NOT NULL,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE CASCADE,
    UNIQUE(branch_id, item_id)
);

-- Step 3: Add foreign key to items (after items table exists)
DO $$ 
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'items') THEN
        BEGIN
            ALTER TABLE branch_item_prices 
            ADD CONSTRAINT branch_item_prices_item_id_fkey 
            FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE CASCADE;
        EXCEPTION 
            WHEN duplicate_object THEN NULL;
        END;
    END IF;
END $$;

-- Step 4: Add item_id to orders table
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'orders' AND column_name = 'item_id') THEN
        ALTER TABLE orders ADD COLUMN item_id INTEGER;
    END IF;
END $$;

-- Step 5: Add foreign key constraint for orders -> items
DO $$ 
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'items') THEN
        IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints 
                       WHERE constraint_name = 'fk_orders_item') THEN
            ALTER TABLE orders ADD CONSTRAINT fk_orders_item 
            FOREIGN KEY (item_id) REFERENCES items(id);
        END IF;
    END IF;
END $$;

-- Step 6: Create indexes
CREATE INDEX IF NOT EXISTS idx_items_category ON items(category);
CREATE INDEX IF NOT EXISTS idx_items_active ON items(is_active);
CREATE INDEX IF NOT EXISTS idx_branch_item_prices_branch ON branch_item_prices(branch_id);
CREATE INDEX IF NOT EXISTS idx_branch_item_prices_item ON branch_item_prices(item_id);
CREATE INDEX IF NOT EXISTS idx_orders_item ON orders(item_id);

-- Tables are now created! 
-- Next, add UNIQUE constraint to items.name for ON CONFLICT to work
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints 
                   WHERE constraint_name = 'items_name_unique' 
                   AND table_name = 'items') THEN
        ALTER TABLE items ADD CONSTRAINT items_name_unique UNIQUE (name);
    END IF;
END $$;

-- Now run populate-items.sql to add the data, OR continue below:

-- Populate Items: Insert all items from price list
-- Gents Items
INSERT INTO items (name, category, base_price, service_type) VALUES
('Suit 2 pcs', 'gents', 11000, 'Wash, Press & Hanged'),
('Suit 3 pcs', 'gents', 13000, 'Wash, Press & Hanged'),
('Coats', 'gents', 6000, 'Wash, Press & Hanged'),
('Velvet/Wool Coat', 'gents', 6000, 'Wash, Press & Hanged'),
('Sued Coat', 'gents', 5000, 'Wash, Press & Hanged'),
('Kaunda/Safari Suit', 'gents', 9000, 'Wash, Press & Hanged'),
('Pyjama suits', 'gents', 7000, 'Wash, Press & Hanged'),
('Trousers', 'gents', 4000, 'Wash, Press & Hanged'),
('Nigerian Suit Unstarched', 'gents', 9000, 'Wash, Press & Hanged'),
('Nigerian Suit Starched', 'gents', 11000, 'Wash, Press & Hanged'),
('Leather Jackets', 'gents', 15000, 'Wash, Press & Hanged'),
('Jackets', 'gents', 6000, 'Wash, Press & Hanged'),
('Spy Coats/Long Coat', 'gents', 7000, 'Wash, Press & Hanged'),
('Shorts', 'gents', 3000, 'Wash, Press & Hanged'),
('Shirts - Colored', 'gents', 2000, 'Wash, Press & Hanged'),
('Shirts - White', 'gents', 3000, 'Wash, Press & Hanged'),
('Pants/Boxers', 'gents', 3000, 'Wash, Press & Hanged'),
('Vests/Tie', 'gents', 1000, 'Wash, Press & Hanged'),
('Overall', 'gents', 6000, 'Wash, Press & Hanged'),
('Caps', 'gents', 2000, 'Wash, Press & Hanged'),
('Car Seat Covers', 'gents', 20000, 'Wash & Fold'),
('Curtains Standard', 'general', 5000, 'Wash, Press & Fold')
ON CONFLICT (name) DO NOTHING;

-- Ladies Items
INSERT INTO items (name, category, base_price, service_type) VALUES
('Lady Suit 2 pcs', 'ladies', 8000, 'Wash, Press & Hanged'),
('Trouser/Skirt Suit 3pcs', 'ladies', 9000, 'Wash, Press & Hanged'),
('Kitenge Suit', 'ladies', 8000, 'Wash, Press & Hanged'),
('Lady Coat', 'ladies', 5000, 'Wash, Press & Hanged'),
('Long Skirt', 'ladies', 3500, 'Wash, Press & Hanged'),
('Custom Ceremonials', 'ladies', 10000, 'Wash, Press & Hanged'),
('Tshirts', 'ladies', 3000, 'Wash, Press & Hanged'),
('Night Dress', 'ladies', 3000, 'Wash, Press & Hanged'),
('Bath robe', 'ladies', 5000, 'Wash, Press & Hanged'),
('Brassier', 'ladies', 3500, 'Wash, Press & Hanged'),
('Blouse', 'ladies', 3500, 'Wash, Press & Hanged'),
('Sweater', 'ladies', 5000, 'Wash, Press & Hanged')
ON CONFLICT (name) DO NOTHING;

-- General Items
INSERT INTO items (name, category, base_price, service_type) VALUES
('Towels - Face', 'general', 2000, 'Wash, Dry & Folded'),
('Towels - Hand', 'general', 4000, 'Wash, Dry & Folded'),
('Towels - Body', 'general', 6000, 'Wash, Dry & Folded'),
('Bed Covers King', 'general', 7000, 'Wash, Press & Fold'),
('Bed Covers Single', 'general', 5000, 'Wash, Press & Fold'),
('Bed Sheet Double', 'general', 4000, 'Wash, Press & Fold'),
('Bed Sheet Single', 'general', 3000, 'Wash, Press & Fold'),
('Duvet/Conforter Large', 'general', 10000, 'Wash & Fold'),
('Duvet/Conforter Medium', 'general', 8000, 'Wash & Fold'),
('Sleeping Bags', 'general', 8000, 'Wash & Fold'),
('Curtains Heavy', 'general', 6000, 'Wash, Press & Fold'),
('Curtains Light', 'general', 3000, 'Wash, Press & Fold'),
('Blankets', 'general', 9000, 'Wash & Fold'),
('Shoes', 'general', 3000, 'Dry Clean'),
('Carpets', 'general', 10000, 'Wash & Fold'),
('Wedding Dress standard', 'general', 25000, 'Wash, Press & Hanged'),
('Wedding Dress Large 4pc', 'general', 35000, 'Wash, Press & Hanged'),
('Kikoi', 'general', 4000, 'Wash, Press & Hanged'),
('Dollies', 'general', 5000, 'Washed Only'),
('Wash & Dry 1KG', 'general', 7000, 'Washed & Fold'),
('Wash Only 1KG', 'general', 3500, 'Washed & Fold')
ON CONFLICT (name) DO NOTHING;

-- Update Services to Delivery Types
DELETE FROM services WHERE name NOT IN ('Regular Service', 'Express Service < 8HRS', 'Express Service < 3HRS');

INSERT INTO services (name, description, base_price, price_per_item, price_per_kg, is_active) VALUES
('Regular Service', 'Standard delivery service (1x price)', 1.0, 1.0, 1.0, TRUE),
('Express Service < 8HRS', 'Same-day delivery (2x price)', 2.0, 2.0, 2.0, TRUE),
('Express Service < 3HRS', 'Urgent same-day delivery (3x price)', 3.0, 3.0, 3.0, TRUE)
ON CONFLICT (name) DO UPDATE SET
  description = EXCLUDED.description,
  base_price = EXCLUDED.base_price,
  price_per_item = EXCLUDED.price_per_item,
  price_per_kg = EXCLUDED.price_per_kg;

-- Migration Complete!
