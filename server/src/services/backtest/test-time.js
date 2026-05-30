const fs = require('fs');
const path = require('path');

async function run() {
    const { parquetRead } = await import('hyparquet');
    const p = path.join(__dirname, '../../../../market-data/index/NIFTY/2026/04/2026-04-01.parquet');
    const buffer = fs.readFileSync(p).buffer;

    parquetRead({
        file: buffer,
        onComplete: (data) => {
            const row = data[0];
            console.log("Row 1 (datetime):", row[1], typeof row[1]);
            if (row[1] instanceof Date) {
                console.log("Row 1 substring:", row[1].toISOString().substring(11, 16));
            }
            
            console.log("Row 8 (iso_timestamp):", row[8], typeof row[8]);
            
            // To parse row[8] to IST:
            const d = new Date(row[8]);
            // Format it to IST string "HH:MM"
            const options = { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: false };
            const istTime = d.toLocaleTimeString('en-IN', options);
            console.log("Row 8 IST time:", istTime);
        }
    });
}
run();
