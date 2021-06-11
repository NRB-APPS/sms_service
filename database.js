var sqlite3 = require('sqlite3').verbose()
const DBSOURCE = "db.sms_sync"

let db = new sqlite3.Database(DBSOURCE, (err) => {
    if (err) {
      // Cannot open database
      console.error(err.message)
      throw err
    }else{
        console.log('Connected to the SQLite database.')
        db.run(`CREATE TABLE IF NOT EXISTS sms_sync_tracker (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            person_id INTEGER, 
            date_received DATETIME, 
            synced   BOOLEAN NOT NULL DEFAULT 0,
            date_synced  DATETIME, 
            acknowledged  VARCHAR(10),
            date_acknowledged DATETIME
            )`,
        (err) => {
            if (err) {
	      console.error(err.message)
	      throw err
	    }
        }); 
        
         db.run(`CREATE TABLE IF NOT EXISTS sms_message (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            person_id INTEGER NOT NULL, 
            message TEXT NOT NULL,
            date_received DATETIME DEFAULT CURRENT_TIMESTAMP, 
            processed  boolean NOT NULL DEFAULT 0
            )`,
        (err) => {
            if (err) {
	      console.error(err.message)
	      throw err
	    }
        }); 
    }
});


module.exports = db
