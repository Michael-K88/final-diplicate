# Deriv Bot

## Overview
A React-based trading bot builder application (Deriv Bot) that allows users to create automated trading strategies using a visual block-based editor (Blockly). Built with TypeScript, React 18, and rsbuild as the build tool.

## Recent Changes
- 2026-03-12: Batch Trader - fixed right-panel showing "Bot is not running" / empty state after batch trades. Root cause: RunPanelStore has a MobX reaction `() => !is_running` that immediately resets `contract_stage` to NOT_RUNNING whenever `is_running` is false. Fix: now calls `run_panel.setIsRunning(true)` FIRST (in same runInAction), then `toggleDrawer(true)`, `setActiveTabIndex(1)` (Transactions tab), `setContractStage(STARTING)`. After all settlements, resets `setIsRunning(false)` + `setHasOpenContract(false)` + `setContractStage(NOT_RUNNING)` after 5s delay.
- 2026-03-12: Batch Trader - parallel execution grouped in batches of 5 to avoid Deriv API rate limits. All trades in each group fire simultaneously (same tick = same entry/exit spot). Settlements watched concurrently.
- 2026-03-12: Batch Trader - fixed duplicate rows in right-hand Transactions panel. Root cause: `onBotContractEvent` was called 3x per trade (on buy, on POC update, on settlement), creating multiple entries. Fix: removed buy-event and intermediate POC pushes; now calls `onBotContractEvent` exactly ONCE per trade inside `handleSettlement`, guaranteeing one clean row per settled contract.
- 2026-03-12: Batch Trader - fixed all trading issues: (1) added missing `delayMs` state that caused Risk tab crash, (2) switched from parallel `Promise.allSettled` to sequential `for` loop so API doesn't rate-limit duplicate requests, (3) all inputs changed to `type='text' inputMode='decimal|numeric'` so stake/bulk-count/ticks can be fully cleared and retyped on mobile, (4) default stake changed to 0.35, (5) per-trade errors shown inline without stopping the batch, (6) stop button properly halts sequential loop via `stopBatchRef`.
- 2026-03-12: Redesigned splash screen — full-screen dark navy gradient, animated canvas particles, the Blue Traders BT logo (public/blue-traders-logo.png) centered with floating animation and gold ring pulse, gold gradient "BLUE TRADERS" title, italic "Mastering The Market" tagline, stats row (24/7 / 0.5s / 100+), gold-dot progress bar with shimmer and dynamic status labels (INITIALIZING → LOADING BOTS → PREPARING TOOLS → READY).
- 2026-03-12: Fixed Free Bots (and Smart Trader) scroll on mobile and desktop — root cause was bare wrapper `<div>` in main.tsx having no height, breaking the CSS Grid `auto/1fr` layout inside `.dc-tabs`. Fix: added `main__tabs-wrapper` class; when tabs 0–2 are active adds `--with-content` modifier giving it `flex: 1; min-height: 0` and forcing `.dc-tabs { height: 100% }`, completing the height chain so `.free-bots { overflow-y: auto }` can scroll.
- 2026-03-12: Fixed Batch Trader transactions not showing in right-hand RunPanel. Root cause: TransactionsStore keys data by client.loginid (from ClientStore), but ClientStore.loginid was never set when Batch Trader auth'd independently. Fix: after authorize(), call client.setLoginId() and client.setIsLoggedIn(true) on the shared store. Also improved POC subscription: message listener added BEFORE api.send() to avoid missing fast-settling 1-tick contracts; settlement handled in both initial POC response and subsequent messages; handleSettlement extracted to prevent double-counting.
- 2026-03-12: Batch Trader redesigned to use existing Deriv account auth (no manual token entry). Auto-authorizes via V2GetActiveToken() from localStorage. Trades push to right-hand RunPanel (Transactions/Summary) via transactions.onBotContractEvent(). RunPanel drawer auto-opens on trade. Digit 0 fixed using pip_size from API. Free bots mobile scroll fixed. Buttons always clickable with error message when not logged in.
- 2026-03-05: Batch Trader digit stats enhanced - dark gray circle backgrounds (#2d3748) matching reference screenshot, red pulsing cursor indicator on active tick digit, ranking-based color system (green=most appearing, blue=2nd most, yellow=2nd least, red=least appearing). Separate unauthenticated WebSocket for tick streaming so stats update immediately on market selection without needing auth. Ref-based tick handler prevents unnecessary re-renders.
- 2026-03-05: Batch Trader UI completely redesigned - clean white card layout with vertical nav sidebar (Trade/Stats/Log/Risk sections), SVG circular digit ring charts for statistics, gradient action buttons (green/red) showing live percentages. CSS class prefix changed from `bt` to `bbt`. Light background (#f3f4f6), white cards with subtle shadows, centered single-column form layout matching reference design.
- 2026-03-05: DTrader iframe now preloads on app mount (pre-added to visitedIframeTabs) so it starts loading immediately instead of waiting for user to click the tab. Significantly faster first load.
- 2026-03-05: Free Bots reordered and cleaned up. Removed: Differs-ODD-EVEN, legoospeedbot. New order: Gold Miner Pro, Bandwagon Entry Point Bot, Upgraded Candle Mine, Super Elite, Greenprint Profit Bot, then remaining bots. Updated both bots.json manifest and hardcoded fallback list.
- 2026-03-05: Batch Trader moved to tab bar after DTrader (tab index 4). Removed separate route/header nav button. Tab order: Bot Builder(0), Free Bots(1), Smart Trader(2), DTrader(3), Batch Trader(4), TradingView(5), Analysis Tool(6), Signals(7). Persistent panel pattern maintained.
- 2026-03-04: Added Batch Trader tool - professional batch buying tool connected to Deriv WebSocket API. Supports Odd/Even, Over/Under, Matches/Differs, Rise/Fall contract types across 13 volatility indices. Features: token auth, bulk trade execution, digit statistics (last 1000 ticks), live P/L tracking, trade log, risk controls (stop loss/take profit), configurable delay between trades. Dark dashboard theme matching app aesthetic.
- 2026-03-04: Fixed DTrader and all iframe tabs (TradingView, Analysis Tool, Signals) being very slow. Moved iframe-based tabs outside the Tabs component so they persist across tab switches instead of being destroyed/recreated. Iframes mount on first visit and stay mounted. Removed loading='lazy' from IframeWrapper for immediate load.
- 2026-03-04: Reverted Analysis Tool header back to original Binarytool (removed custom "Blue Traders Analysis Tool" header). Fixed tab bar font color - all tab items now use white (#ffffff) text always, including after clicking/active state. Previously active tabs used var(--text-prominent) which turned black in light mode.
- 2026-03-04: Fixed Quantum Market Scanner overlap with Summary/Transactions/Journal panel. Scanner width now dynamically adjusts based on drawer state (calc(100% - 36.6rem) when open, 100% when closed). Enhanced vertical scrollbar with blue gradient thumb (10px wide). Adjusted grid breakpoints for drawer-open state.
- 2026-03-04: Quantum Market Scanner now uses only 13 specific volatility indices (Vol 10/10(1s)/15(1s)/25/25(1s)/30(1s)/50/50(1s)/75/75(1s)/90(1s)/100/100(1s)) instead of all synthetic markets. Added visible vertical scrollbar. Fixed layout to fit window without overwrapping.
- 2026-03-04: Enlarged Quantum Market Scanner - 4-column grid (was 6), ~35% larger fonts, bigger digit circles (28px), thicker borders (2px), more padding. Removed Copy Trading tab entirely. Tabs now: Bot Builder(0), Free Bots(1), Smart Trader(2), DTrader(3).
- 2026-03-04: Quantum Market Scanner redesigned as dark dashboard. All 12 signal types shown in grid (OVER 2, UNDER 7, HIGHER, LOWER, ODD, OVER 3, UNDER 6, EVEN, RISE, FALL, MATCHES, DIFFERS). Each card shows best 2 markets with confidence %, colored entry digit circles, reasoning, and tick duration. LIVE badge with timestamp. Color-coded borders per signal type.
- 2026-03-04: Removed Pro Tool menu. Replaced Smart Trader with Quantum Market Scanner - real-time signal scanner across all synthetic markets. Analyzes 150-tick history with configurable confidence thresholds.
- 2026-03-04: Fixed tab bar active state - removed transparent background override so active tab keeps its highlighted background persistently.
- 2026-03-04: Renamed Analysis Tool header from "Binarytool" to "Blue Traders Analysis Tool".
- 2026-03-04: Fixed Run button visibility - increased z-index to 10 on desktop, added fixed mobile controls bar at bottom. Made Run button bright green (#008832) for visibility.
- 2026-03-04: Updated tab bar - white text on dark background, proper hover states with persistent visibility.
- 2026-02-20: Renamed site to "Blue Traders" (bluetraders.site), added splash screen with live market data animation, progress bar, and navy blue branding.
- 2026-02-20: Changed theme color to navy blue (#003366) - updated color palette across all accent colors, buttons, tabs, badges, and status indicators. Default theme set to light mode.
- 2026-02-20: Initial Replit environment setup - configured rsbuild for port 5000, installed dependencies, set up workflow and deployment.

## Project Architecture
- **Build Tool**: rsbuild (rspack-based)
- **Language**: TypeScript + React 18
- **Styling**: SCSS/Sass
- **State Management**: MobX
- **Routing**: React Router v6
- **Testing**: Jest + React Testing Library
- **Entry Point**: `src/main.tsx`
- **Config**: `rsbuild.config.ts`
- **HTML Template**: `index.html`

### Key Directories
- `src/` - Application source code
- `src/components/` - React components
- `src/hooks/` - Custom React hooks
- `src/utils/` - Utility functions
- `src/stores/` - MobX stores
- `src/constants/` - Constants and configuration
- `src/external/` - External integrations
- `public/` - Static assets (icons, images, XML bot strategies)
- `__mocks__/` - Jest mock files

### Scripts
- `npm run start` - Start dev server (port 5000)
- `npm run build` - Production build
- `npm test` - Run tests

### Deployment
- Static deployment with `dist` as public directory
- Build command: `npm run build`

## User Preferences
- None recorded yet.
