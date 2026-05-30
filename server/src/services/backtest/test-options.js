const fs = require('fs');
const path = require('path');

async function run() {
    const { parquetRead, parquetMetadata } = await import('hyparquet');
    const p = path.join(__dirname, '../../../../market-data/options/NIFTY/2026/05/expiry=2026-05-05/date=2026-05-04/23000_CE.parquet');
    const buffer = fs.readFileSync(p).buffer;

    const meta = parquetMetadata(buffer);
    console.log(meta.schema);
    
    parquetRead({
        file: buffer,
        onComplete: (data) => {
            console.log("First row:");
            console.log(data[0]);
        }
    });
}
run();
