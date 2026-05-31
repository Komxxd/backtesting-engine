const express = require("express");
const router = express.Router();
const { body, validationResult } = require("express-validator");
const strategyService = require("../services/strategy.service");

// Tier 2 - Rule 8: Basic input validation
const validateStrategy = [
    body("name").trim().notEmpty().withMessage("Strategy name is required").isLength({ max: 100 }),
    body("index").isIn(["NIFTY", "SENSEX"]).withMessage("Invalid index selection"),
    body("legs").isArray({ min: 1 }).withMessage("At least one leg is required"),
    body("legs.*.option_type").isIn(["CE", "PE"]).withMessage("Invalid option type"),
    body("legs.*.side").isIn(["BUY", "SELL"]).withMessage("Invalid side"),
    body("legs.*.lots").isInt({ min: 1 }).withMessage("Lots must be a positive integer"),
    body("variety").equals("STOPLOSS").withMessage("Invalid variety"),
    body("producttype").equals("CARRYFORWARD").withMessage("Invalid product type"),
    body("ordertype").equals("LIMIT").withMessage("Invalid order type"),
    body("duration").equals("DAY").withMessage("Invalid duration"),
    (req, res, next) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            console.error("Validation failed for strategy operation:", JSON.stringify(errors.array(), null, 2));
            return res.status(400).json({ success: false, errors: errors.array() });
        }
        next();
    }
];

router.post("/save", validateStrategy, async (req, res) => {
    try {
        const strategy = await strategyService.saveStrategy(req.body);
        res.json({ success: true, strategy });
    } catch (error) {
        console.error("Error saving strategy:", error.message);
        res.status(500).json({ success: false, message: "Failed to save strategy" });
    }
});

router.put("/update/:id", validateStrategy, async (req, res) => {
    try {
        const strategy = await strategyService.updateStrategy(req.params.id, req.body);
        res.json({ success: true, data: strategy });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message || "Failed to update strategy" });
    }
});

// Safe partial update for execution settings (quantity_multiplier, etc.)
// No validateStrategy middleware — we only merge specific fields into the existing config.
router.patch("/settings/:id", async (req, res) => {
    try {
        const strategy = await strategyService.patchExecutionSettings(req.params.id, req.body);
        res.json({ success: true, data: strategy });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message || "Failed to update execution settings" });
    }
});


router.delete("/delete/:id", async (req, res) => {
    try {
        await strategyService.deleteStrategy(req.params.id);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message || "Failed to delete strategy" });
    }
});

router.post("/execute/:id", async (req, res) => {
    try {
        const { is_paper_trading } = req.body;
        const strategyId = await strategyService.startStrategy(req.params.id, is_paper_trading);
        res.json({ success: true, strategy_id: strategyId });
    } catch (error) {
        console.error("Error starting strategy:", error.message);
        res.status(500).json({ success: false, message: "Failed to start strategy" });
    }
});

router.post("/squareoff/:id", async (req, res) => {
    try {
        await strategyService.squareOffStrategy(req.params.id);
        res.json({ success: true, message: "Strategy Squared Off" });
    } catch (error) {
        console.error("Error squaring off strategy:", error.message);
        res.status(500).json({ success: false, message: error.message || "Failed to square off strategy" });
    }
});

router.post("/squareoff/:id/leg/:legIndex", async (req, res) => {
    try {
        await strategyService.squareOffLeg(req.params.id, parseInt(req.params.legIndex));
        res.json({ success: true, message: "Leg Squared Off" });
    } catch (error) {
        console.error("Error squaring off leg:", error.message);
        res.status(500).json({ success: false, message: error.message || "Failed to square off leg" });
    }
});

router.post("/stop/:id", async (req, res) => {
    try {
        await strategyService.stopStrategy(req.params.id);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, message: "Failed to stop strategy" });
    }
});

router.post("/resume/:id", async (req, res) => {
    try {
        await strategyService.resumeStrategy(req.params.id);
        res.json({ success: true, message: "Strategy Resumed" });
    } catch (error) {
        console.error("Error resuming strategy:", error.message);
        res.status(500).json({ success: false, message: error.message || "Failed to resume strategy" });
    }
});

router.get("/user", async (req, res) => {
    try {
        const data = await strategyService.getUserStrategies();
        res.json({ success: true, data });
    } catch (error) {
        console.error("Error fetching user strategies:", error);
        res.status(500).json({ success: false, message: "Failed to fetch strategies", details: error.message });
    }
});

router.get("/active", async (req, res) => {
    try {
        const active = await strategyService.getActiveStrategies();
        res.json({ success: true, data: active });
    } catch (error) {
        console.error("Error fetching active strategies:", error);
        res.status(500).json({ success: false, message: "Failed to fetch active strategies", details: error.message });
    }
});

