const fs = require('fs');
const path = require('path');
const { getStrategyById } = require('../trading/strategy.crud');

/**
 * CORE BACKTESTING ENGINE (Basic Logic)
 * ---------------------------------------------------------------------
 * This module runs a basic backtest reading Parquet files for the Index
 * and Options to simulate entry and exit based solely on time.
 */
class BacktestEngine {
    constructor(strategyId, fromDate, toDate) {
        this.strategyId = strategyId;
        this.fromDate = fromDate;
        this.toDate = toDate;
        
        this.strategy = null;
        this.results = {
            trades: [],
            dailySummary: {},
            totalPnL: 0,
            maxDrawdown: 0,
            winRate: 0
        };
    }

    async init() {
        const strategies = await getStrategyById(this.strategyId);
        if (!strategies || strategies.length === 0) {
            throw new Error(`Strategy not found: ${this.strategyId}`);
        }
        this.strategy = strategies[0];
        
        if (!this.strategy.config || !this.strategy.config.legs) {
            throw new Error("Invalid strategy configuration or missing legs.");
        }
        
        console.log(`[Backtest Engine] Initialized: ${this.strategy.name} [${this.fromDate} to ${this.toDate}]`);
    }

    async readParquetFile(filePath) {
        if (!fs.existsSync(filePath)) return [];
        const { parquetRead } = await import('hyparquet');
        const buffer = fs.readFileSync(filePath).buffer;
        return new Promise((resolve, reject) => {
            try {
                parquetRead({
                    file: buffer,
                    onComplete: resolve
                });
            } catch (e) {
                console.error(`Error parsing ${filePath}:`, e);
                resolve([]);
            }
        });
    }

