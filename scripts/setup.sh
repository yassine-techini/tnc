#!/bin/bash

# TNC Trading - Project Setup Script
# This script initializes the project structure and installs dependencies

set -e

echo "🪙 TNC Trading - Project Setup"
echo "==============================="
echo ""

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Check prerequisites
echo -e "${BLUE}Checking prerequisites...${NC}"

if ! command -v node &> /dev/null; then
    echo -e "${RED}❌ Node.js is not installed. Please install Node.js 20+${NC}"
    exit 1
fi

NODE_VERSION=$(node -v | cut -d'.' -f1 | sed 's/v//')
if [ "$NODE_VERSION" -lt 20 ]; then
    echo -e "${RED}❌ Node.js version must be 20 or higher. Current: $(node -v)${NC}"
    exit 1
fi
echo -e "${GREEN}✓ Node.js $(node -v)${NC}"

if ! command -v pnpm &> /dev/null; then
    echo -e "${YELLOW}Installing pnpm...${NC}"
    npm install -g pnpm
fi
echo -e "${GREEN}✓ pnpm $(pnpm -v)${NC}"

if ! command -v wrangler &> /dev/null; then
    echo -e "${YELLOW}Installing Wrangler CLI...${NC}"
    pnpm add -g wrangler
fi
echo -e "${GREEN}✓ Wrangler CLI installed${NC}"

echo ""
echo -e "${BLUE}Creating project structure...${NC}"

# Create directories
mkdir -p apps/{web,mobile,admin,state-portal}/src
mkdir -p packages/{api,shared,ui}/src
mkdir -p docs/{api,architecture,guides}

# Create apps/web structure
mkdir -p apps/web/src/{components,pages,hooks,stores,lib,api,assets}
mkdir -p apps/web/public

# Create apps/mobile structure
mkdir -p apps/mobile/src/{screens,components,navigation,stores,services,assets}
mkdir -p apps/mobile/assets

# Create apps/admin structure
mkdir -p apps/admin/src/{components,pages,hooks,stores}

# Create apps/state-portal structure
mkdir -p apps/state-portal/src/{components,pages}

# Create packages/api structure
mkdir -p packages/api/src/{routes,middleware,services,db,lib,durable-objects}
mkdir -p packages/api/src/routes/{auth,users,market,wallet,admin,state,webhooks}

# Create packages/shared structure
mkdir -p packages/shared/src/{types,constants,validators,utils}

# Create packages/ui structure
mkdir -p packages/ui/src/{components,hooks,utils}

echo -e "${GREEN}✓ Directory structure created${NC}"

echo ""
echo -e "${BLUE}Setting up environment...${NC}"

# Create .env.local if not exists
if [ ! -f .env.local ]; then
    cp .env.example .env.local
    echo -e "${GREEN}✓ Created .env.local from template${NC}"
else
    echo -e "${YELLOW}⚠ .env.local already exists, skipping${NC}"
fi

echo ""
echo -e "${BLUE}Installing dependencies...${NC}"
pnpm install

echo ""
echo -e "${GREEN}✓ Dependencies installed${NC}"

echo ""
echo -e "${BLUE}Setting up Cloudflare D1 database...${NC}"

# Check if logged in to Cloudflare
if ! wrangler whoami &> /dev/null; then
    echo -e "${YELLOW}Please login to Cloudflare:${NC}"
    wrangler login
fi

echo ""
echo "==============================="
echo -e "${GREEN}🎉 Setup complete!${NC}"
echo ""
echo "Next steps:"
echo "  1. Edit .env.local with your API keys"
echo "  2. Create Cloudflare resources:"
echo "     - wrangler d1 create tnc-trading-db"
echo "     - wrangler kv:namespace create CACHE"
echo "     - wrangler r2 bucket create tnc-trading-storage"
echo "  3. Update wrangler.toml with resource IDs"
echo "  4. Run: pnpm dev"
echo ""
echo -e "${BLUE}Documentation: ./docs${NC}"
echo -e "${BLUE}Specs: ./specs${NC}"
echo ""
