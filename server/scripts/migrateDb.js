const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const DB_PATH = path.join(__dirname, '../data/cookies.db');

// Create data directory if it doesn't exist
const dataDir = path.join(__dirname, '../data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
  console.log('📁 Created data directory');
}

const db = new sqlite3.Database(DB_PATH, (err) => {
  if (err) {
    console.error('Error opening database:', err.message);
    process.exit(1);
  } else {
    console.log('📁 Connected to SQLite database for migration');
  }
});

// Check if third_party_domain column exists
db.get("PRAGMA table_info(cookies)", (err, row) => {
  if (err) {
    console.error('Error checking table info:', err.message);
    process.exit(1);
  }
  
  // Get all columns
  db.all("PRAGMA table_info(cookies)", (err, rows) => {
    if (err) {
      console.error('Error getting table info:', err.message);
      process.exit(1);
    }
    
    const hasThirdPartyDomain = rows.some(row => row.name === 'third_party_domain');
    
    if (!hasThirdPartyDomain) {
      console.log('🔄 Adding third_party_domain column to cookies table...');
      
      db.run("ALTER TABLE cookies ADD COLUMN third_party_domain TEXT", (err) => {
        if (err) {
          console.error('Error adding column:', err.message);
          process.exit(1);
        } else {
          console.log('✅ Successfully added third_party_domain column');
          db.close((err) => {
            if (err) {
              console.error('Error closing database:', err.message);
            } else {
              console.log('📁 Database migration completed');
            }
            process.exit(0);
          });
        }
      });
    } else {
      console.log('✅ third_party_domain column already exists');
      db.close((err) => {
        if (err) {
          console.error('Error closing database:', err.message);
        } else {
          console.log('📁 No migration needed');
        }
        process.exit(0);
      });
    }
  });
});