const fs = require('fs');
const path = require('path');

async function run() {
    const { parquetRead } = await import('hyparquet');
    const p = path.join(__dirname, '../../../../market-data/index/NIFTY/2026/04/2026-04-01.parquet');
    const buffer = fs.readFileSync(p).buffer;

    parquetRead({
        file: buffer,
        onComplete: (data) => {
            console.log("Data length:", data.length);
        }
    });

    const { parquetMetadata } = await import('hyparquet');
    const meta = parquetMetadata(buffer);
    console.log(meta.schema);
}
run();
