-- Sample shop schema + data (SQLite dialect)
CREATE TABLE customers (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT UNIQUE,
  country TEXT DEFAULT 'US'
);

CREATE TABLE orders (
  id INTEGER PRIMARY KEY,
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  total REAL NOT NULL,
  placed_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_orders_customer ON orders(customer_id);

INSERT INTO customers (name, email, country) VALUES
  ('Ada Lovelace', 'ada@example.com', 'UK'),
  ('Alan Turing', 'alan@example.com', 'UK'),
  ('Grace Hopper', 'grace@example.com', 'US');

INSERT INTO orders (customer_id, total) VALUES (1, 120.50), (1, 39.99), (2, 15.00), (3, 999.00);

CREATE VIEW customer_totals AS
SELECT c.name, count(o.id) AS orders, round(sum(o.total), 2) AS spent
FROM customers c LEFT JOIN orders o ON o.customer_id = c.id
GROUP BY c.id ORDER BY spent DESC;

SELECT * FROM customer_totals;
