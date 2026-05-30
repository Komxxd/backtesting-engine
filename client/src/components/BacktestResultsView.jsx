import React, { useState } from 'react';
import { X, TrendingUp, TrendingDown, Clock, Activity, CalendarDays, Settings2 } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { StrategyConfigModal } from './StrategyConfigModal';

export const BacktestResultsView = ({ results, strategy }) => {
    if (!results) {
        return (
            <div className="h-full flex items-center justify-center">
                <div className="text-center space-y-3">
                    <Activity className="h-10 w-10 text-slate-300 mx-auto" />
                    <h3 className="text-sm font-semibold text-slate-600">No Backtest Results</h3>
                    <p className="text-xs text-slate-400">Run a backtest from the Strategies tab to see results here.</p>
                </div>
            </div>
        );
    }

    const { totalPnL, dailySummary, chartData, trades } = results;
    
    // Sort dates
    const dates = Object.keys(chartData || {}).sort();
    const [activeTab, setActiveTab] = useState('OVERVIEW');
    const [isConfigModalOpen, setIsConfigModalOpen] = useState(false);
    const [filterDTEs, setFilterDTEs] = useState([]);
    const [filterStrategy, setFilterStrategy] = useState('ALL');

    const availableDTEs = React.useMemo(() => {
        if (!dailySummary) return [];
        const dtes = new Set();
        Object.values(dailySummary).forEach(dayData => {
            if (typeof dayData === 'object' && dayData.dte !== undefined) {
                dtes.add(dayData.dte);
            }
        });
        return Array.from(dtes).sort((a, b) => a - b);
    }, [dailySummary]);

    const filteredDailySummary = React.useMemo(() => {
        if (!dailySummary) return {};
        
        const filtered = {};
        Object.entries(dailySummary).forEach(([date, dayData]) => {
            if (typeof dayData === 'object') {
                const stratData = filterStrategy !== 'ALL' && dayData.strategies 
                    ? (dayData.strategies[filterStrategy] || null)
                    : dayData;
                
                if (stratData && stratData.dte !== undefined) {
                    if (filterDTEs.length === 0 || filterDTEs.includes(stratData.dte)) {
                        filtered[date] = stratData;
                    }
                }
            }
        });
        return filtered;
    }, [dailySummary, filterDTEs, filterStrategy]);

    const isProfitable = totalPnL >= 0;

    const analytics = React.useMemo(() => {
        if (!filteredDailySummary) return [];
        
        const yearly = {};
        
        Object.entries(filteredDailySummary).forEach(([date, dayData]) => {
            const [yyyy, mm] = date.split('-');
            const dayPnL = typeof dayData === 'object' ? (dayData.pnl || 0) : (dayData || 0);

            if (!yearly[yyyy]) {
                yearly[yyyy] = {
                    year: yyyy,
                    months: { '01': 0, '02': 0, '03': 0, '04': 0, '05': 0, '06': 0, '07': 0, '08': 0, '09': 0, '10': 0, '11': 0, '12': 0 },
                    total: 0,
                    cumulativeBalance: 0,
                    maxBalance: 0,
                    mdd: 0,
                    mddDays: 0,
                    currentDrawdownDays: 0
                };
            }
            
            yearly[yyyy].months[mm] += dayPnL;
            yearly[yyyy].total += dayPnL;
            
            // Drawdown calculation
            yearly[yyyy].cumulativeBalance += dayPnL;
            if (yearly[yyyy].cumulativeBalance > yearly[yyyy].maxBalance) {
                yearly[yyyy].maxBalance = yearly[yyyy].cumulativeBalance;
                yearly[yyyy].currentDrawdownDays = 0;
            } else {
                yearly[yyyy].currentDrawdownDays += 1;
                const currentDrawdown = yearly[yyyy].cumulativeBalance - yearly[yyyy].maxBalance;
                if (currentDrawdown < yearly[yyyy].mdd) {
                    yearly[yyyy].mdd = currentDrawdown;
                }
                if (yearly[yyyy].currentDrawdownDays > yearly[yyyy].mddDays) {
                    yearly[yyyy].mddDays = yearly[yyyy].currentDrawdownDays;
                }
            }
        });

        return Object.values(yearly).sort((a, b) => a.year.localeCompare(b.year));
    }, [filteredDailySummary]);

    const overallStats = React.useMemo(() => {
        if (!filteredDailySummary) return null;
        
        const entries = Object.entries(filteredDailySummary).map(([date, d]) => ({ date, pnl: typeof d === 'object' ? (d.pnl || 0) : (d || 0) }));
        if (entries.length === 0) return null;
        
        let winningDays = [];
        let losingDays = [];
        let maxProfit = 0;
        let maxLoss = 0;
        
        let cumulativeBalance = 0;
        let maxBalance = 0;
        let maxDrawdown = 0;
        let currentDrawdownDays = 0;
        let maxDrawdownDays = 0;
        
        let currentDrawdownStartDate = null;
        let maxDrawdownStartDate = null;
        let maxDrawdownEndDate = null;

        let currentWinStreak = 0;
        let maxWinStreak = 0;
        let currentLoseStreak = 0;
        let maxLoseStreak = 0;

        entries.forEach(({date, pnl}) => {
            if (pnl > 0) {
                winningDays.push(pnl);
                currentWinStreak++;
                currentLoseStreak = 0;
                if (currentWinStreak > maxWinStreak) maxWinStreak = currentWinStreak;
            } else if (pnl < 0) {
                losingDays.push(pnl);
                currentLoseStreak++;
                currentWinStreak = 0;
                if (currentLoseStreak > maxLoseStreak) maxLoseStreak = currentLoseStreak;
            } else {
                currentWinStreak = 0;
                currentLoseStreak = 0;
            }
            
            if (pnl > maxProfit) maxProfit = pnl;
            if (pnl < maxLoss) maxLoss = pnl;

            // DD Calc
            cumulativeBalance += pnl;
            if (cumulativeBalance > maxBalance) {
                maxBalance = cumulativeBalance;
                currentDrawdownDays = 0;
                currentDrawdownStartDate = null;
            } else {
                if (currentDrawdownDays === 0) currentDrawdownStartDate = date;
                currentDrawdownDays++;
                const dd = cumulativeBalance - maxBalance;
                if (dd < maxDrawdown) maxDrawdown = dd;
                if (currentDrawdownDays > maxDrawdownDays) {
                    maxDrawdownDays = currentDrawdownDays;
                    maxDrawdownStartDate = currentDrawdownStartDate;
                    maxDrawdownEndDate = date;
                }
            }
        });

        const totalTrades = entries.length;
        const totalWin = winningDays.reduce((a, b) => a + b, 0);
        const totalLoss = losingDays.reduce((a, b) => a + b, 0);
        const dynamicTotalPnL = totalWin + totalLoss;
        
        const avgProfit = winningDays.length > 0 ? totalWin / winningDays.length : 0;
        const avgLoss = losingDays.length > 0 ? totalLoss / losingDays.length : 0;
        const avgTrade = dynamicTotalPnL / (totalTrades || 1);
        
        const winRate = (winningDays.length / totalTrades) * 100;
        const lossRate = (losingDays.length / totalTrades) * 100;

        const returnOnMDD = maxDrawdown !== 0 ? Math.abs(dynamicTotalPnL / maxDrawdown) : 0;
        const riskReward = avgLoss !== 0 ? Math.abs(avgProfit / avgLoss) : 0;
        
        const expectancy = ((winRate/100) * avgProfit) + ((lossRate/100) * avgLoss);
        const expectancyRatio = avgLoss !== 0 ? (expectancy / Math.abs(avgLoss)) : 0;

        return {
            totalPnL: dynamicTotalPnL,
            totalTrades,
            avgTrade,
            winRate,
            lossRate,
            avgProfit,
            avgLoss,
            maxProfit,
            maxLoss,
            maxDrawdown,
            maxDrawdownDays,
            maxDrawdownStartDate,
            maxDrawdownEndDate,
            returnOnMDD,
            riskReward,
            expectancyRatio,
            maxWinStreak,
            maxLoseStreak
        };
    }, [filteredDailySummary]);

    return (
        <div className="w-full h-[calc(100vh-76px)] flex flex-col bg-white overflow-hidden animate-in fade-in duration-200">
            {/* Header */}
                <div className="bg-slate-900 px-4 py-2 flex items-center justify-between shrink-0 border-b border-slate-800">
                    <div className="flex items-center gap-3">
                        <div className="h-8 w-8 rounded-lg bg-indigo-500/20 text-indigo-400 flex items-center justify-center">
                            <Activity className="h-4 w-4" />
                        </div>
                        <div>
                            <h3 className="text-[12px] font-bold text-white uppercase tracking-wider">{strategy?.name || 'Backtest Results'}</h3>
                            <p className="text-[9px] text-slate-400 font-medium">Historical Simulation Report</p>
                        </div>
                    </div>
                    
                    <div className="flex items-center gap-4">
                        <div className="bg-slate-800 text-slate-300 text-[10px] font-bold px-2 py-1 rounded border border-slate-700 flex items-center h-7 shadow-sm">
                            Tested on {strategy?.config?.quantity_multiplier || 1} lot(s)
                        </div>
                        <Button 
                            variant="outline" 
                            size="sm" 
                            className="bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700 hover:text-white h-7 text-xs px-2"
                            onClick={() => setIsConfigModalOpen(true)}
                        >
                            <Settings2 className="h-3 w-3 mr-1.5" />
                            View Config
                        </Button>
                    </div>
                </div>

                <div className="flex flex-1 overflow-hidden">
                    {/* Sidebar Tabs */}
                    <div className="w-40 bg-slate-50 border-r border-slate-100 flex flex-col overflow-y-auto shrink-0 custom-scrollbar">
                        <div className="p-2 border-b border-slate-100">
                            <div className="text-[9px] font-bold uppercase tracking-widest text-slate-400 flex items-center gap-1.5 ml-1">
                                <CalendarDays className="h-3 w-3" /> Trading Days
                            </div>
                        </div>
                        <div className="p-1.5 space-y-0.5">
                            <button 
                                onClick={() => setActiveTab('OVERVIEW')}
                                className={`w-full text-left px-2.5 py-1.5 rounded-md flex items-center justify-between transition-all ${
                                    activeTab === 'OVERVIEW'
                                        ? 'bg-white shadow-sm border border-slate-200 ring-1 ring-slate-200/50' 
                                        : 'hover:bg-slate-100 border border-transparent'
                                }`}
                            >
                                <span className={`text-[11px] font-bold ${activeTab === 'OVERVIEW' ? 'text-indigo-600' : 'text-slate-600'}`}>
                                    Analytics Overview
                                </span>
                            </button>
                            
                            <div className="my-1 border-t border-slate-100" />
                            {Object.keys(filteredDailySummary).sort().map(date => {
                                const daySummary = typeof filteredDailySummary[date] === 'object' ? filteredDailySummary[date] : { pnl: filteredDailySummary[date] || 0 };
                                const dayPnL = daySummary.pnl || 0;
                                const isDayProfitable = dayPnL >= 0;
                                return (
                                    <button 
                                        key={date}
                                        onClick={() => setActiveTab(date)}
                                        className={`w-full text-left px-2.5 py-1.5 rounded-md flex items-center justify-between transition-all ${
                                            activeTab === date 
                                                ? 'bg-white shadow-sm border border-slate-200 ring-1 ring-slate-200/50' 
                                                : 'hover:bg-slate-100 border border-transparent'
                                        }`}
                                    >
                                        <span className={`text-[11px] font-bold ${activeTab === date ? 'text-slate-800' : 'text-slate-600'}`}>
                                            {date}
                                        </span>
                                        <span className={`text-[9px] font-bold ${isDayProfitable ? 'text-emerald-600' : 'text-rose-600'}`}>
                                            {isDayProfitable ? '+' : ''}{dayPnL.toFixed(0)}
                                        </span>
                                    </button>
                                );
                            })}
                            {Object.keys(filteredDailySummary).length === 0 && (
                                <div className="p-2 text-center text-[10px] text-slate-500 font-medium">No dates traded</div>
                            )}
                        </div>
                    </div>

                    {/* Main Content Area */}
                    <div className="flex-1 flex flex-col bg-white overflow-hidden">
                        {activeTab === 'OVERVIEW' ? (
                            <div className="flex-1 overflow-y-auto p-4 sm:p-6 bg-slate-50 custom-scrollbar">
                                <div className="flex items-center justify-between mb-4">
                                    <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                                        <CalendarDays className="h-5 w-5 text-indigo-500" />
                                        Year-wise Returns
                                    </h2>
                                    
                                    <div className="flex items-center gap-4 flex-wrap">
                                        {availableDTEs.length > 0 && (
                                            <div className="flex items-center gap-2">
                                                <span className="text-xs font-semibold text-slate-500 mr-1">Filter DTE:</span>
                                                <div className="flex items-center gap-1.5 flex-wrap">
                                                    <button
                                                        onClick={() => setFilterDTEs([])}
                                                        className={`px-2.5 py-1 rounded text-[10px] font-bold transition-colors ${filterDTEs.length === 0 ? 'bg-indigo-500 text-white shadow-sm' : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'}`}
                                                    >
                                                        All
                                                    </button>
                                                    {availableDTEs.map(dte => (
                                                        <button
                                                            key={dte}
                                                            onClick={() => {
                                                                if (filterDTEs.includes(dte)) {
                                                                    setFilterDTEs(filterDTEs.filter(d => d !== dte));
                                                                } else {
                                                                    setFilterDTEs([...filterDTEs, dte]);
                                                                }
                                                            }}
                                                            className={`px-2.5 py-1 rounded text-[10px] font-bold transition-colors ${filterDTEs.includes(dte) ? 'bg-indigo-500 text-white shadow-sm' : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'}`}
                                                        >
                                                            DTE {dte}
                                                        </button>
                                                    ))}
                                                </div>
                                            </div>
                                        )}
                                        {strategy?.isCombined && strategy?.strategies?.length > 1 && (
                                            <div className="flex items-center gap-2 md:ml-2 md:border-l md:border-slate-200 md:pl-4">
                                                <span className="text-xs font-semibold text-slate-500 mr-1">Strategy:</span>
                                                <div className="flex items-center gap-1.5 flex-wrap">
                                                    <button
                                                        onClick={() => setFilterStrategy('ALL')}
                                                        className={`px-2.5 py-1 rounded text-[10px] font-bold transition-colors ${filterStrategy === 'ALL' ? 'bg-indigo-500 text-white shadow-sm' : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'}`}
                                                    >
                                                        Combined
                                                    </button>
                                                    {strategy.strategies.map((s, idx) => (
                                                        <button
                                                            key={s.id}
                                                            onClick={() => setFilterStrategy(s.id)}
                                                            className={`px-2.5 py-1 rounded text-[10px] font-bold transition-colors ${filterStrategy === s.id ? 'bg-indigo-500 text-white shadow-sm' : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'}`}
                                                        >
                                                            {s.name || s.config?.name || `Strategy ${idx + 1}`}
                                                        </button>
                                                    ))}
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                </div>
                                <div className="bg-white border border-slate-200 rounded-lg overflow-hidden shadow-sm overflow-x-auto mb-8">
                                    <table className="w-full text-[11px] text-left">
                                        <thead className="bg-slate-100/80 text-slate-500 font-medium text-[9px] uppercase tracking-wider border-b border-slate-200">
                                            <tr>
                                                <th className="px-3 py-2 font-semibold text-slate-700">Year</th>
                                                <th className="px-2 py-2 text-center">Jan</th>
                                                <th className="px-2 py-2 text-center">Feb</th>
                                                <th className="px-2 py-2 text-center">Mar</th>
                                                <th className="px-2 py-2 text-center">Apr</th>
                                                <th className="px-2 py-2 text-center">May</th>
                                                <th className="px-2 py-2 text-center">Jun</th>
                                                <th className="px-2 py-2 text-center">Jul</th>
                                                <th className="px-2 py-2 text-center">Aug</th>
                                                <th className="px-2 py-2 text-center">Sep</th>
                                                <th className="px-2 py-2 text-center">Oct</th>
                                                <th className="px-2 py-2 text-center">Nov</th>
                                                <th className="px-2 py-2 text-center">Dec</th>
                                                <th className="px-3 py-2 text-right font-semibold text-slate-700">Total</th>
                                                <th className="px-3 py-2 text-right text-rose-500/80">Max Drawdown</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-slate-100">
                                            {analytics.map(row => {
                                                const rmdd = row.mdd !== 0 ? Math.abs(row.total / row.mdd).toFixed(2) : '0.00';
                                                
                                                const formatMoney = (val) => {
                                                    if (!val || val === 0) return <span className="text-slate-300 font-bold">0</span>;
                                                    return (
                                                        <span className={val > 0 ? "text-emerald-600 font-bold" : "text-rose-600 font-bold"}>
                                                            {Math.round(val).toLocaleString()}
                                                        </span>
                                                    );
                                                };

                                                return (
                                                    <tr key={row.year} className="hover:bg-slate-50 transition-colors">
                                                        <td className="px-3 py-2 font-black text-slate-800">{row.year}</td>
                                                        {['01','02','03','04','05','06','07','08','09','10','11','12'].map(mm => (
                                                            <td key={mm} className="px-2 py-2 text-center text-[10px]">
                                                                {formatMoney(row.months[mm])}
                                                            </td>
                                                        ))}
                                                        <td className="px-3 py-2 text-right">
                                                            <span className={row.total > 0 ? "text-emerald-600 font-black text-[12px]" : "text-rose-600 font-black text-[12px]"}>
                                                                {Math.round(row.total).toLocaleString()}
                                                            </span>
                                                        </td>
                                                        <td className="px-3 py-2 text-right font-bold text-rose-500 text-[11px]">
                                                            {Math.round(row.mdd).toLocaleString()}
                                                        </td>
                                                    </tr>
                                                );
                                            })}
                                            {analytics.length === 0 && (
                                                <tr>
                                                    <td colSpan="15" className="px-4 py-8 text-center text-slate-400 font-medium">
                                                        No backtest data available to calculate analytics.
                                                    </td>
                                                </tr>
                                            )}
                                        </tbody>
                                    </table>
                                </div>
                                {overallStats && (
                                    <div className="mt-8 mb-4">
                                        <h2 className="text-lg font-bold text-slate-800 mb-4 flex items-center gap-2">
                                            <Activity className="h-5 w-5 text-indigo-500" />
                                            Strategy Performance
                                        </h2>
                                        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                                            {/* Column 1 */}
                                            <div className="bg-white border border-slate-200 rounded-lg shadow-sm overflow-hidden text-[11px]">
                                                <div className="flex justify-between items-center p-3 border-b border-slate-100">
                                                    <span className="text-slate-600 font-medium">Overall Profit</span>
                                                    <span className={overallStats.totalPnL >= 0 ? "text-emerald-600 font-bold text-[12px]" : "text-rose-600 font-bold text-[12px]"}>₹{overallStats.totalPnL.toFixed(2)}</span>
                                                </div>
                                                <div className="flex justify-between items-center p-3 border-b border-slate-100">
                                                    <span className="text-slate-600 font-medium">No. of Trades</span>
                                                    <span className="text-slate-800 font-bold">{overallStats.totalTrades}</span>
                                                </div>
                                                <div className="flex justify-between items-center p-3 border-b border-slate-100">
                                                    <span className="text-slate-600 font-medium">Average Profit per Trade</span>
                                                    <span className={overallStats.avgTrade >= 0 ? "text-emerald-600 font-bold" : "text-rose-600 font-bold"}>₹{overallStats.avgTrade.toFixed(2)}</span>
                                                </div>
                                                <div className="flex justify-between items-center p-3 border-b border-slate-100">
                                                    <span className="text-slate-600 font-medium">Win %</span>
                                                    <span className="text-slate-800 font-bold">{overallStats.winRate.toFixed(2)}%</span>
                                                </div>
                                                <div className="flex justify-between items-center p-3 border-b border-slate-100">
                                                    <span className="text-slate-600 font-medium">Loss %</span>
                                                    <span className="text-slate-800 font-bold">{overallStats.lossRate.toFixed(2)}%</span>
                                                </div>
                                                <div className="flex justify-between items-center p-3">
                                                    <span className="text-slate-600 font-medium">Average Profit on Winning Trades</span>
                                                    <span className="text-emerald-600 font-bold">₹{overallStats.avgProfit.toFixed(2)}</span>
                                                </div>
                                            </div>

                                            {/* Column 2 */}
                                            <div className="bg-white border border-slate-200 rounded-lg shadow-sm overflow-hidden text-[11px]">
                                                <div className="flex justify-between items-center p-3 border-b border-slate-100">
                                                    <span className="text-slate-600 font-medium">Average Loss on Losing Trades</span>
                                                    <span className="text-rose-600 font-bold">₹{overallStats.avgLoss.toFixed(2)}</span>
                                                </div>
                                                <div className="flex justify-between items-center p-3 border-b border-slate-100">
                                                    <span className="text-slate-600 font-medium">Max Profit in Single Trade</span>
                                                    <span className="text-emerald-600 font-bold">₹{overallStats.maxProfit.toFixed(2)}</span>
                                                </div>
                                                <div className="flex justify-between items-center p-3 border-b border-slate-100">
                                                    <span className="text-slate-600 font-medium">Max Loss in Single Trade</span>
                                                    <span className="text-rose-600 font-bold">₹{overallStats.maxLoss.toFixed(2)}</span>
                                                </div>
                                                <div className="flex justify-between items-center p-3 border-b border-slate-100">
                                                    <span className="text-slate-600 font-medium">Max Drawdown</span>
                                                    <span className="text-rose-600 font-bold">₹{overallStats.maxDrawdown.toFixed(2)}</span>
                                                </div>
                                                <div className="flex justify-between items-center p-3">
                                                    <span className="text-slate-600 font-medium">Duration of Max Drawdown</span>
                                                    <span className="text-slate-800 font-bold text-right leading-tight">
                                                        {overallStats.maxDrawdownDays} 
                                                        {overallStats.maxDrawdownStartDate && overallStats.maxDrawdownEndDate && (
                                                            <span className="block text-[9px] text-slate-400 font-medium">
                                                                [{new Date(overallStats.maxDrawdownStartDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'numeric', year: 'numeric'})} to {new Date(overallStats.maxDrawdownEndDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'numeric', year: 'numeric'})}]
                                                            </span>
                                                        )}
                                                    </span>
                                                </div>
                                            </div>

                                            {/* Column 3 */}
                                            <div className="bg-white border border-slate-200 rounded-lg shadow-sm overflow-hidden text-[11px]">
                                                <div className="flex justify-between items-center p-3 border-b border-slate-100">
                                                    <span className="text-slate-600 font-medium">Return / MaxDD</span>
                                                    <span className="text-slate-800 font-bold">{overallStats.returnOnMDD.toFixed(2)}</span>
                                                </div>
                                                <div className="flex justify-between items-center p-3 border-b border-slate-100">
                                                    <span className="text-slate-600 font-medium">Reward to Risk Ratio</span>
                                                    <span className="text-slate-800 font-bold">{overallStats.riskReward.toFixed(2)}</span>
                                                </div>
                                                <div className="flex justify-between items-center p-3 border-b border-slate-100">
                                                    <span className="text-slate-600 font-medium">Expectancy Ratio</span>
                                                    <span className="text-slate-800 font-bold">{overallStats.expectancyRatio.toFixed(2)}</span>
                                                </div>
                                                <div className="flex justify-between items-center p-3 border-b border-slate-100">
                                                    <span className="text-slate-600 font-medium">Max Win Streak (trades)</span>
                                                    <span className="text-emerald-600 font-bold">{overallStats.maxWinStreak}</span>
                                                </div>
                                                <div className="flex justify-between items-center p-3 border-b border-slate-100">
                                                    <span className="text-slate-600 font-medium">Max Losing Streak (trades)</span>
                                                    <span className="text-rose-600 font-bold">{overallStats.maxLoseStreak}</span>
                                                </div>
                                                <div className="flex justify-between items-center p-3">
                                                    <span className="text-slate-600 font-medium">Max trades in any drawdown</span>
                                                    <span className="text-slate-800 font-bold">{overallStats.maxDrawdownDays}</span>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                )}
                            </div>
                        ) : (
                            <>
                                <div className="px-4 py-3 border-b border-slate-100 flex justify-between items-center bg-slate-50/50 shrink-0">
                            <div>
                                <h4 className="text-[12px] font-bold text-slate-800 flex items-center gap-1.5 mb-0.5">
                                    <Clock className="h-3.5 w-3.5 text-indigo-500" /> 
                                    Market Data & Actions: {activeTab}
                                </h4>
                                {(() => {
                                    const activeSummary = typeof dailySummary[activeTab] === 'object' ? dailySummary[activeTab] : { pnl: dailySummary[activeTab] || 0, trade_value: 0, pnl_percent: 0 };
                                    const config = strategy?.config || {};
                                    const multiplier = parseFloat(config.quantity_multiplier) || 1;
                                    
                                    let overallSlStr = null;
                                    if (config.overall_sl_enabled && parseFloat(config.overall_sl_value) > 0) {
                                        const val = parseFloat(config.overall_sl_value);
                                        overallSlStr = config.overall_sl_type === 'AMOUNT' ? `₹${(val * multiplier).toLocaleString()}` : `${val}%`;
                                    }

                                    let overallTgtStr = null;
                                    if (config.overall_target_enabled && parseFloat(config.overall_target_value) > 0) {
                                        const val = parseFloat(config.overall_target_value);
                                        overallTgtStr = config.overall_target_type === 'AMOUNT' ? `₹${(val * multiplier).toLocaleString()}` : `${val}%`;
                                    }

                                    return (
                                        <div className="flex items-center gap-3 text-[10px] text-slate-500">
                                            <span>Trade Value: <strong className="text-slate-700">₹{Math.round(activeSummary.trade_value || 0).toLocaleString()}</strong></span>
                                            {overallSlStr && <span>• Target SL: <strong className="text-rose-600">{overallSlStr}</strong></span>}
                                            {overallTgtStr && <span>• Target Profit: <strong className="text-emerald-600">{overallTgtStr}</strong></span>}
                                        </div>
                                    );
                                })()}
                            </div>
                            <div className="text-right">
                                <div className="text-[9px] font-bold uppercase tracking-widest text-slate-400 mb-0.5">Daily Result</div>
                                {(() => {
                                    const daySummary = typeof dailySummary[activeTab] === 'object' ? dailySummary[activeTab] : { pnl: dailySummary[activeTab] || 0, pnl_percent: 0 };
                                    const dayPnL = daySummary.pnl || 0;
                                    const pnlPercent = daySummary.pnl_percent || 0;
                                    const isDayProfitable = dayPnL >= 0;
                                    return (
                                        <div className={`text-sm font-black ${isDayProfitable ? 'text-emerald-500' : 'text-rose-500'} flex items-center justify-end gap-1.5`}>
                                            ₹{dayPnL.toFixed(2)}
                                            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-slate-100 font-bold ml-1 text-slate-600">
                                                {isDayProfitable ? '+' : ''}{pnlPercent.toFixed(2)}%
                                            </span>
                                        </div>
                                    );
                                })()}
                            </div>
                        </div>                        <div className="flex-1 overflow-auto p-0 relative custom-scrollbar bg-white">
                            {Object.keys(chartData && chartData[activeTab] ? chartData[activeTab] : {}).length > 0 ? (() => {
                                const legs = Object.keys(chartData[activeTab]).filter(k => k !== 'OVERALL_PNL');
                                const firstLeg = legs[0];
                                const rowData = chartData[activeTab][firstLeg];
                                
                                return (
                                    <table className="w-full text-left border-collapse min-w-max">
                                        <thead className="sticky top-0 z-20 backdrop-blur-sm bg-slate-100/90 shadow-sm text-[9px] uppercase tracking-wider text-slate-500">
                                            <tr>
                                                <th rowSpan={2} className="px-3 py-2 font-bold border-b border-r border-slate-200 text-center align-middle bg-slate-200/50 shadow-[inset_0_-1px_0_rgba(0,0,0,0.1)]">
                                                    Time
                                                </th>
                                                {legs.map(leg => (
                                                    <th key={leg} colSpan={6} className="px-2 py-1.5 font-extrabold border-b border-r border-slate-200 text-center text-slate-700 bg-slate-100 shadow-[inset_0_-1px_0_rgba(0,0,0,0.1)]">
                                                        <span className={leg.includes('CE') ? 'text-emerald-600' : 'text-rose-600'}>{leg}</span>
                                                    </th>
                                                ))}
                                                <th rowSpan={2} className="px-3 py-2 font-bold border-b border-slate-200 text-center align-middle bg-slate-200/50 shadow-[inset_0_-1px_0_rgba(0,0,0,0.1)] text-slate-700">
                                                    Overall PnL
                                                </th>
                                            </tr>
                                            <tr>
                                                {legs.map(leg => (
                                                    <React.Fragment key={`${leg}-sub`}>
                                                        <th className="px-2 py-1 font-semibold border-b border-slate-200 text-right bg-slate-50/80">Open</th>
                                                        <th className="px-2 py-1 font-semibold border-b border-slate-200 text-right bg-slate-50/80">High</th>
                                                        <th className="px-2 py-1 font-semibold border-b border-slate-200 text-right bg-slate-50/80">Low</th>
                                                        <th className="px-2 py-1 font-semibold border-b border-slate-200 text-right bg-slate-50/80">Close</th>
                                                        <th className="px-2 py-1 font-semibold border-b border-slate-200 text-right bg-slate-50/80">PnL</th>
                                                        <th className="px-2 py-1 font-semibold border-b border-r border-slate-200 bg-slate-50/80">Action</th>
                                                    </React.Fragment>
                                                ))}
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-slate-100 text-[10px]">
                                            {rowData.map((row, idx) => {
                                                const timeStr = row.time?.includes('T') ? row.time.substring(11, 16) : row.time?.substring(0, 5) || '-';
                                                const overallRow = chartData[activeTab]['OVERALL_PNL']?.[idx];
                                                
                                                return (
                                                    <tr key={idx} className="hover:bg-indigo-50/40 transition-colors group">
                                                        <td className="px-3 py-1 font-semibold text-slate-600 tabular-nums border-r border-slate-100 text-center bg-slate-50/50 group-hover:bg-indigo-50/60">
                                                            {timeStr}
                                                        </td>
                                                        {legs.map(leg => {
                                                            const legRow = chartData[activeTab][leg][idx];
                                                            if (!legRow) return <td colSpan={6} key={`${leg}-${idx}`} className="border-r border-slate-100"></td>;
                                                            return (
                                                                <React.Fragment key={`${leg}-${idx}`}>
                                                                    <td className="px-2 py-1 text-right font-mono text-slate-500">{legRow.open?.toFixed(2)}</td>
                                                                    <td className="px-2 py-1 text-right font-mono text-emerald-600/80">{legRow.high?.toFixed(2)}</td>
                                                                    <td className="px-2 py-1 text-right font-mono text-rose-600/80">{legRow.low?.toFixed(2)}</td>
                                                                    <td className="px-2 py-1 text-right font-mono font-bold text-slate-800">{legRow.close?.toFixed(2)}</td>
                                                                    <td className="px-2 py-1 text-right font-mono font-bold">
                                                                        <span className={legRow.pnl > 0 ? "text-emerald-600" : legRow.pnl < 0 ? "text-rose-600" : "text-slate-400"}>
                                                                            {legRow.pnl > 0 ? '+' : ''}{legRow.pnl?.toFixed(2) || '0.00'}
                                                                        </span>
                                                                    </td>
                                                                    <td className="px-2 py-1 border-r border-slate-100">
                                                                        {legRow.action ? (
                                                                            <span className="text-indigo-700 bg-indigo-100/60 px-1.5 py-0.5 rounded text-[9px] inline-block shadow-sm ring-1 ring-indigo-200/50 font-medium whitespace-pre-wrap break-words" title={legRow.action}>
                                                                                {legRow.action}
                                                                            </span>
                                                                        ) : <span className="text-slate-300">-</span>}
                                                                    </td>
                                                                </React.Fragment>
                                                            );
                                                        })}
                                                        <td className="px-3 py-1 text-center font-mono font-black bg-slate-50/50 group-hover:bg-indigo-50/60 text-[11px]">
                                                            {overallRow && (
                                                                <span className={overallRow.pnl > 0 ? "text-emerald-600" : overallRow.pnl < 0 ? "text-rose-600" : "text-slate-400"}>
                                                                    {overallRow.pnl > 0 ? '+' : ''}{overallRow.pnl?.toFixed(2) || '0.00'}
                                                                </span>
                                                            )}
                                                        </td>
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                );
                            })() : (
                                <div className="w-full h-full flex items-center justify-center text-slate-400 text-sm font-medium">
                                    No options data available for this date.
                                </div>
                            )}
                        </div>
                            </>
                        )}
                    </div>
                </div>

            <StrategyConfigModal 
                isOpen={isConfigModalOpen} 
                onClose={() => setIsConfigModalOpen(false)} 
                config={strategy?.config} 
                strategyName={strategy?.name} 
            />
        </div>
    );
};
