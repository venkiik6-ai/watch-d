import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import pg from "pg";
import dotenv from "dotenv";

dotenv.config();

const { Pool } = pg;

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: '10mb' }));

  // Database Setup
  const dbUrl = process.env.DATABASE_URL;
  const isDbConfigured = !!dbUrl && !dbUrl.includes('localhost');
  const isCloudSql = dbUrl?.includes('/cloudsql/');

  const pool = new Pool({
    connectionString: dbUrl,
    ssl: (dbUrl?.includes('render.com') || dbUrl?.includes('elephantsql.com') || dbUrl?.includes('supabase.co') || dbUrl?.includes('a0.pg.neon.tech')) && !isCloudSql
      ? { rejectUnauthorized: false } 
      : false
  });

  // Initialize Database
  if (isDbConfigured) {
    try {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS watch_cache (
          normalized_name TEXT PRIMARY KEY,
          brand TEXT NOT NULL,
          model TEXT NOT NULL,
          battery TEXT NOT NULL,
          quantity INTEGER NOT NULL,
          functions TEXT,
          speciality TEXT,
          strap_size TEXT,
          dial_size TEXT,
          strap_material TEXT,
          purchase_link TEXT,
          estimated_price TEXT,
          estimated_price_inr TEXT,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        );
        
        CREATE TABLE IF NOT EXISTS watch_scans (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          brand TEXT NOT NULL,
          model TEXT NOT NULL,
          normalized_name TEXT NOT NULL,
          confidence TEXT NOT NULL,
          battery TEXT NOT NULL,
          quantity INTEGER NOT NULL,
          functions TEXT,
          speciality TEXT,
          strap_size TEXT,
          dial_size TEXT,
          strap_material TEXT,
          purchase_link TEXT,
          estimated_price TEXT,
          estimated_price_inr TEXT,
          image_data TEXT,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        );

        -- Migrations for existing tables
        DO $$ 
        BEGIN 
          IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='watch_cache' AND column_name='strap_size') THEN
            ALTER TABLE watch_cache ADD COLUMN strap_size TEXT;
            ALTER TABLE watch_cache ADD COLUMN dial_size TEXT;
            ALTER TABLE watch_cache ADD COLUMN strap_material TEXT;
          END IF;

          IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='watch_scans' AND column_name='strap_size') THEN
            ALTER TABLE watch_scans ADD COLUMN strap_size TEXT;
            ALTER TABLE watch_scans ADD COLUMN dial_size TEXT;
            ALTER TABLE watch_scans ADD COLUMN strap_material TEXT;
          END IF;

          IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='watch_cache' AND column_name='functions') THEN
            ALTER TABLE watch_cache ADD COLUMN functions TEXT;
            ALTER TABLE watch_cache ADD COLUMN speciality TEXT;
            ALTER TABLE watch_cache ADD COLUMN purchase_link TEXT;
            ALTER TABLE watch_cache ADD COLUMN estimated_price TEXT;
            ALTER TABLE watch_cache ADD COLUMN estimated_price_inr TEXT;
          END IF;

          IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='watch_scans' AND column_name='functions') THEN
            ALTER TABLE watch_scans ADD COLUMN functions TEXT;
            ALTER TABLE watch_scans ADD COLUMN speciality TEXT;
            ALTER TABLE watch_scans ADD COLUMN purchase_link TEXT;
            ALTER TABLE watch_scans ADD COLUMN estimated_price TEXT;
            ALTER TABLE watch_scans ADD COLUMN estimated_price_inr TEXT;
          END IF;
        END $$;
      `);
      console.log("Database initialized successfully");
    } catch (err) {
      console.error("Database initialization failed. Ensure your DATABASE_URL is correct and the database is accessible.", err);
    }
  } else {
    console.warn("DATABASE_URL is not configured or pointing to localhost. Database features will be disabled. Please set a valid DATABASE_URL in the Secrets panel.");
  }

  // Middleware to check DB connectivity
  const checkDb = (req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (!isDbConfigured) {
      return res.status(503).json({ 
        error: "Database not configured", 
        details: "Please provide a valid DATABASE_URL (e.g., from Supabase, Neon, or Render) in the Secrets panel to enable persistence and caching." 
      });
    }
    next();
  };

  // API Routes
  app.get("/api/db-status", (req, res) => {
    res.json({ 
      configured: isDbConfigured,
      message: isDbConfigured ? "Database is configured" : "Database is not configured. Using local session mode."
    });
  });

  app.get("/api/cache/:name", checkDb, async (req, res) => {
    const { name } = req.params;
    try {
      const result = await pool.query("SELECT * FROM watch_cache WHERE normalized_name = $1", [name]);
      if (result.rows.length > 0) {
        const row = result.rows[0];
        // Parse functions if it's a string
        if (row.functions && typeof row.functions === 'string') {
          try {
            row.functions = JSON.parse(row.functions);
          } catch (e) {
            row.functions = row.functions.split(',').map((s: string) => s.trim());
          }
        }
        res.json(row);
      } else {
        res.status(404).json({ error: "Not found in cache" });
      }
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Database error" });
    }
  });

  app.post("/api/cache", checkDb, async (req, res) => {
    const { brand, model, normalized_name, battery, quantity, functions, speciality, strap_size, dial_size, strap_material, purchase_link, estimated_price, estimated_price_inr } = req.body;
    try {
      const functionsStr = Array.isArray(functions) ? JSON.stringify(functions) : functions;
      const result = await pool.query(
        `INSERT INTO watch_cache (brand, model, normalized_name, battery, quantity, functions, speciality, strap_size, dial_size, strap_material, purchase_link, estimated_price, estimated_price_inr) 
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) 
         ON CONFLICT (normalized_name) DO UPDATE SET 
          battery = EXCLUDED.battery, 
          quantity = EXCLUDED.quantity,
          functions = EXCLUDED.functions,
          speciality = EXCLUDED.speciality,
          strap_size = EXCLUDED.strap_size,
          dial_size = EXCLUDED.dial_size,
          strap_material = EXCLUDED.strap_material,
          purchase_link = EXCLUDED.purchase_link,
          estimated_price = EXCLUDED.estimated_price,
          estimated_price_inr = EXCLUDED.estimated_price_inr
         RETURNING *`,
        [brand, model, normalized_name, battery, quantity, functionsStr, speciality, strap_size, dial_size, strap_material, purchase_link, estimated_price, estimated_price_inr]
      );
      res.status(201).json(result.rows[0]);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to cache watch data" });
    }
  });

  app.get("/api/history", checkDb, async (req, res) => {
    try {
      const result = await pool.query("SELECT * FROM watch_scans ORDER BY created_at DESC LIMIT 50");
      const rows = result.rows.map(row => {
        if (row.functions && typeof row.functions === 'string') {
          try {
            row.functions = JSON.parse(row.functions);
          } catch (e) {
            row.functions = row.functions.split(',').map((s: string) => s.trim());
          }
        }
        return row;
      });
      res.json(rows);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to fetch history" });
    }
  });

  app.post("/api/scans", checkDb, async (req, res) => {
    const { brand, model, normalized_name, confidence, battery, quantity, functions, speciality, strap_size, dial_size, strap_material, purchase_link, estimated_price, estimated_price_inr, image } = req.body;
    try {
      const functionsStr = Array.isArray(functions) ? JSON.stringify(functions) : functions;
      const result = await pool.query(
        `INSERT INTO watch_scans (brand, model, normalized_name, confidence, battery, quantity, functions, speciality, strap_size, dial_size, strap_material, purchase_link, estimated_price, estimated_price_inr, image_data) 
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15) RETURNING *`,
        [brand, model, normalized_name, confidence, battery, quantity, functionsStr, speciality, strap_size, dial_size, strap_material, purchase_link, estimated_price, estimated_price_inr, image]
      );
      res.status(201).json(result.rows[0]);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to save scan" });
    }
  });

  app.delete("/api/history", checkDb, async (req, res) => {
    try {
      await pool.query("DELETE FROM watch_scans");
      res.json({ message: "History cleared" });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to clear history" });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
