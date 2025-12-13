#!/usr/bin/env bash
set -euo pipefail

# OpenCode Token Analyzer Plugin - One-Line Installer
# This script downloads and installs the plugin from GitHub

# Parse arguments
UPDATE_MODE=false
for arg in "$@"; do
    case $arg in
        --update)
            UPDATE_MODE=true
            shift
            ;;
    esac
done

# Color output for better readability
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

echo_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

echo_error() {
    echo -e "${RED}[ERROR]${NC} $1" >&2
}

echo_step() {
    echo -e "${BLUE}[STEP]${NC} $1"
}

# Configuration
REPO_URL="https://github.com/ramtinJ95/opencode-tokenscope"
OPENCODE_DIR="${HOME}/.config/opencode"
TEMP_DIR=$(mktemp -d)

cleanup() {
    if [ -d "$TEMP_DIR" ]; then
        rm -rf "$TEMP_DIR"
    fi
}

trap cleanup EXIT

echo ""
echo "╔════════════════════════════════════════════════════════════╗"
if [ "$UPDATE_MODE" = true ]; then
echo "║   OpenCode Token Analyzer Plugin - Updater                ║"
else
echo "║   OpenCode Token Analyzer Plugin - Installer              ║"
fi
echo "╚════════════════════════════════════════════════════════════╝"
echo ""

# Check prerequisites
echo_step "1/5 Checking prerequisites..."

if [ ! -d "$OPENCODE_DIR" ]; then
    echo_error "OpenCode directory not found at $OPENCODE_DIR"
    echo_error "Please ensure OpenCode is installed"
    exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
    echo_error "npm is required but not installed"
    echo_error "Please install Node.js and npm first"
    exit 1
fi

if ! command -v curl >/dev/null 2>&1; then
    echo_error "curl is required but not installed"
    exit 1
fi

echo_info "All prerequisites met"

# Create plugin and command directories
echo_step "2/5 Preparing directories..."
mkdir -p "$OPENCODE_DIR/plugin"
mkdir -p "$OPENCODE_DIR/plugin/tokenscope-lib"
mkdir -p "$OPENCODE_DIR/command"
echo_info "Directories ready"

# Download files
echo_step "3/5 Downloading plugin files..."

FILES=(
    "plugin/tokenscope.ts"
    "plugin/tokenscope-lib/types.ts"
    "plugin/tokenscope-lib/config.ts"
    "plugin/tokenscope-lib/tokenizer.ts"
    "plugin/tokenscope-lib/analyzer.ts"
    "plugin/tokenscope-lib/cost.ts"
    "plugin/tokenscope-lib/subagent.ts"
    "plugin/tokenscope-lib/formatter.ts"
    "plugin/tokenscope-lib/context.ts"
    "plugin/models.json"
    "plugin/package.json"
    "plugin/tokenscope-config.json"
    "plugin/install.sh"
    "command/tokenscope.md"
)

for file in "${FILES[@]}"; do
    filename=$(basename "$file")
    dir=$(dirname "$file")
    
    echo_info "Downloading $filename..."
    
    if curl -fsSL "$REPO_URL/raw/main/$file" -o "$TEMP_DIR/$filename" 2>/dev/null; then
        # Move to appropriate directory based on path
        if [ "$dir" = "plugin" ]; then
            mv "$TEMP_DIR/$filename" "$OPENCODE_DIR/plugin/$filename"
        elif [ "$dir" = "plugin/tokenscope-lib" ]; then
            mv "$TEMP_DIR/$filename" "$OPENCODE_DIR/plugin/tokenscope-lib/$filename"
        else
            mv "$TEMP_DIR/$filename" "$OPENCODE_DIR/command/$filename"
        fi
    else
        echo_error "Failed to download $file"
        echo_error "Please check your internet connection and try again"
        exit 1
    fi
done

echo_info "All files downloaded successfully"

# Install dependencies
echo_step "4/5 Installing dependencies..."

DEPS_EXIST=false
if [ -d "$OPENCODE_DIR/plugin/node_modules/js-tiktoken" ] && [ -d "$OPENCODE_DIR/plugin/node_modules/@huggingface/transformers" ]; then
    DEPS_EXIST=true
fi

if [ "$UPDATE_MODE" = true ] && [ "$DEPS_EXIST" = true ]; then
    echo_info "Update mode: Dependencies already installed, skipping..."
else
    echo_info "This may take 1-2 minutes..."
    cd "$OPENCODE_DIR/plugin"
    if npm install --prefix "$OPENCODE_DIR/plugin" js-tiktoken@1.0.15 @huggingface/transformers@3.1.2 --save; then
        echo_info "Dependencies installed successfully"
    else
        echo_error "Failed to install dependencies"
        echo_error "You can try running manually: cd ~/.config/opencode/plugin && npm install"
        exit 1
    fi
fi

# Verify installation
echo_step "5/5 Verifying installation..."

REQUIRED_FILES=(
    "$OPENCODE_DIR/plugin/tokenscope.ts"
    "$OPENCODE_DIR/plugin/tokenscope-lib/types.ts"
    "$OPENCODE_DIR/plugin/tokenscope-lib/config.ts"
    "$OPENCODE_DIR/plugin/tokenscope-lib/tokenizer.ts"
    "$OPENCODE_DIR/plugin/tokenscope-lib/analyzer.ts"
    "$OPENCODE_DIR/plugin/tokenscope-lib/cost.ts"
    "$OPENCODE_DIR/plugin/tokenscope-lib/subagent.ts"
    "$OPENCODE_DIR/plugin/tokenscope-lib/formatter.ts"
    "$OPENCODE_DIR/plugin/tokenscope-lib/context.ts"
    "$OPENCODE_DIR/plugin/models.json"
    "$OPENCODE_DIR/plugin/tokenscope-config.json"
    "$OPENCODE_DIR/plugin/node_modules/js-tiktoken"
    "$OPENCODE_DIR/plugin/node_modules/@huggingface/transformers"
    "$OPENCODE_DIR/command/tokenscope.md"
)

all_present=true
for file in "${REQUIRED_FILES[@]}"; do
    if [ ! -e "$file" ]; then
        echo_warn "Missing: $file"
        all_present=false
    fi
done

if [ "$all_present" = true ]; then
    echo_info "All files verified"
else
    echo_error "Some files are missing"
    exit 1
fi

# Make install.sh executable for future local updates
chmod +x "$OPENCODE_DIR/plugin/install.sh"

# Get installed version
INSTALLED_VERSION=$(grep -o '"version": *"[^"]*"' "$OPENCODE_DIR/plugin/package.json" | cut -d'"' -f4)

echo ""
echo "╔════════════════════════════════════════════════════════════╗"
if [ "$UPDATE_MODE" = true ]; then
echo "║   Update Complete!                                         ║"
else
echo "║   Installation Complete!                                   ║"
fi
echo "╚════════════════════════════════════════════════════════════╝"
echo ""
echo_info "Version: $INSTALLED_VERSION"
echo_info "Plugin installed at: $OPENCODE_DIR/plugin/tokenscope.ts"
echo_info "Command installed at: $OPENCODE_DIR/command/tokenscope.md"
echo ""
echo_step "Next steps:"
echo "  1. Restart OpenCode"
echo "  2. Type /tokenscope in any session"
echo "  3. View full report: cat token-usage-output.txt"
echo ""
echo_info "For help and documentation, visit:"
echo_info "$REPO_URL"
echo ""
