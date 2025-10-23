const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const DB_PATH = path.join(__dirname, '../data/cookies.db');

console.log('🧹 Cleaning database...');

if (fs.existsSync(DB_PATH)) {
  const db = new sqlite3.Database(DB_PATH, (err) => {
    if (err) {
      console.error('Error opening database:', err.message);
      process.exit(1);
    } else {
      console.log('📁 Connected to SQLite database for cleaning');
    }
  });

  // Clear all tables
  db.serialize(() => {
    db.run("DELETE FROM cookies", (err) => {
      if (err) {
        console.warn('Error clearing cookies table:', err.message);
      } else {
        console.log('🗑️  Cleared cookies table');
      }
    });

    db.run("DELETE FROM scans", (err) => {
      if (err) {
        console.warn('Error clearing scans table:', err.message);
      } else {
        console.log('🗑️  Cleared scans table');
      }
    });

    db.run("DELETE FROM trackers", (err) => {
      if (err) {
        console.warn('Error clearing trackers table:', err.message);
      } else {
        console.log('🗑️  Cleared trackers table');
      }
    });

    // Reset auto-increment counters
    db.run("DELETE FROM sqlite_sequence", (err) => {
      if (err) {
        console.warn('Error resetting auto-increment counters:', err.message);
      } else {
        console.log('🔄 Reset auto-increment counters');
      }
    });

    db.close((err) => {
      if (err) {
        console.error('Error closing database:', err.message);
      } else {
        console.log('✅ Database cleaned successfully');
      }
      process.exit(0);
    });
  });
} else {
  console.log('📁 Database file does not exist, nothing to clean');
  process.exit(0);
}