import React, { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';

export const TradesSummaryTable = ({ trades = [], filteredDailySummary = {} }) => {
    // We group the trades by date
    const tradesByDate = {};
    trades.forEach(t => {
        if (!tradesByDate[t.date]) tradesByDate[t.date] = [];
        tradesByDate[t.date].push(t);
    });

    // Only show dates that are present in filteredDailySummary
    const sortedDates = Object.keys(filteredDailySummary).sort((a, b) => b.localeCompare(a));
    
    const [expandedDates, setExpandedDates] = useState(new Set());
    const [currentPage, setCurrentPage] = useState(1);
    const rowsPerPage = 20;

    React.useEffect(() => {
        setCurrentPage(1);
    }, [filteredDailySummary]);

    const toggleRow = (date) => {
        const newSet = new Set(expandedDates);
        if (newSet.has(date)) newSet.delete(date);
        else newSet.add(date);
        setExpandedDates(newSet);
    };

    if (sortedDates.length === 0) return null;

    const totalPages = Math.ceil(sortedDates.length / rowsPerPage);
    const currentDates = sortedDates.slice((currentPage - 1) * rowsPerPage, currentPage * rowsPerPage);


    return (
        <div className="bg-white border border-slate-200 rounded-lg shadow-sm overflow-hidden mt-6">
            <div className="px-4 py-3 border-b border-slate-200 bg-slate-50 flex justify-between items-center">
                <h3 className="text-[12px] font-bold text-slate-700 uppercase tracking-wider">Trades Summary</h3>
                <div className="text-[10px] text-slate-500 font-medium">Grouped by Date</div>
            </div>
            <div className="overflow-x-auto custom-scrollbar">
                <table className="w-full text-[11px] text-left">
                    <thead className="bg-slate-50/50 text-slate-500 font-bold uppercase tracking-wider sticky top-0">
                        <tr>
                            <th className="px-4 py-2 border-b border-slate-200 w-8"></th>
                            <th className="px-3 py-2 border-b border-slate-200">Entry Date</th>
                            <th className="px-3 py-2 border-b border-slate-200">Entry Time</th>
                            <th className="px-3 py-2 border-b border-slate-200">Exit Date</th>
                            <th className="px-3 py-2 border-b border-slate-200">Exit Time</th>
                            <th className="px-3 py-2 border-b border-slate-200">Type</th>
                            <th className="px-3 py-2 border-b border-slate-200">Strike</th>
                            <th className="px-3 py-2 border-b border-slate-200">Buy/Sell</th>
                            <th className="px-3 py-2 border-b border-slate-200 text-right">Qty</th>
                            <th className="px-3 py-2 border-b border-slate-200 text-right">Entry Price</th>
                            <th className="px-3 py-2 border-b border-slate-200 text-right">Exit Price</th>
                            <th className="px-4 py-2 border-b border-slate-200 text-right">PnL</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                        {currentDates.map((date, index) => {
                            const globalIndex = (currentPage - 1) * rowsPerPage + index;
                            const summary = typeof filteredDailySummary[date] === 'object' ? filteredDailySummary[date] : { pnl: filteredDailySummary[date] };
                            const dayTrades = tradesByDate[date] || [];
                            const isExpanded = expandedDates.has(date);
                            const overallPnL = summary.pnl || 0;
                            
                            // Find overall entry/exit times
                            let firstEntry = '-';
                            let lastExit = '-';
                            if (dayTrades.length > 0) {
                                // sort by entry time
                                const sortedT = [...dayTrades].sort((a, b) => a.entry_time.localeCompare(b.entry_time));
                                firstEntry = sortedT[0].entry_time;
                                // sort by exit time
                                const sortedE = [...dayTrades].sort((a, b) => {
                                    if(!a.exit_time) return 1;
                                    if(!b.exit_time) return -1;
                                    return b.exit_time.localeCompare(a.exit_time);
                                });
                                lastExit = sortedE[0].exit_time || '-';
                            }
                            
                            return (
                                <React.Fragment key={date}>
                                    <tr 
                                        className="hover:bg-slate-50 transition-colors cursor-pointer group"
                                        onClick={() => toggleRow(date)}
                                    >
                                        <td className="px-4 py-2 text-slate-400 group-hover:text-indigo-600 transition-colors flex items-center gap-1.5">
                                            {isExpanded ? <ChevronDown className="w-4 h-4 shrink-0" /> : <ChevronRight className="w-4 h-4 shrink-0" />}
                                            <span className="text-[10px] font-bold text-slate-400">{globalIndex + 1}</span>
                                        </td>
                                        <td className="px-3 py-2 font-bold text-slate-700">{date}</td>
                                        <td className="px-3 py-2 font-medium text-slate-600">{firstEntry}</td>
                                        <td className="px-3 py-2 font-bold text-slate-700">{date}</td>
                                        <td className="px-3 py-2 font-medium text-slate-600">{lastExit}</td>
                                        <td className="px-3 py-2 text-slate-400">-</td>
                                        <td className="px-3 py-2 text-slate-400">-</td>
                                        <td className="px-3 py-2 text-slate-400">-</td>
                                        <td className="px-3 py-2 text-slate-400 text-right">-</td>
                                        <td className="px-3 py-2 text-slate-400 text-right">-</td>
                                        <td className="px-3 py-2 text-slate-400 text-right">-</td>
                                        <td className={`px-4 py-2 font-bold text-right ${overallPnL >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                                            {overallPnL > 0 ? '+' : ''}₹{Math.round(overallPnL).toLocaleString()}
                                        </td>
                                    </tr>
                                    
                                    {isExpanded && dayTrades.map((t, idx) => {
                                        // Match the type/strike
                                        const typeMatch = t.symbol ? t.symbol.split('_') : [];
                                        const strike = typeMatch[0] || '-';
                                        const optType = typeMatch[1] || '-';
                                        
                                        return (
                                            <tr key={`${date}-${idx}`} className="bg-slate-50/50 hover:bg-slate-100 transition-colors">
                                                <td className="px-4 py-1.5 text-slate-300 text-right text-[9px] font-bold">{globalIndex + 1}.{idx + 1}</td>
                                                <td className="px-3 py-1.5 text-slate-500">{t.date}</td>
                                                <td className="px-3 py-1.5 text-slate-600 font-medium">{t.entry_time}</td>
                                                <td className="px-3 py-1.5 text-slate-500">{t.date}</td>
                                                <td className="px-3 py-1.5 text-slate-600 font-medium">{t.exit_time || '-'}</td>
                                                <td className={`px-3 py-1.5 font-bold ${optType === 'CE' ? 'text-emerald-600' : (optType === 'PE' ? 'text-rose-600' : 'text-slate-500')}`}>{optType}</td>
                                                <td className="px-3 py-1.5 text-slate-700 font-bold">{strike}</td>
                                                <td className={`px-3 py-1.5 font-bold ${t.side === 'BUY' ? 'text-indigo-600' : 'text-amber-600'}`}>{t.side}</td>
                                                <td className="px-3 py-1.5 text-slate-700 text-right font-medium">{t.qty}</td>
                                                <td className="px-3 py-1.5 text-slate-700 text-right">₹{t.entry_price?.toFixed(2) || '0.00'}</td>
                                                <td className="px-3 py-1.5 text-slate-700 text-right">
                                                    {t.exit_price ? `₹${t.exit_price.toFixed(2)}` : '-'}
                                                </td>
                                                <td className={`px-4 py-1.5 font-bold text-right ${(t.pnl || 0) >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                                                    {(t.pnl || 0) > 0 ? '+' : ''}₹{Math.round(t.pnl || 0).toLocaleString()}
                                                    {t.exit_reason && <div className="text-[9px] text-slate-400 font-normal uppercase tracking-wider">{t.exit_reason}</div>}
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </React.Fragment>
                            );
                        })}
                    </tbody>
                </table>
            </div>
            
            {totalPages > 1 && (
                <div className="px-4 py-3 border-t border-slate-200 bg-slate-50 flex items-center justify-between">
                    <div className="text-[11px] text-slate-500 font-medium">
                        Showing <span className="font-bold text-slate-700">{(currentPage - 1) * rowsPerPage + 1}</span> to <span className="font-bold text-slate-700">{Math.min(currentPage * rowsPerPage, sortedDates.length)}</span> of <span className="font-bold text-slate-700">{sortedDates.length}</span> days
                    </div>
                    <div className="flex items-center gap-1">
                        <button 
                            disabled={currentPage === 1}
                            onClick={() => setCurrentPage(p => p - 1)}
                            className="px-2.5 py-1 text-[11px] font-bold text-slate-600 bg-white border border-slate-200 rounded hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                        >
                            Previous
                        </button>
                        <div className="px-3 py-1 text-[11px] font-bold text-slate-700 bg-slate-100 border border-slate-200 rounded">
                            {currentPage} / {totalPages}
                        </div>
                        <button 
                            disabled={currentPage === totalPages}
                            onClick={() => setCurrentPage(p => p + 1)}
                            className="px-2.5 py-1 text-[11px] font-bold text-slate-600 bg-white border border-slate-200 rounded hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                        >
                            Next
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
};
