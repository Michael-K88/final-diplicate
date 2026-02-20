# Deriv Bot

## Overview
A React-based trading bot builder application (Deriv Bot) that allows users to create automated trading strategies using a visual block-based editor (Blockly). Built with TypeScript, React 18, and rsbuild as the build tool.

## Recent Changes
- 2026-02-20: Implemented dark green theme - updated color palette from orange (#FFA500) to dark green (#2d6a4f) across all accent colors, buttons, tabs, badges, and status indicators. Default theme set to dark mode.
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