    extractTime(row) {
        // row[8] is the explicit iso_timestamp string stored by the Python harvester for Index data
        if (row && row.length > 8 && typeof row[8] === 'string' && row[8].includes('T')) {
            const d = new Date(row[8]);
            return d.toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: false });
        }
        if (row && row[1]) return row[1].toISOString().substring(11, 16); 
        return null;
    }

    extractTimeOption(row) {
        // row[13] is the explicit iso_timestamp string stored for Options data
        if (row && row.length > 13 && typeof row[13] === 'string' && row[13].includes('T')) {
            const d = new Date(row[13]);
            return d.toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: false });
        }
        if (row && row[1]) return row[1].toISOString().substring(11, 16); 
        return null;
    }

    getStrikeStep(indexName) {
        return indexName === 'SENSEX' ? 100 : 50;
    }

    calculateATM(spotPrice, step) {
        return Math.round(spotPrice / step) * step;
    }

    findClosestExpiry(indexName, dateStr) {
        const [year, month] = dateStr.split('-');
        const monthDir = path.join(__dirname, `../../../../market-data/options/${indexName}/${year}/${month}`);
        if (!fs.existsSync(monthDir)) return null;
        
        const expiries = fs.readdirSync(monthDir)
            .filter(dir => dir.startsWith('expiry='))
            .map(dir => dir.split('=')[1])
            .filter(exp => exp >= dateStr)
            .sort();
            
        return expiries.length > 0 ? expiries[0] : null;
    }

    async run() {
        if (!this.strategy) await this.init();
        
        const dates = this.generateDateRange(this.fromDate, this.toDate);
        const indexName = this.strategy.config.index;
        const entryTime = this.strategy.config.entry_time?.substring(0, 5);
        const exitTime = this.strategy.config.exit_time?.substring(0, 5);
        const step = this.getStrikeStep(indexName);
        
        for (const date of dates) {
            console.log(`[Backtest Engine] Simulating Day: ${date}`);
            const [year, month] = date.split('-');
            
            // 1. Read Index Data
            const indexFilePath = path.join(__dirname, `../../../../market-data/index/${indexName}/${year}/${month}/${date}.parquet`);
            const indexData = await this.readParquetFile(indexFilePath);
            
            if (indexData.length === 0) {
                console.log(`  -> No index data found. Skipping.`);
                continue;
            }
            
            const dayChart = {}; // { '24200_CE': [{ time, open, high, low, close, action }], ... }
            // 2. Find Index Open Price at Entry Time
            const indexEntryRow = indexData.find(row => this.extractTime(row) === entryTime);
            if (!indexEntryRow) {
                console.log(`  -> Entry time ${entryTime} not found in index data. Skipping.`);
                continue;
            }
            
            const spotPrice = indexEntryRow[5]; // open price
            const atmStrike = this.calculateATM(spotPrice, step);
            console.log(`  -> ATM Strike at ${entryTime} (Spot: ${spotPrice}): ${atmStrike}`);
            
            // 3. Find Expiry
            const expiry = this.findClosestExpiry(indexName, date);
            if (!expiry) {
                console.log(`  -> No expiry found for ${date}. Skipping.`);
                continue;
            }
            
            let dailyPnL = 0;
            let dailyTradeValue = 0;
            
            const roundToTick = (price, tick = 0.05) => {
                if (price === null || price === undefined || isNaN(price)) return 0;
                return Number(Math.max(tick, Math.round(price / tick) * tick).toFixed(2));
            };
            
            const calculateSlPrice = (leg, entryPrice, isReentry) => {
                const isSlEnabled = isReentry && leg.reentry_sl_enabled ? true : leg.sl_enabled !== false;
                const activeSlType = isReentry && leg.reentry_sl_enabled ? (leg.reentry_sl_type || 'PERCENTAGE') : (leg.sl_type || 'PERCENTAGE');
                const activeSlValue = isReentry && leg.reentry_sl_enabled ? leg.reentry_sl_value : leg.stop_loss;
                
                if (isSlEnabled && parseFloat(activeSlValue) > 0) {
                    const slVal = parseFloat(activeSlValue);
                    if (activeSlType === 'POINTS') {
                        return roundToTick(leg.side === 'BUY' ? entryPrice - slVal : entryPrice + slVal);
                    } else {
                        return roundToTick(leg.side === 'BUY' ? entryPrice * (1 - slVal / 100) : entryPrice * (1 + slVal / 100));
                    }
                }
                return null;
            };

            // 4. Pre-load Option Data and calculate Entry Prices for all legs
            const activeLegs = [];
            const lotsize = indexName === 'NIFTY' ? 65 : (indexName === 'SENSEX' ? 20 : 1);
            const multiplier = parseFloat(this.strategy.config.quantity_multiplier) || 1;

            for (const leg of this.strategy.config.legs) {
                const strikeStr = leg.strike || leg.strike_selection || "ATM";
                const match = strikeStr.match(/^([A-Z]+)(\d*)$/);
                const type = match ? match[1] : "ATM";
                const offset = match && match[2] ? parseInt(match[2]) : 0;
                
                let targetStrike = atmStrike;
                if (type === "OTM") {
                    targetStrike = leg.option_type === "CE" ? atmStrike + (offset * step) : atmStrike - (offset * step);
                } else if (type === "ITM") {
                    targetStrike = leg.option_type === "CE" ? atmStrike - (offset * step) : atmStrike + (offset * step);
                }
                 
                
                const optionFilePath = path.join(__dirname, `../../../../market-data/options/${indexName}/${year}/${month}/expiry=${expiry}/date=${date}/${targetStrike}_${leg.option_type}.parquet`);
                const optionData = await this.readParquetFile(optionFilePath);
                
                if (optionData.length === 0) {
                    console.log(`    -> Missing option data: ${targetStrike}_${leg.option_type}`);
                    continue;
                }
                
                const chartMap = new Map();
                const optionDayChart = optionData.map(row => {
                    const time = this.extractTimeOption(row);
                    const mapped = {
                        time, open: row[6], high: row[4], low: row[5], close: row[0], action: null
                    };
                    if (time) chartMap.set(time, mapped);
                    return mapped;
                });

                const entryNode = chartMap.get(entryTime);
                if (!entryNode) {
                    console.log(`    -> Missing entry row for ${targetStrike}_${leg.option_type}`);
                    continue;
                }

                const basePrice = entryNode.open;
                const qty = leg.lots * lotsize * multiplier;
                
                let initialState = 'ACTIVE';
                let initialTrades = [];
                let initialEntryPrice = null;
                let initialSlPrice = null;
                let initialTslRef = null;
                let mtp = null;
                
                if (leg.simple_mntm_enabled) {
                    initialState = 'WAITING_FOR_MNTM';
                    let mMode = leg.simple_mntm_mode || 'SIMPLE_PLUS_PCT';
                    let mVal = parseFloat(leg.simple_mntm_value || 0);
                    
                    if (mMode.includes("PLUS_PCT")) mtp = basePrice + (basePrice * mVal / 100);
                    else if (mMode.includes("PLUS_PTS")) mtp = basePrice + mVal;
                    else if (mMode.includes("MINUS_PCT")) mtp = basePrice - (basePrice * mVal / 100);
                    else if (mMode.includes("MINUS_PTS")) mtp = basePrice - mVal;
                    
                    mtp = roundToTick(mtp);
                } else {
                    initialEntryPrice = basePrice;
                    dailyTradeValue += (initialEntryPrice * qty);
                    initialSlPrice = calculateSlPrice(leg, initialEntryPrice, false);
                    initialTslRef = initialEntryPrice;
                    initialTrades.push({
                        entryTime,
                        entryPrice: initialEntryPrice,
                        exitTime: null,
                        exitPrice: null,
                        exitReason: null,
                        tradePnL: 0,
                        tradeValue: initialEntryPrice * qty,
                        tradeSlPrice: initialSlPrice
                    });
                }

                activeLegs.push({
                    leg, targetStrike, qty, chartMap, optionDayChart, optionData,
                    state: initialState,
                    reentryCount: 0,
                    trades: initialTrades,
                    entryTime: initialState === 'ACTIVE' ? entryTime : null, 
                    entryPrice: initialEntryPrice, 
                    slPrice: initialSlPrice, 
                    lockedPnL: 0,
                    rtp: null, mtp: mtp, tslReferencePrice: initialTslRef,
                    baseOtp: basePrice
                });
            }

            if (activeLegs.length === 0) continue;

            // 5. Minute-by-Minute Simulation to check Overall SL/Target
            let actualExitTime = exitTime;
            let exitReason = 'EXIT_TIME';

            // Generate sequence of minutes from entryTime to exitTime based on data from first leg
            const allTimes = Array.from(activeLegs[0].chartMap.keys()).filter(t => t >= entryTime && t <= exitTime).sort();

            const config = this.strategy.config;
            const slEnabled = config.overall_sl_enabled && parseFloat(config.overall_sl_value) > 0;
            const slVal = parseFloat(config.overall_sl_value) || 0;

            const targetEnabled = config.overall_target_enabled && parseFloat(config.overall_target_value) > 0;
            const targetVal = parseFloat(config.overall_target_value) || 0;

            const dailyOverallPnLChart = [];
            let exitAtOpen = false;

            for (const t of allTimes) {
                let currentOpenPnL = 0;
                let currentClosePnL = 0;
                for (const active of activeLegs) {
                    const node = active.chartMap.get(t);
                    if (!node) continue;

                    if (active.state === 'WAITING_FOR_MNTM') {
                        let mntmHit = false;
                        if (active.leg.simple_mntm_mode.includes("PLUS_")) {
                            if (node.high >= active.mtp) mntmHit = true;
                        } else {
                            if (node.low <= active.mtp) mntmHit = true;
                        }

                        if (mntmHit) {
                            active.state = 'ACTIVE';
                            active.entryTime = t;
                            active.entryPrice = active.mtp; // Execute exactly at mtp
                            active.slPrice = calculateSlPrice(active.leg, active.entryPrice, false);
                            active.tslReferencePrice = active.entryPrice;
                            
                            active.trades.push({
                                entryTime: active.entryTime, entryPrice: active.entryPrice,
                                exitTime: null, exitPrice: null, exitReason: null, tradePnL: 0, tradeValue: active.entryPrice * active.qty,
                                tradeSlPrice: active.slPrice
                            });
                            dailyTradeValue += (active.entryPrice * active.qty);

                            // Log Action
                            const idx = active.optionDayChart.findIndex(c => c.time === t);
                            if (idx !== -1) {
                                const slStr = active.slPrice !== null ? ` | Init SL: ₹${active.slPrice.toFixed(2)}` : '';
                                const entrySide = active.leg.side === 'SELL' ? 'Sell' : 'Buy';
                                const actionStr = `Entry (${entrySide}) [MNTM]: ${active.entryPrice.toFixed(2)}${slStr}`;
                                active.optionDayChart[idx].action = active.optionDayChart[idx].action ? active.optionDayChart[idx].action + ' | ' + actionStr : actionStr;
                            }
                        }
                        // Fall through to evaluate TSL and SL on the exact entry minute
                    }

                    if (active.state === 'ACTIVE') {
                        let hitSL = false;

                        // 1. Evaluate Trailing Stop Loss
                        const isReentered = active.reentryCount > 0;
                        const isTslEnabled = isReentered ? (active.leg.reentry_tsl_enabled === true) : active.leg.tsl_enabled;

                        if (isTslEnabled && active.tslReferencePrice !== undefined) {
                            const tslType = isReentered ? (active.leg.reentry_tsl_type || "PERCENTAGE") : (active.leg.tsl_type || "PERCENTAGE");
                            let tslMove = isReentered ? parseFloat(active.leg.reentry_tsl_move || 0) : parseFloat(active.leg.tsl_move || 0);
                            let tslTrail = isReentered ? parseFloat(active.leg.reentry_tsl_trail || 0) : parseFloat(active.leg.tsl_trail || 0);
                            
                            // fallback
                            if (isReentered && (isNaN(tslMove) || tslMove <= 0)) tslMove = parseFloat(active.leg.tsl_move || 0);
                            if (isReentered && (isNaN(tslTrail) || tslTrail <= 0)) tslTrail = parseFloat(active.leg.tsl_trail || 0);

                            if (!isNaN(tslMove) && !isNaN(tslTrail) && tslMove > 0 && tslTrail > 0) {
                                let moveThreshold = tslMove;
                                let trailAmount = tslTrail;

                                if (tslType === "PERCENTAGE") {
                                    moveThreshold = active.entryPrice * (tslMove / 100);
                                    trailAmount = active.entryPrice * (tslTrail / 100);
                                }

                                let peakPrice = active.leg.side === 'BUY' ? node.high : node.low;
                                let favorableMove = active.leg.side === "BUY" ? (peakPrice - active.tslReferencePrice) : (active.tslReferencePrice - peakPrice);

                                if (favorableMove >= moveThreshold) {
                                    const steps = Math.floor(favorableMove / moveThreshold);
                                    if (steps > 0) {
                                        if (active.leg.side === "BUY") {
                                            active.slPrice = active.slPrice + (steps * trailAmount);
                                            active.tslReferencePrice = active.tslReferencePrice + (steps * moveThreshold);
                                        } else {
                                            active.slPrice = active.slPrice - (steps * trailAmount);
                                            active.tslReferencePrice = active.tslReferencePrice - (steps * moveThreshold);
                                        }
                                        active.slPrice = roundToTick(active.slPrice);
                                        
                                        // Log TSL Trailed action
                                        const idx = active.optionDayChart.findIndex(c => c.time === t);
                                        if (idx !== -1) {
                                            const tslActionStr = `[TSL Trailed] New SL: ₹${active.slPrice.toFixed(2)}`;
                                            active.optionDayChart[idx].action = active.optionDayChart[idx].action ? active.optionDayChart[idx].action + ' | ' + tslActionStr : tslActionStr;
                                        }
                                    }
                                }
                            }
                        }

                        // 2. Evaluate if SL was hit
                        if (active.slPrice !== null) {
                            if (isTslEnabled) {
                                // For trailing sl, we check the close to see if our sl was hit
                                if (active.leg.side === 'SELL' && node.close >= active.slPrice) hitSL = true;
                                if (active.leg.side === 'BUY' && node.close <= active.slPrice) hitSL = true;
                            } else {
                                // For normal sl (without trail), we check the high-low range
                                if (active.leg.side === 'SELL' && node.high >= active.slPrice) hitSL = true;
                                if (active.leg.side === 'BUY' && node.low <= active.slPrice) hitSL = true;
                            }
                        }

                        if (hitSL) {
                            active.state = 'STOPPED_OUT';
                            const exitTime = t;
                            const exitPrice = active.slPrice; // exited exactly at SL
                            const exitReason = 'LEG_SL';
                            const pnlDiff = active.leg.side === 'SELL' ? (active.entryPrice - exitPrice) : (exitPrice - active.entryPrice);
                            const tradePnL = pnlDiff * active.qty;
                            const tradeValue = active.entryPrice * active.qty;
                            
                            const currentTrade = active.trades[active.trades.length - 1];
                            currentTrade.exitTime = exitTime;
                            currentTrade.exitPrice = exitPrice;
                            currentTrade.exitReason = exitReason;
                            currentTrade.tradePnL = tradePnL;

                            active.lockedPnL += tradePnL;
                            currentOpenPnL += active.lockedPnL;
                            currentClosePnL += active.lockedPnL;

                            if (!active.minutePnLMap) active.minutePnLMap = new Map();
                            active.minutePnLMap.set(t, tradePnL);

                            // Setup RE-SL if enabled
                            if (active.leg.resl_enabled && active.reentryCount < (parseInt(active.leg.max_reentry) || 1)) {
                                const slMode = active.leg.resl_mode || "RESL_PLUS_PCT";
                                const slValue = parseFloat(active.leg.resl_value || 0);
                                let reslTarget = active.slPrice;
                                if (slMode === "RESL_PLUS_PCT") reslTarget = reslTarget + (reslTarget * slValue / 100);
                                else if (slMode === "RESL_PLUS_PTS") reslTarget = reslTarget + slValue;
                                else if (slMode === "RESL_MINUS_PCT") reslTarget = reslTarget - (reslTarget * slValue / 100);
                                else if (slMode === "RESL_MINUS_PTS") reslTarget = reslTarget - slValue;
                                
                                active.rtp = roundToTick(reslTarget);
                                active.state = 'WAITING_FOR_RESL_RTP';
                                currentTrade.reentryCalcStr = `Calc RTP: ₹${active.rtp.toFixed(2)}`;
                                
                                if (active.leg.resl_mntm_enabled) {
                                    const mntmMode = active.leg.resl_mntm_mode || "RESL_PLUS_PCT";
                                    const mntmValue = parseFloat(active.leg.resl_mntm_value || 0);
                                    let mntmTarget = active.rtp;
                                    if (mntmMode.includes("PLUS_PCT") || mntmMode === "PERCENTAGE") mntmTarget += (mntmTarget * mntmValue / 100);
                                    else if (mntmMode.includes("PLUS_PTS") || mntmMode === "POINTS") mntmTarget += mntmValue;
                                    else if (mntmMode.includes("MINUS_PCT")) mntmTarget -= (mntmTarget * mntmValue / 100);
                                    else if (mntmMode.includes("MINUS_PTS")) mntmTarget -= mntmValue;
                                    active.mtp = roundToTick(mntmTarget);
                                    currentTrade.reentryCalcStr += ` | Calc MTP: ₹${active.mtp.toFixed(2)}`;
                                } else {
                                    active.mtp = null;
                                }

                                const closePrice = node.close;
                                let rtpCrossed = false;
                                if ((active.leg.resl_mode || "RESL_PLUS_PCT").includes("PLUS")) {
                                    if (closePrice >= active.rtp) rtpCrossed = true;
                                } else {
                                    if (closePrice <= active.rtp) rtpCrossed = true;
                                }

                                if (rtpCrossed) {
                                    if (active.mtp) {
                                        active.state = 'WAITING_FOR_RESL_MTP';
                                        if (node.time) {
                                            const idx = active.optionDayChart.findIndex(c => c.time === node.time);
                                            if (idx !== -1) active.optionDayChart[idx].action = (active.optionDayChart[idx].action ? active.optionDayChart[idx].action + ' | ' : '') + `[RTP Hit] Waiting MTP: ₹${active.mtp.toFixed(2)}`;
                                        }
                                    } else {
                                        active.state = 'ACTIVE';
                                        active.reentryCount++;
                                        active.entryTime = t;
                                        active.entryPrice = active.rtp;
                                        
                                        active.slPrice = calculateSlPrice(active.leg, active.entryPrice, true);
                                        active.tslReferencePrice = active.entryPrice;

                                        active.trades.push({
                                            entryTime: active.entryTime, entryPrice: active.entryPrice,
                                            exitTime: null, exitPrice: null, exitReason: null, tradePnL: 0, tradeValue: active.entryPrice * active.qty,
                                            tradeSlPrice: active.slPrice
                                        });
                                        dailyTradeValue += (active.entryPrice * active.qty);
                                        
                                        const idxLog = active.optionDayChart.findIndex(c => c.time === t);
                                        if (idxLog !== -1) {
                                            const slStrLog = active.slPrice !== null ? ` | Init SL: ₹${active.slPrice.toFixed(2)}` : '';
                                            const entrySideLog = active.leg.side === 'SELL' ? 'Sell' : 'Buy';
                                            const actionStrLog = `Re-Entry (${entrySideLog}) [RE-SL]: ${active.entryPrice.toFixed(2)}${slStrLog}`;
                                            active.optionDayChart[idxLog].action = active.optionDayChart[idxLog].action ? active.optionDayChart[idxLog].action + ' | ' + actionStrLog : actionStrLog;
                                        }
                                        const closePnlDiff = active.leg.side === 'SELL' ? (active.entryPrice - node.close) : (node.close - active.entryPrice);
                                        const newTradePnL = closePnlDiff * active.qty;
                                        active.minutePnLMap.set(t, newTradePnL);
                                        currentClosePnL += newTradePnL;
                                    }
                                }
                            }
                            continue;
                        }
                    }

                    if (active.state === 'WAITING_FOR_RESL_RTP') {
                        currentOpenPnL += active.lockedPnL;
                        currentClosePnL += active.lockedPnL;
                        active.minutePnLMap.set(t, 0);
                        const high = node.high;
                        const low = node.low;
                        let rtpCrossed = false;
                        if ((active.leg.resl_mode || "RESL_PLUS_PCT").includes("PLUS")) {
                            if (high >= active.rtp) rtpCrossed = true;
                        } else {
                            if (low <= active.rtp) rtpCrossed = true;
                        }

                        if (rtpCrossed) {
                            if (active.mtp) {
                                active.state = 'WAITING_FOR_RESL_MTP';
                                if (node.time) {
                                    const idx = active.optionDayChart.findIndex(c => c.time === node.time);
                                    if (idx !== -1) active.optionDayChart[idx].action = (active.optionDayChart[idx].action ? active.optionDayChart[idx].action + ' | ' : '') + `[RTP Hit] Waiting MTP: ₹${active.mtp.toFixed(2)}`;
                                }
                            } else {
                                active.state = 'ACTIVE';
                                active.reentryCount++;
                                active.entryTime = t;
                                active.entryPrice = active.rtp; 
                                
                                active.slPrice = calculateSlPrice(active.leg, active.entryPrice, true);
                                active.tslReferencePrice = active.entryPrice;

                                active.trades.push({
                                    entryTime: active.entryTime, entryPrice: active.entryPrice,
                                    exitTime: null, exitPrice: null, exitReason: null, tradePnL: 0, tradeValue: active.entryPrice * active.qty,
                                    tradeSlPrice: active.slPrice
                                });
                                dailyTradeValue += (active.entryPrice * active.qty);
                                
                                const idxLog = active.optionDayChart.findIndex(c => c.time === t);
                                if (idxLog !== -1) {
                                    const slStrLog = active.slPrice !== null ? ` | Init SL: ₹${active.slPrice.toFixed(2)}` : '';
                                    const entrySideLog = active.leg.side === 'SELL' ? 'Sell' : 'Buy';
                                    const actionStrLog = `Re-Entry (${entrySideLog}) [RE-SL]: ${active.entryPrice.toFixed(2)}${slStrLog}`;
                                    active.optionDayChart[idxLog].action = active.optionDayChart[idxLog].action ? active.optionDayChart[idxLog].action + ' | ' + actionStrLog : actionStrLog;
                                }
                                const closePnlDiff = active.leg.side === 'SELL' ? (active.entryPrice - node.close) : (node.close - active.entryPrice);
                                const newTradePnL = closePnlDiff * active.qty;
                                active.minutePnLMap.set(t, newTradePnL);
                                currentClosePnL += newTradePnL;
                            }
                        }
                        continue;
                    }

                    if (!active.minutePnLMap) active.minutePnLMap = new Map();

                    if (active.state === 'WAITING_FOR_RESL_MTP') {
                        currentOpenPnL += active.lockedPnL;
                        currentClosePnL += active.lockedPnL;
                        active.minutePnLMap.set(t, 0);
                        const high = node.high;
                        const low = node.low;
                        let mtpCrossed = false;
                        if (active.mtp > active.rtp) { 
                            if (high >= active.mtp) mtpCrossed = true;
                        } else {
                            if (low <= active.mtp) mtpCrossed = true;
                        }

                        if (mtpCrossed) {
                            active.state = 'ACTIVE';
                            active.reentryCount++;
                            active.entryTime = t;
                            active.entryPrice = active.mtp;
                            
                            active.slPrice = calculateSlPrice(active.leg, active.entryPrice, true);
                            active.tslReferencePrice = active.entryPrice;

                            active.trades.push({
                                entryTime: active.entryTime, entryPrice: active.entryPrice,
                                exitTime: null, exitPrice: null, exitReason: null, tradePnL: 0, tradeValue: active.entryPrice * active.qty,
                                tradeSlPrice: active.slPrice
                            });
                            dailyTradeValue += (active.entryPrice * active.qty);
                            
                            const idxLog = active.optionDayChart.findIndex(c => c.time === t);
                            if (idxLog !== -1) {
                                const slStrLog = active.slPrice !== null ? ` | Init SL: ₹${active.slPrice.toFixed(2)}` : '';
                                const entrySideLog = active.leg.side === 'SELL' ? 'Sell' : 'Buy';
                                const actionStrLog = `Re-Entry (${entrySideLog}) [RE-SL]: ${active.entryPrice.toFixed(2)}${slStrLog}`;
                                active.optionDayChart[idxLog].action = active.optionDayChart[idxLog].action ? active.optionDayChart[idxLog].action + ' | ' + actionStrLog : actionStrLog;
                            }
                            const closePnlDiff = active.leg.side === 'SELL' ? (active.entryPrice - node.close) : (node.close - active.entryPrice);
                            const newTradePnL = closePnlDiff * active.qty;
                            active.minutePnLMap.set(t, newTradePnL);
                            currentClosePnL += newTradePnL;
                        }
                        continue;
                    }

                    if (active.state === 'STOPPED_OUT') {
                        currentOpenPnL += active.lockedPnL;
                        currentClosePnL += active.lockedPnL;
                        active.minutePnLMap.set(t, 0);
                        continue;
                    }

                    if (active.state === 'ACTIVE') {
                        const openPrice = node.open;
                        const closePrice = node.close; 
                        
                        const openPnlDiff = active.leg.side === 'SELL' ? (active.entryPrice - openPrice) : (openPrice - active.entryPrice);
                        const closePnlDiff = active.leg.side === 'SELL' ? (active.entryPrice - closePrice) : (closePrice - active.entryPrice);
                        
                        const legOpenPnL = active.lockedPnL + (openPnlDiff * active.qty);
                        const legClosePnL = active.lockedPnL + (closePnlDiff * active.qty);
                        
                        currentOpenPnL += legOpenPnL;
                        currentClosePnL += legClosePnL;
                        
                        if (!active.minutePnLMap) active.minutePnLMap = new Map();
                        active.minutePnLMap.set(t, closePnlDiff * active.qty);
                    } else if (active.state === 'WAITING_FOR_MNTM') {
                        if (!active.minutePnLMap) active.minutePnLMap = new Map();
                        active.minutePnLMap.set(t, 0);
                    }
                }

                const slAmount = config.overall_sl_type === 'AMOUNT' ? slVal * multiplier : (dailyTradeValue * slVal / 100);
                if (slEnabled) {
                    if (currentOpenPnL <= -slAmount) {
                        actualExitTime = t;
                        exitReason = 'OVER_SL';
                        exitAtOpen = true;
                        break;
                    }
                    if (currentClosePnL <= -slAmount) {
                        actualExitTime = t;
                        exitReason = 'OVER_SL';
                        exitAtOpen = false;
                        break;
                    }
                }
                
                const targetAmount = config.overall_target_type === 'AMOUNT' ? targetVal * multiplier : (dailyTradeValue * targetVal / 100);
                if (targetEnabled) {
                    if (currentOpenPnL >= targetAmount) {
                        actualExitTime = t;
                        exitReason = 'OVER_TGT';
                        exitAtOpen = true;
                        break;
                    }
                    if (currentClosePnL >= targetAmount) {
                        actualExitTime = t;
                        exitReason = 'OVER_TGT';
                        exitAtOpen = false;
                        break;
                    }
                }
                
                dailyOverallPnLChart.push({ time: t, pnl: currentClosePnL });
            }

            // 6. Record Trades and Actions based on actualExitTime
            dailyPnL = 0;
            for (const active of activeLegs) {
                if (active.state === 'ACTIVE' && active.trades.length > 0) {
                    let exitTimeStr = actualExitTime;
                    let exitReasonStr = exitReason;

                    let exitNode = active.chartMap.get(exitTimeStr);
                    if (!exitNode) exitNode = active.optionDayChart.find(c => c.time >= exitTimeStr);
                    if (!exitNode) exitNode = active.optionDayChart[active.optionDayChart.length - 1]; // fallback

                    const exitPrice = exitAtOpen ? exitNode.open : exitNode.close;
                    const currentTrade = active.trades[active.trades.length - 1];
                    currentTrade.exitTime = exitNode.time;
                    currentTrade.exitPrice = exitPrice;
                    currentTrade.exitReason = exitReasonStr;
                    
                    const pnlDiff = active.leg.side === 'SELL' ? (currentTrade.entryPrice - exitPrice) : (exitPrice - currentTrade.entryPrice);
                    currentTrade.tradePnL = pnlDiff * active.qty;
                    active.lockedPnL += currentTrade.tradePnL;
                }

                dailyPnL += active.lockedPnL;

                const entrySide = active.leg.side === 'SELL' ? 'Sell' : 'Buy';
                const exitSide = active.leg.side === 'SELL' ? 'Buy' : 'Sell';

                // Process all trades for this leg
                for (let i = 0; i < active.trades.length; i++) {
                    const trade = active.trades[i];
                    this.results.trades.push({
                        date: date,
                        leg_id: active.leg.id,
                        symbol: `${active.targetStrike}_${active.leg.option_type}`,
                        side: active.leg.side,
                        entry_time: trade.entryTime,
                        entry_price: trade.entryPrice,
                        exit_time: trade.exitTime,
                        exit_price: trade.exitPrice,
                        exit_reason: trade.exitReason,
                        qty: active.qty,
                        pnl: trade.tradePnL,
                        trade_value: trade.tradeValue,
                        pnl_percent: trade.tradeValue > 0 ? (trade.tradePnL / trade.tradeValue) * 100 : 0
                    });

                    // Remove initial logging here because we now inject it dynamically on the exact minute
                    // Wait, if it wasn't MNTM, we still need to log the first entry at 09:16
                    if (i === 0 && !active.leg.simple_mntm_enabled) {
                        const cEntryIndex = active.optionDayChart.findIndex(c => c.time === trade.entryTime);
                        if (cEntryIndex !== -1) {
                            const slStr = trade.tradeSlPrice !== null ? ` | Init SL: ₹${trade.tradeSlPrice.toFixed(2)}` : '';
                            const actionStr = `Entry (${entrySide}): ${trade.entryPrice.toFixed(2)}${slStr}`;
                            active.optionDayChart[cEntryIndex].action = active.optionDayChart[cEntryIndex].action ? active.optionDayChart[cEntryIndex].action + ' | ' + actionStr : actionStr;
                        }
                    }
                    
                    const cExitIndex = active.optionDayChart.findIndex(c => c.time === trade.exitTime);
                    if (cExitIndex !== -1) {
                        const reCalcStr = trade.reentryCalcStr ? ` | ${trade.reentryCalcStr}` : '';
                        const pnlColorStr = trade.tradePnL >= 0 ? '+' : '';
                        const pnlStr = ` | Locked PnL: ${pnlColorStr}₹${trade.tradePnL.toFixed(2)}`;
                        const actionStr = `Exit (${exitSide}) [${trade.exitReason}]: ${trade.exitPrice.toFixed(2)}${reCalcStr}${pnlStr}`;
                        active.optionDayChart[cExitIndex].action = active.optionDayChart[cExitIndex].action ? active.optionDayChart[cExitIndex].action + ' | ' + actionStr : actionStr;
                    }
                }

                active.optionDayChart = active.optionDayChart.map(node => {
                    let pnl = 0;
                    if (active.minutePnLMap && active.minutePnLMap.has(node.time)) pnl = active.minutePnLMap.get(node.time);
                    else if (node.time > actualExitTime) pnl = 0;
                    return { ...node, pnl };
                }).filter(node => node.time >= entryTime && node.time <= actualExitTime);

                dayChart[`${active.targetStrike}_${active.leg.option_type}`] = active.optionDayChart;
                console.log(`    -> ${active.leg.side} ${active.qty}x ${active.targetStrike}_${active.leg.option_type} | Total PnL: ${active.lockedPnL.toFixed(2)} | Trades: ${active.trades.length}`);
            }
            
            const fullDayOverallPnLChart = activeLegs[0].optionDayChart.map(node => {
                const t = node.time;
                const matched = dailyOverallPnLChart.find(x => x.time === t);
                if (matched) return { time: t, pnl: matched.pnl };
                if (t < entryTime) return { time: t, pnl: 0 };
                return { time: t, pnl: dailyPnL };
            });
            dayChart['OVERALL_PNL'] = fullDayOverallPnLChart;
            
            // Calculate DTE
            const dateObj = new Date(date);
            const expiryObj = new Date(expiry);
            const dte = Math.round((expiryObj - dateObj) / (1000 * 60 * 60 * 24));

            this.results.dailySummary[date] = {
                pnl: dailyPnL,
                trade_value: dailyTradeValue,
                pnl_percent: dailyTradeValue > 0 ? (dailyPnL / dailyTradeValue) * 100 : 0,
                dte: dte,
                expiry: expiry
            };
            this.results.totalPnL += dailyPnL;
            this.results.chartData = this.results.chartData || {};
            this.results.chartData[date] = dayChart;
            console.log(`  -> Day PnL: ${dailyPnL.toFixed(2)} | Trade Value: ${dailyTradeValue.toFixed(2)}`);
        }
        
        return this.results;
    }

    generateDateRange(start, end) {
        let current = new Date(start);
        const endData = new Date(end);
        const dates = [];
        while (current <= endData) {
            dates.push(current.toISOString().split('T')[0]);
            current.setDate(current.getDate() + 1);
        }
        return dates;
    }
}

module.exports = BacktestEngine;
