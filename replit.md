# Deriv Bot

## Overview
A React-based trading bot builder application (Deriv Bot) that allows users to create automated trading strategies using a visual block-based editor (Blockly). Built with TypeScript, React 18, and rsbuild as the build tool.

## Recent Changes
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