router.get("/history", async (req, res) => {
    try {
        const history = await strategyService.getExecutionHistory();
        res.json({ success: true, data: history });
    } catch (error) {
        console.error("Error fetching execution history:", error);
        res.status(500).json({ success: false, message: "Failed to fetch strategy history", details: error.message });
    }
});

router.get("/status/:id", async (req, res) => {
    try {
        const status = await strategyService.getStatus(req.params.id);
        if (!status) {
            return res.status(404).json({ success: false, message: "Strategy not found" });
        }
        res.json({ success: true, data: status });
    } catch (error) {
        console.error("Error fetching strategy status:", error);
        res.status(500).json({ success: false, message: "Failed to get strategy status", details: error.message });
    }
});

const BacktestEngine = require('../services/backtest/backtest.engine');

router.post("/backtest", async (req, res) => {
    try {
        const { strategyId, fromDate, toDate } = req.body;
        if (!strategyId || !fromDate || !toDate) {
            return res.status(400).json({ success: false, message: "strategyId, fromDate, toDate required" });
        }

        const engine = new BacktestEngine(strategyId, fromDate, toDate);
        const results = await engine.run();
        
        res.json({ success: true, data: results });
    } catch (error) {
        console.error("Error running backtest:", error);
        res.status(500).json({ success: false, message: "Failed to run backtest", details: error.message });
    }
});

router.post("/backtest/combined", async (req, res) => {
    try {
        const { strategyIds, fromDate, toDate } = req.body;
        if (!strategyIds || !Array.isArray(strategyIds) || !fromDate || !toDate) {
            return res.status(400).json({ success: false, message: "strategyIds array, fromDate, toDate required" });
        }

        const allResults = [];
        for (const strategyId of strategyIds) {
            const engine = new BacktestEngine(strategyId, fromDate, toDate);
            const results = await engine.run();
            results.strategyId = strategyId;
            // We should attach the strategyId to the trades to differentiate them in the UI
            results.trades.forEach(t => t.strategyId = strategyId);
            allResults.push(results);
        }

        // Combine all results
        const combined = {
            totalPnL: 0,
            trades: [],
            dailySummary: {},
            chartData: {}
        };

        allResults.forEach(res => {
            combined.totalPnL += res.totalPnL || 0;
            if (res.trades) combined.trades.push(...res.trades);
            
            if (res.dailySummary) {
                for (const [date, summary] of Object.entries(res.dailySummary)) {
                    if (!combined.dailySummary[date]) {
                        combined.dailySummary[date] = { pnl: 0, trade_value: 0, pnl_percent: 0, dtes: new Set(), expiries: new Set(), strategies: {} };
                    }
                    combined.dailySummary[date].pnl += summary.pnl || 0;
                    combined.dailySummary[date].trade_value += summary.trade_value || 0;
                    if(summary.dte !== undefined) combined.dailySummary[date].dtes.add(summary.dte);
                    if(summary.expiry) combined.dailySummary[date].expiries.add(summary.expiry);
                    combined.dailySummary[date].strategies[res.strategyId] = summary;
                }
            }

            if (res.chartData) {
                for (const [date, dayChart] of Object.entries(res.chartData)) {
                    if (!combined.chartData[date]) {
                        combined.chartData[date] = {};
                    }
                    for (const [key, data] of Object.entries(dayChart)) {
                        if (key === 'OVERALL_PNL') {
                            if (!combined.chartData[date]['OVERALL_PNL']) {
                                combined.chartData[date]['OVERALL_PNL'] = data.map(d => ({ ...d }));
                            } else {
                                const existing = combined.chartData[date]['OVERALL_PNL'];
                                data.forEach(d => {
                                    const match = existing.find(e => e.time === d.time);
                                    if (match) {
                                        match.pnl += d.pnl;
                                    } else {
                                        existing.push({ ...d });
                                    }
                                });
                                existing.sort((a, b) => a.time.localeCompare(b.time));
                            }
                        } else {
                            combined.chartData[date][`${res.strategyId || 'strat'}_${key}`] = data;
                        }
                    }
                }
            }
        });

        // Finalize dailySummary arrays and pnl_percent
        for (const [date, summary] of Object.entries(combined.dailySummary)) {
            summary.pnl_percent = summary.trade_value > 0 ? (summary.pnl / summary.trade_value) * 100 : 0;
            summary.dte = Array.from(summary.dtes)[0];
            summary.expiry = Array.from(summary.expiries)[0];
            delete summary.dtes;
            delete summary.expiries;
        }

        // Sort trades by exitTime
        combined.trades.sort((a, b) => (a.exitTime || '').localeCompare(b.exitTime || ''));

        res.json({ success: true, data: combined });
    } catch (error) {
        console.error("Error running combined backtest:", error);
        res.status(500).json({ success: false, message: "Failed to run combined backtest", details: error.message });
    }
});

module.exports = router;
