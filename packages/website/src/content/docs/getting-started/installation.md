---
title: Installation
description: How to install Hytale Server Manager on Windows and Linux.
category: getting-started
order: 1
---

## Requirements

Before installing Hytale Server Manager, ensure your system meets these requirements:

- **Operating System**: Windows 10+ or Linux (Ubuntu 20.04+, Debian 11+, CentOS 8+)
- **Node.js**: Version 18.0 or higher
- **RAM**: 512 MB minimum (1 GB recommended)
- **Disk Space**: 500 MB for the application

## Quick Installation

## Quick start

Use the `docker-compose.yml` file provided to set up your docker container instance.

> [!NOTE]
> UnRAID users can use the UnRAID app store.

## Manual Installation

### Windows

1. Download the latest release from [GitHub Releases](https://github.com/nebula-codes/hytale_server_manager/releases)
2. Extract the zip file to your desired location
3. Open PowerShell as Administrator
4. Navigate to the extracted folder
5. Run the installer:

```powershell
.\scripts\install.ps1
```

### Linux

1. Download the latest release:

```bash
wget https://github.com/nebula-codes/hytale_server_manager/releases/latest/download/hytale-server-manager-linux.tar.gz
```

2. Extract and install:

```bash
tar -xzf hytale-server-manager-linux.tar.gz
cd hytale-server-manager
sudo ./scripts/install.sh
```

## Manual Installation

If you prefer to install manually:

1. Install Node.js 20 LTS from [nodejs.org](https://nodejs.org/)
2. Clone or download the repository
3. Install dependencies:

```bash
npm ci --production
npx prisma generate
npx prisma db push
```

4. Start the application:

```bash
npm start
```

## Verifying Installation

After installation, open your browser and navigate to:

```
http://localhost:3001
```

You should see the login page. On first run, you'll be prompted to create an admin account.

## Next Steps

- [Quick Start Guide](/hytale_server_manager/docs/getting-started/quick-start) - Create your first server
- [Configuration](/hytale_server_manager/docs/getting-started/configuration) - Customize your installation
